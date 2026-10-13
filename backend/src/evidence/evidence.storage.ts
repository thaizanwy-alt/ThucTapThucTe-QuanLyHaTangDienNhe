import { BadRequestException, HttpException, Injectable, PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, realpath, rename, unlink, lstat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable, Writable } from 'node:stream';
import Busboy = require('busboy');
import type { Request } from 'express';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export interface StagedEvidence {
  key: string; path: string; originalName: string; mimeType: string;
  sizeBytes: number; sha256: string; caption: string | null;
}
export function captionOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length > 1000) throw new BadRequestException('Invalid caption');
  return value.trim() || null;
}
export function idempotencyKeyOf(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new BadRequestException('Idempotency-Key is required (8–128 letters, digits, _ or -)');
  return value;
}

@Injectable()
export class EvidenceStorage {
  protected writeStream(path: string): Writable {
    return createWriteStream(path, { flags: 'wx', mode: 0o600 });
  }
  // Lazy configuration: unrelated APIs can still boot without evidence storage.
  async root(): Promise<string> {
    const configured = process.env.EVIDENCE_STORAGE_DIR;
    if (!configured || !isAbsolute(configured)) throw new ServiceUnavailableException('Evidence storage must be configured outside the repository');
    const repo = await realpath(resolve(__dirname, '../../..'));
    const outside = (dir: string) => { const r = relative(repo, dir); return r === '..' || r.startsWith(`..${require('node:path').sep}`) || isAbsolute(r); };
    const target = resolve(configured);
    if (!outside(target)) throw new ServiceUnavailableException('Evidence storage must be outside the repository');
    try {
      await mkdir(target, { recursive: true });
      const actual = await realpath(target);
      if (!outside(actual)) throw new Error('Unsafe storage');
      for (const name of ['tmp', 'files']) {
        await mkdir(join(actual, name), { recursive: true });
        if (await realpath(join(actual, name)) !== join(actual, name)) throw new Error('Unsafe storage');
      }
      return actual;
    } catch { throw new ServiceUnavailableException('Evidence storage unavailable'); }
  }

  async receive(req: Request): Promise<StagedEvidence> {
    const root = await this.root();
    const key = randomUUID(); const path = join(root, 'tmp', key);
    let parser: ReturnType<typeof Busboy>;
    // One extra byte distinguishes the inclusive limit from an oversized file.
    try { parser = Busboy({ headers: req.headers, preservePath: true, defParamCharset: 'utf8', limits: { fileSize: MAX_FILE_SIZE + 1, files: 1, fields: 1, parts: 3, fieldSize: 4096 } }); }
    catch { throw new BadRequestException('Expected multipart/form-data'); }
    let invalid: Error | undefined, originalName = '', mimeType = '', sizeBytes = 0, caption: string | null = null;
    let received = false; const jobs: Promise<void>[] = [];
    const hash = createHash('sha256');
    const fail = (error: Error) => { invalid ??= error; };
    try {
      await new Promise<void>((accept, reject) => {
        let settled = false;
        const streams = new Set<Readable | Writable>();
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          req.off('aborted', aborted);
          if (error) reject(error); else accept();
        };
        const stop = (error: Error) => {
          fail(error);
          settle(invalid);
          req.unpipe(parser);
          parser.destroy();
          for (const stream of streams) stream.destroy();
          req.resume();
        };
        const aborted = () => stop(new BadRequestException('Upload aborted'));
        const requestError = () => stop(new BadRequestException('Upload aborted'));
        req.once('aborted', aborted);
        // Keep an error listener until the request closes (abort may precede ECONNRESET).
        req.on('error', requestError);
        req.once('close', () => { req.off('error', requestError); req.off('aborted', aborted); });
        parser.on('file', (field, stream, info) => {
          received = true;
          originalName = basename(win32.basename(info.filename ?? '')).replace(/[\x00-\x1f\x7f]/g, '').trim();
          mimeType = info.mimeType;
          if (field !== 'file' || !originalName || originalName.length > 255) fail(new BadRequestException('Invalid file field/name'));
          streams.add(stream);
          stream.on('limit', () => stop(new PayloadTooLargeException('Maximum file size is 10 MiB')));
          stream.on('data', (chunk: Buffer) => { sizeBytes += chunk.length; hash.update(chunk); });
          try {
            const output = this.writeStream(path); streams.add(output);
            jobs.push(pipeline(stream, output).catch(() => stop(new ServiceUnavailableException('Cannot store evidence'))));
          } catch { stop(new ServiceUnavailableException('Cannot store evidence')); }
        });
        parser.on('field', (name, value, info) => {
          try { if (name !== 'caption' || info.valueTruncated) throw new BadRequestException('Invalid metadata'); caption = captionOf(value); }
          catch (error) { fail(error as Error); }
        });
        parser.on('filesLimit', () => fail(new BadRequestException('Exactly one file is required')));
        parser.on('fieldsLimit', () => fail(new BadRequestException('Only caption is allowed')));
        parser.on('partsLimit', () => fail(new BadRequestException('Too many multipart parts')));
        parser.on('error', () => stop(invalid ?? new BadRequestException('Invalid multipart upload')));
        parser.on('close', () => settle(invalid));
        req.pipe(parser);
      });
      await Promise.all(jobs);
      if (invalid) throw invalid;
      if (sizeBytes > MAX_FILE_SIZE) throw new PayloadTooLargeException('Maximum file size is 10 MiB');
      if (!received || sizeBytes === 0) throw new BadRequestException('A non-empty file is required');
      const f = await open(path, 'r'); const header = Buffer.alloc(16);
      try { await f.read(header, 0, 16, 0); } finally { await f.close(); }
      const detected = header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : header[0] === 255 && header[1] === 216 && header[2] === 255 ? 'image/jpeg'
        : header.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null;
      const extensions: Record<string, RegExp> = { 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'application/pdf': /\.pdf$/i };
      if (!detected || detected !== mimeType || !extensions[detected].test(originalName)) throw new UnsupportedMediaTypeException('Only JPEG/PNG/PDF with matching signature, MIME and extension are accepted');
      return { key, path, originalName, mimeType, sizeBytes, sha256: hash.digest('hex'), caption };
    } catch (error) {
      await Promise.all(jobs); await this.discard(path);
      throw error instanceof HttpException ? error : new ServiceUnavailableException('Cannot process evidence');
    }
  }

  async promote(file: StagedEvidence): Promise<string> {
    const path = join(await this.root(), 'files', file.key);
    try { await rename(file.path, path); return path; }
    catch { throw new ServiceUnavailableException('Cannot finalize evidence'); }
  }
  async discard(path: string): Promise<void> {
    // Only the path owned by this upload; failed cleanup remains for reporting.
    await unlink(path).catch(() => undefined);
  }
  async content(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new ServiceUnavailableException('Invalid stored file');
    const path = join(await this.root(), 'files', key);
    try {
      if (!(await lstat(path)).isFile()) throw new Error('Not a regular file');
      return await open(path, 'r');
    } catch { throw new ServiceUnavailableException('Stored evidence is unavailable'); }
  }
}
