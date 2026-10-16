const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/api/exports.ts');
const compiled = new Module(filename, module);
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
compiled.require = name => name === './client' ? { ApiError, baseUrl: 'http://localhost:3000' } : require(name);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { exportPath, exportFilename, requestExport } = compiled.exports;

test('three GET export paths and safe Content-Disposition name', async () => {
  assert.equal(exportPath('project', 'acceptance', 'record'), '/projects/project/acceptances/record/export.pdf');
  assert.equal(exportPath('project', 'devices'), '/projects/project/exports/devices.xlsx');
  assert.equal(exportPath('project', 'connections'), '/projects/project/exports/connections.xlsx');
  assert.throws(() => exportPath('project', 'acceptance'));
  assert.equal(exportFilename('attachment; filename="export-A.xlsx"', 'fallback.xlsx', 'xlsx'), 'export-A.xlsx');
  assert.equal(exportFilename("attachment; filename*=UTF-8''export-B.pdf", 'fallback.pdf', 'pdf'), 'export-B.pdf');
  for (const name of ['../other.pdf', 'bad.pdf.exe', 'C:\\private.pdf', '.hidden.pdf']) {
    assert.equal(exportFilename(`attachment; filename="${name}"`, 'fallback.pdf', 'pdf'), 'fallback.pdf');
  }
  assert.equal(exportFilename(null, 'fallback.pdf', 'pdf'), 'fallback.pdf');
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
});

test('binary endpoint reads JSON error status rather than treating it as a file', async () => {
  const original = global.fetch;
  try {
    for (const status of [401, 403, 404, 409, 413, 503]) {
      global.fetch = async () => new Response(JSON.stringify({ message: 'Chi tiết từ server' }), {
        status, headers: { 'Content-Type': 'application/json' },
      });
      await assert.rejects(requestExport('test-only', 'project', 'connections', new AbortController().signal),
        error => error instanceof ApiError && error.status === status && error.message.includes('Chi tiết từ server'));
    }
  } finally { global.fetch = original; }
});
