const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/api/exports.ts');
const compiled = new Module(filename, module);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
compiled.require = name => name === './client' ? { ApiError, baseUrl: 'http://localhost:3000', sessionIdFor: () => null, reportSessionFailure: () => {} } : require(name);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { exportPath, exportFilename, requestExport } = compiled.exports;

test('four GET export paths and safe Content-Disposition name', async () => {
  assert.equal(exportPath('project', 'acceptance', 'record'), '/projects/project/acceptances/record/export.pdf');
  assert.equal(exportPath('project', 'handover-package', 'record'), '/projects/project/acceptances/record/handover-package.zip');
  assert.equal(exportPath('project', 'devices'), '/projects/project/exports/devices.xlsx');
  assert.equal(exportPath('project', 'connections'), '/projects/project/exports/connections.xlsx');
  assert.throws(() => exportPath('project', 'acceptance'));
  assert.equal(exportFilename('attachment; filename="export-A.xlsx"', 'fallback.xlsx', 'xlsx'), 'export-A.xlsx');
  assert.equal(exportFilename("attachment; filename*=UTF-8''export-B.pdf", 'fallback.pdf', 'pdf'), 'export-B.pdf');
  for (const name of ['../other.pdf', 'bad.pdf.exe', 'C:\\private.pdf', '.hidden.pdf']) {
    assert.equal(exportFilename(`attachment; filename="${name}"`, 'fallback.pdf', 'pdf'), 'fallback.pdf');
  }
  assert.equal(exportFilename(null, 'fallback.pdf', 'pdf'), 'fallback.pdf');
  assert.equal(exportFilename('attachment; filename="package.zip"', 'fallback.zip', 'zip'), 'package.zip');
  for (const name of ['../package.zip', 'package.zip.exe', 'C:\\private.zip']) {
    assert.equal(exportFilename(`attachment; filename="${name}"`, 'fallback.zip', 'zip'), 'fallback.zip');
  }
  const original = global.fetch, calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(new Blob(['file content']), { status: 200, headers: {
        'Content-Disposition': 'attachment; filename="export-A.xlsx"', 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } });
    };
    const result = await requestExport('test-only', 'project', 'devices', new AbortController().signal);
    assert.equal(result.name, 'export-A.xlsx');
    assert.equal(await result.blob.text(), 'file content');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only');
    assert.equal(calls[0].options.method, undefined);
  } finally { global.fetch = original; }

  try {
    const zipBytes = Buffer.from('PK\\u0003\\u0004 sample archive');
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(new Blob([zipBytes]), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="handover.zip"' } });
    };
    const result = await requestExport('session-only', 'project', 'handover-package', new AbortController().signal, 'record');
    assert.equal(result.name, 'handover.zip'); assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()), zipBytes);
    assert.equal(calls.at(-1).url, 'http://localhost:3000/projects/project/acceptances/record/handover-package.zip');
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer session-only');
    assert.equal(new URL(calls.at(-1).url).search, '');
  } finally { global.fetch = original; }
});

test('binary endpoint reads JSON error status rather than treating it as a file', async () => {
  const original = global.fetch;
  try {
    for (const status of [401, 403, 404, 409, 413, 503, 504]) {
      global.fetch = async () => new Response(JSON.stringify({ message: 'Chi tiết từ server' }), {
        status, headers: { 'Content-Type': 'application/json', ...(status === 503 ? { 'Retry-After': '1' } : {}) },
      });
      await assert.rejects(requestExport('test-only', 'project', 'connections', new AbortController().signal),
        error => error instanceof ApiError && error.status === status && error.message.includes('Chi tiết từ server'));
    }
    global.fetch = async () => new Response(JSON.stringify({ message: 'Pinned evidence checksum differs from snapshot' }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(requestExport('test-only', 'project', 'handover-package', new AbortController().signal, 'record'),
      error => error instanceof ApiError && error.message.includes('file minh chứng ghim'));
    global.fetch = async () => new Response(JSON.stringify({ message: 'busy' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
    });
    await assert.rejects(requestExport('test-only', 'project', 'handover-package', new AbortController().signal, 'record'),
      error => error instanceof ApiError && error.message.includes('đợi 3 giây'));
    global.fetch = async () => new Response(JSON.stringify({ message: 'Handover package exceeds byte limit' }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(requestExport('test-only', 'project', 'handover-package', new AbortController().signal, 'record'),
      error => error instanceof ApiError && error.message.includes('Gói ZIP vượt giới hạn'));
    global.fetch = async () => new Response(JSON.stringify({ message: 'Handover package timed out' }), {
      status: 504, headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(requestExport('test-only', 'project', 'handover-package', new AbortController().signal, 'record'),
      error => error instanceof ApiError && error.message.includes('hết thời gian'));
  } finally { global.fetch = original; }
});
