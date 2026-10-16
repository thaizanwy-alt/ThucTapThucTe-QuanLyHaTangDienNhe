import { HttpException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { fork } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import PDFDocument = require('pdfkit');

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const MAX_PAGES = 200;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_CELL_LENGTH = 32767;
export const XLSX_TIMEOUT_MS = 60000;
export const EXPORT_LIMITS = Symbol('EXPORT_LIMITS');
export interface ExportLimits { maxBytes: number; maxRows: number; maxPages: number; maxInputBytes: number; xlsxTimeoutMs: number }
// Tests may lower limits through DI/function arguments; no HTTP/env override.
export function exportLimits(options: Partial<ExportLimits> = {}): ExportLimits {
  const limits = { maxBytes: MAX_BYTES, maxRows: MAX_ROWS, maxPages: MAX_PAGES, maxInputBytes: MAX_INPUT_BYTES, xlsxTimeoutMs: XLSX_TIMEOUT_MS, ...options };
  for (const [key, maximum] of Object.entries({ maxBytes: MAX_BYTES, maxRows: MAX_ROWS, maxPages: MAX_PAGES, maxInputBytes: MAX_INPUT_BYTES, xlsxTimeoutMs: XLSX_TIMEOUT_MS })) {
    const value = limits[key as keyof ExportLimits];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid export limit');
  }
  return limits;
}
export class RowBudget {
  private used = 0;
  constructor(private readonly maximum: number) {}
  add(count = 1): void {
    this.used += count;
    if (!Number.isSafeInteger(this.used) || this.used > this.maximum)
      throw new PayloadTooLargeException('Workbook exceeds ' + this.maximum + ' total rows');
  }
}
export class InputBudget {
  private used = 0;
  constructor(private readonly maximum: number) {}
  add(value: string | number | null): void {
    if (value === null) return;
    const string = safeCell(value);
    if (string.length > MAX_CELL_LENGTH) throw new PayloadTooLargeException('XLSX cell exceeds 32767 UTF-16 code units');
    this.used += Buffer.byteLength(string, 'utf8');
    if (this.used > this.maximum) throw new PayloadTooLargeException('Workbook input exceeds byte limit');
  }
  sheet(sheet: Sheet): void {
    this.add(sheet.name);
    for (const column of sheet.columns) this.add(column);
    for (const row of sheet.rows) this.row(row);
  }
  row(row: (string | number | null)[]): void { for (const cell of row) this.add(cell); }
}
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export interface XlsxWorkerHooks { path?: string; onStart?: (pid: number) => void; onPeakRss?: (bytes: number) => void }
// Noto Sans ccmp can emit a combining glyph with no Unicode code point.
// PDFKit then writes an empty ToUnicode entry, corrupting extracted text.
// PDFKit accepts the fontkit feature map at runtime; @types/pdfkit lists only enabled tag arrays.
export const PDF_TEXT_FEATURES = { ccmp: false } as unknown as PDFKit.Mixins.TextOptions['features'];
export interface PreparedExport { path: string; name: string; mime: string; size: number; cleanup: () => Promise<void> }
export type Sheet = { name: string; columns: string[]; rows: (string | number | null)[][] };
export type Checkpoint = () => Promise<void>;
export const text = (value: unknown): string => value === null || value === undefined ? '' : String(value);
export const safeCell = (value: unknown): string => {
  const raw = text(value);
  return /^[\s\u0000-\u001f]*[=+@-]/u.test(raw) ? "'" + raw : raw;
};
export const fileName = (code: string, kind: string, at: Date): string =>
  code.replace(/[^A-Z0-9-]/gi, '-').slice(0, 80) + '-' + kind + '-' + at.toISOString().replace(/[-:.]/g, '').slice(0, 15);

async function temporary(name: string, mime: string, limits: ExportLimits, render: (path: string) => Promise<void>): Promise<PreparedExport> {
  let dir: string;
  try {
    const base = await realpath(tmpdir()), repo = await realpath(resolve(__dirname, '../../..'));
    const inside = relative(repo, base);
    if (!inside || (!inside.startsWith('..' + sep) && inside !== '..' && !isAbsolute(inside)))
      throw new ServiceUnavailableException('Export temporary directory must be outside the repository');
    dir = await mkdtemp(join(base, 'elv-export-'));
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('Export temporary storage unavailable');
  }
  const path = join(dir, 'document');
  try {
    await render(path);
    const size = (await stat(path)).size;
    if (size > limits.maxBytes) throw new PayloadTooLargeException('Export exceeds byte limit');
    return { path, name, mime, size, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('Cannot create export');
  }
}
function limiter(maximum: number) {
  let size = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > maximum ? new PayloadTooLargeException('Export exceeds byte limit') : null, chunk);
  } });
}

export async function workbook(name: string, sheets: Sheet[], options: Partial<ExportLimits> = {}, signal?: AbortSignal,
  hooks: XlsxWorkerHooks = {}): Promise<PreparedExport> {
  const limits = exportLimits(options), preflight = new RowBudget(limits.maxRows);
  preflight.add(sheets.reduce((total, sheet) => total + 1 + sheet.rows.length, 0));
  const input = new InputBudget(limits.maxInputBytes);
  for (const sheet of sheets) input.sheet(sheet);
  return temporary(name, XLSX_MIME, limits, async path => {
    if (signal?.aborted) throw new ServiceUnavailableException('Export request canceled');
    // The library materializes OOXML before ZIP creation. Isolate that work from Nest.
    // V8 heap is not a process RSS limit; timeout/output/input budgets are independent.
    const worker = fork(hooks.path ?? join(__dirname, 'xlsx.worker.js'), [], {
      execArgv: ['--max-old-space-size=256'],
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
      env: { NODE_ENV: 'production' },
    });
    if (worker.pid) hooks.onStart?.(worker.pid);
    worker.on('message', message => {
      if (message && typeof message === 'object' && 'peakRssBytes' in message && typeof message.peakRssBytes === 'number')
        hooks.onPeakRss?.(message.peakRssBytes);
    });
    const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    const stream = worker.stdout;
    if (!stream) throw new ServiceUnavailableException('XLSX worker stream unavailable');
    let stopped = false;
    const stop = () => { if (!stopped) { stopped = true; worker.kill(); } };
    const onAbort = () => stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) stop();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, limits.xlsxTimeoutMs);
    let workerError: Error | undefined;
    const exit = new Promise<void>((resolveExit, rejectExit) => {
      worker.once('error', error => { workerError = error; });
      // `close` follows process exit and stdio closure; do not release the service slot on an early `error` event.
      worker.once('close', code => code === 0 && !workerError
        ? resolveExit() : rejectExit(new ServiceUnavailableException('XLSX worker failed')));
    });
    const drained = pipeline(stream, limiter(limits.maxBytes), output);
    // Attach handlers before sending; a worker can fail while IPC is being serialized.
    void exit.catch(() => undefined); void drained.catch(() => undefined);
    try {
      worker.send(sheets, error => { if (error) stop(); });
      await Promise.all([drained, exit]);
      if (timedOut || signal?.aborted) throw new ServiceUnavailableException(timedOut ? 'XLSX worker timed out' : 'Export request canceled');
    } catch (error) {
      stop(); stream.destroy(); output.destroy();
      await Promise.allSettled([drained, exit]);
      if (error instanceof PayloadTooLargeException) throw error;
      if (timedOut) throw new ServiceUnavailableException('XLSX worker timed out');
      if (signal?.aborted) throw new ServiceUnavailableException('Export request canceled');
      throw new ServiceUnavailableException('Cannot create XLSX export');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  });
}

// Lazy glyph-width wrapping preserves explicit empty lines and splits long words.
function* wrappedLines(doc: PDFKit.PDFDocument, value: string, width: number): Generator<string> {
  const normalized = value.replace(/\r\n?/g, '\n');
  let start = 0;
  while (start <= normalized.length) {
    const newline = normalized.indexOf('\n', start), end = newline < 0 ? normalized.length : newline;
    if (start === end) yield '';
    while (start < end) {
      let high = Math.min(end, start + 64);
      while (high < end && doc.widthOfString(normalized.slice(start, high), { features: PDF_TEXT_FEATURES }) <= width) high = Math.min(end, start + (high - start) * 2);
      let low = start + 1, best = start;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (doc.widthOfString(normalized.slice(start, mid), { features: PDF_TEXT_FEATURES }) <= width) { best = mid; low = mid + 1; }
        else high = mid - 1;
      }
      if (best === start) best = start + 1;
      if (best < end && /[\uDC00-\uDFFF]/.test(normalized[best])) best--;
      if (best === start) best = Math.min(start + 2, end);
      yield normalized.slice(start, best);
      start = best;
    }
    if (newline < 0) break;
    start = end + 1;
  }
}

export async function pdfTable(doc: PDFKit.PDFDocument, rows: Iterable<[string, string]>, checkpoint: Checkpoint): Promise<void> {
  const x = 45, left = 300, right = 205, padding = 12;
  doc.fontSize(10);
  const lineHeight = doc.currentLineHeight(true);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 12;
  const draw = (a: string[], b: string[]) => {
    const height = Math.max(a.length, b.length) * lineHeight + padding, y = doc.y;
    doc.rect(x, y, left + right, height).strokeColor('#b7c2cc').stroke();
    doc.moveTo(x + left, y).lineTo(x + left, y + height).stroke();
    doc.fillColor('#162b3b').fontSize(10);
    for (let i = 0; i < a.length; i++) doc.text(a[i], x + 6, y + 6 + i * lineHeight, { lineBreak: false, features: PDF_TEXT_FEATURES });
    for (let i = 0; i < b.length; i++) doc.text(b[i], x + left + 6, y + 6 + i * lineHeight, { lineBreak: false, features: PDF_TEXT_FEATURES });
    doc.x = x; doc.y = y + height;
  };
  const header = () => {
    if (doc.y + lineHeight * 2 + padding * 2 > bottom()) doc.addPage();
    draw(['Mục kiểm tra'], ['Kết quả / Ghi chú']);
  };
  header();
  for (const [a, b] of rows) {
    const ai = wrappedLines(doc, a, left - 12), bi = wrappedLines(doc, b, right - 12);
    let av = ai.next(), bv = bi.next();
    while (!av.done || !bv.done) {
      let capacity = Math.floor((bottom() - doc.y - padding) / lineHeight);
      if (capacity < 1) { doc.addPage(); header(); capacity = Math.floor((bottom() - doc.y - padding) / lineHeight); }
      const al: string[] = [], bl: string[] = [];
      for (let i = 0; i < capacity && (!av.done || !bv.done); i++) {
        al.push(av.done ? '' : av.value); bl.push(bv.done ? '' : bv.value);
        if (!av.done) av = ai.next(); if (!bv.done) bv = bi.next();
      }
      draw(al, bl); await checkpoint();
    }
  }
  doc.x = x; doc.moveDown();
}

export async function pdf(name: string, fontPath: string,
  write: (doc: PDFKit.PDFDocument, checkpoint: Checkpoint) => void | Promise<void>, options: Partial<ExportLimits> = {}): Promise<PreparedExport> {
  const limits = exportLimits(options);
  return temporary(name, 'application/pdf', limits, async path => {
    const doc = new PDFDocument({ size: 'A4', margin: 45, bufferPages: false, autoFirstPage: false, info: { Title: 'Ho so nghiem thu' } });
    const limited = limiter(limits.maxBytes), output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    let failure: unknown;
    const drained = pipeline(doc, limited, output).catch(error => { failure = error; });
    const checkpoint = async () => { await setImmediate(); if (failure) throw failure; };
    let pages = 0;
    const addPage = doc.addPage.bind(doc);
    doc.addPage = ((...args: Parameters<PDFKit.PDFDocument['addPage']>) => {
      if (pages >= limits.maxPages) throw new PayloadTooLargeException('PDF exceeds ' + limits.maxPages + ' pages');
      pages++; addPage(...args);
      const { x, y } = doc;
      const fontSize = (doc as unknown as { _fontSize: number })._fontSize;
      // Draw page numbers as pages arrive, without retaining old pages.
      doc.fontSize(8).text('Trang ' + pages, 45, 20, { width: 505, align: 'right', lineBreak: false, features: PDF_TEXT_FEATURES });
      doc.x = x; doc.y = y; doc.fontSize(fontSize);
      return doc;
    }) as PDFKit.PDFDocument['addPage'];
    try {
      doc.font(fontPath).fontSize(10); doc.addPage();
      await write(doc, checkpoint); await checkpoint();
      doc.end(); await drained;
      if (failure) throw failure;
    } catch (error) {
      doc.destroy(); limited.destroy(); output.destroy(); await drained;
      const cause = failure instanceof PayloadTooLargeException ? failure : error;
      if (cause instanceof HttpException) throw cause;
      throw new ServiceUnavailableException('Cannot render export');
    }
  });
}
