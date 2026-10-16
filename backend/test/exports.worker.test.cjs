const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { Writable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const readWorkbook = require('./read-xlsx.cjs');
const { workbook, MAX_BYTES, MAX_INPUT_BYTES, MAX_CELL_LENGTH, InputBudget } = require('../dist/exports/exports.render');
const renderModule = require('../dist/exports/exports.render');
const { ExportsController } = require('../dist/exports/exports.controller');
const { ExportsService } = require('../dist/exports/exports.service');
const { ServiceUnavailableException } = require('@nestjs/common');

const fixture = path.join(__dirname, 'fixtures', 'xlsx-worker-fault.cjs');
const one = name => [{ name, columns: ['Mã'], rows: [['Tiếng Việt']] }];
const rejects = (call, status) => assert.rejects(call, error => error.getStatus?.() === status);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const bounded = async (promise, ms) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), ms); })]); } finally { clearTimeout(timer); } };

test('writer: multiple sheets, text, null and a measured near-limit worker RSS', { timeout: 60000 }, async () => {
  let rss = 0;
  const rows = Array.from({ length: 9500 }, (_, i) => [String(i), randomBytes(400).toString('hex'), null, 'Tắt']);
  const inputBytes = rows.reduce((total, row) => total + Buffer.byteLength(row[0]) + Buffer.byteLength(row[1]) + Buffer.byteLength(row[3]), 0);
  assert.ok(inputBytes > 7 * 1024 * 1024 && inputBytes < MAX_INPUT_BYTES);
  const file = await workbook('large.xlsx', [
    { name: 'Thông tin', columns: ['Tên'], rows: [['Tiếng Việt']] },
    { name: 'Cổng', columns: ['Mã', 'Mô tả', 'IP', 'PoE'], rows },
  ], {}, undefined, { onPeakRss: value => { rss = value; } });
  try {
    const book = await readWorkbook(file.path);
    assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Thông tin', 'Cổng']);
    assert.equal(book.getWorksheet('Cổng').rowCount, 9501);
    assert.equal(book.getWorksheet('Thông tin').getRow(2).getCell(1).value, 'Tiếng Việt');
    assert.equal(book.getWorksheet('Cổng').getRow(2).getCell(3).value, null);
    assert.equal(book.getWorksheet('Cổng').getRow(2).getCell(4).value, 'Tắt');
    assert.ok(rss > 0, 'worker reports OS high-water RSS');
    console.log(`XLSX near-row-limit worker peak RSS: ${Math.round(rss / 1048576)} MiB; output ${file.size} bytes`);
  } finally { await file.cleanup(); }
});

test('input/cell/row limits reject before worker starts', async () => {
  let spawned = false;
  const hooks = { onStart: () => { spawned = true; } };
  await rejects(workbook('cell.xlsx', [{ name: 'A', columns: ['A'], rows: [['x'.repeat(32768)]] }], {}, undefined, hooks), 413);
  await rejects(workbook('input.xlsx', [{ name: 'A', columns: ['A'], rows: [['x'.repeat(200)]] }], { maxInputBytes: 100 }, undefined, hooks), 413);
  await rejects(workbook('rows.xlsx', one('A'), { maxRows: 1 }, undefined, hooks), 413);
  assert.equal(spawned, false);
  const valid = await workbook('cell-boundary.xlsx', [{ name: 'A', columns: ['A'], rows: [['x'.repeat(32767)]] }]);
  try { assert.equal((await readWorkbook(valid.path)).getWorksheet('A').getRow(2).getCell(1).value.length, 32767); }
  finally { await valid.cleanup(); }
  assert.equal(MAX_INPUT_BYTES, 8 * 1024 * 1024);
});

test('XLSX budgets count UTF-16 code units per cell and UTF-8 bytes across text', { timeout: 30000 }, async () => {
  assert.equal(MAX_CELL_LENGTH, 32767);
  const cell = '😀'.repeat(16383) + 'a';
  assert.equal(cell.length, 32767, 'an astral character is two UTF-16 code units');
  assert.equal(Buffer.byteLength('😀', 'utf8'), 4, 'the aggregate budget uses UTF-8 bytes');
  new InputBudget(Buffer.byteLength(cell, 'utf8')).add(cell);
  assert.throws(() => new InputBudget(Buffer.byteLength(cell, 'utf8') - 1).add(cell), error => error.getStatus?.() === 413);
  new InputBudget(4).add('😀');
  assert.throws(() => new InputBudget(3).add('😀'), error => error.getStatus?.() === 413);
  const file = await workbook('unicode-cell.xlsx', [{ name: 'Unicode', columns: ['Value'], rows: [[cell]] }]);
  try { assert.equal((await readWorkbook(file.path)).getWorksheet('Unicode').getRow(2).getCell(1).value, cell); }
  finally { await file.cleanup(); }
});

test('disconnect after worker completion but before send only cleans the prepared file', { timeout: 30000 }, async () => {
  let prepared, returnFile;
  const workerFinished = new Promise(resolve => { prepared = resolve; });
  const releaseResponse = new Promise(resolve => { returnFile = resolve; });
  const headers = [];
  let cleanups = 0;
  const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  response.setHeader = (name, value) => headers.push([name, value]);
  const closed = new Promise(resolve => response.once('close', resolve));
  const controller = new ExportsController({});
  const request = controller.sendWorkbook(response, async () => {
    const file = await workbook('disconnect-before-send.xlsx', one('ready'));
    const cleanup = file.cleanup;
    file.cleanup = async () => { cleanups++; await cleanup(); };
    prepared();
    await releaseResponse;
    return file;
  });
  await bounded(workerFinished, 10000);
  response.destroy();
  await bounded(closed, 5000);
  returnFile();
  await bounded(request, 10000);
  assert.deepEqual(headers, [], 'no response headers are sent after the peer closes');
  assert.equal(cleanups, 1, 'prepared output is cleaned exactly once');
});

test('service reserves the process slot before loading data and releases it after a failed request', async () => {
  const service = new ExportsService({}, {});
  let entered, continueFirst, calls = 0;
  const currentEntered = new Promise(resolve => { entered = resolve; });
  const holdFirst = new Promise(resolve => { continueFirst = resolve; });
  service.current = async () => {
    calls++;
    if (calls === 1) { entered(); await holdFirst; }
    throw new Error('injected current-data failure');
  };
  const user = { role: 'MANAGER' };
  const first = service.devicesWorkbook('project-id', user);
  await bounded(currentEntered, 1000);
  await rejects(service.devicesWorkbook('project-id', user), 503);
  assert.equal(calls, 1, 'the rejected request did not enter current()');
  continueFirst();
  await assert.rejects(first, /injected current-data failure/);
  await assert.rejects(service.devicesWorkbook('project-id', user), /injected current-data failure/);
  assert.equal(calls, 2, 'the next request acquired the slot after error cleanup');
});

test('service retains the slot through an aborted renderer until it settles', async () => {
  const service = new ExportsService({}, {});
  service.current = async () => ({ project: { code: 'T', name: 'Test' }, devices: [], areas: [], systems: [],
    links: [], served: [], profiles: [], at: new Date() });
  const user = { role: 'MANAGER' }, abort = new AbortController();
  let entered, finishRenderer;
  const rendererEntered = new Promise(resolve => { entered = resolve; });
  const rendererGate = new Promise(resolve => { finishRenderer = resolve; });
  const originalWorkbook = renderModule.workbook;
  renderModule.workbook = async (_name, _sheets, _limits, signal) => {
    entered();
    await rendererGate;
    assert.equal(signal.aborted, true);
    throw new ServiceUnavailableException('injected abort after worker close');
  };
  try {
    const first = service.devicesWorkbook('project-id', user, abort.signal);
    await bounded(rendererEntered, 1000);
    abort.abort();
    await rejects(service.connectionsWorkbook('project-id', user), 503);
    finishRenderer();
    await rejects(first, 503);
  } finally { finishRenderer(); renderModule.workbook = originalWorkbook; }
  const next = await service.devicesWorkbook('project-id', user);
  await next.cleanup();
});

test('fault, timeout, cancellation and production byte limit stop only their worker and clean temp output', { timeout: 30000 }, async () => {
  const baseline = new Set(await fs.readdir(os.tmpdir()));
  for (const [mode, options, signal, status] of [
    ['FAIL', {}, undefined, 503],
    ['STALL', { xlsxTimeoutMs: 100 }, undefined, 503],
    ['BYTES', { maxBytes: 1024 }, undefined, 413],
    ['BYTES', { maxBytes: MAX_BYTES }, undefined, 413],
  ]) {
    let pid;
    await rejects(workbook(mode + '.xlsx', one(mode), options, signal, { path: fixture, onStart: id => { pid = id; } }), status);
    assert.ok(pid && !alive(pid), `${mode} worker must exit before request rejects`);
  }
  const abort = new AbortController();
  let abortedPid;
  await rejects(workbook('cancel.xlsx', one('STALL'), {}, abort.signal,
    { path: fixture, onStart: pid => { abortedPid = pid; setTimeout(() => abort.abort(), 25); } }), 503);
  assert.ok(abortedPid && !alive(abortedPid));
  const after = await fs.readdir(os.tmpdir());
  assert.deepEqual(after.filter(name => name.startsWith('elv-export-') && !baseline.has(name)), []);
});
