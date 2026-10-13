const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const Module = require('node:module'); const ts = require('typescript');
const file = path.resolve(__dirname, '../src/ListView.tsx'); const loaded = new Module(file, module); loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { listPage, listFilterOptions } = loaded.exports;
const rows = Array.from({length: 17}, (_, i) => ({ code: `D-${i}`, type: i % 2 ? 'CAMERA' : 'SWITCH' }));
test('client list pagination bounds, search and filter use real API rows without mutation', () => {
  assert.equal(listPage(rows, '', '', x => x.code, x => x.type, 1).rows.length, 6);
  assert.equal(listPage(rows, '', '', x => x.code, x => x.type, 99).current, 3);
  assert.equal(listPage(rows, ' d-1 ', 'CAMERA', x => x.code, x => x.type, 1).count, 4);
  assert.equal(rows.length, 17);
});
test('empty results and shrinking data have a safe page, no phantom rows', () => {
  const empty = listPage(rows, 'missing', '', x => x.code, x => x.type, 3);
  assert.equal(empty.current, 1); assert.deepEqual(empty.rows, []);
  assert.equal(listPage(rows.slice(0,2), '', '', x => x.code, x => x.type, 3).current, 1);
});
test('selected ASSIGNED filter survives the last task starting and GET refresh', () => {
  const tasks = [{ code: 'CV-01', status: 'IN_PROGRESS' }];
  assert.deepEqual(listFilterOptions(tasks, t => t.status, 'ASSIGNED'), ['ASSIGNED', 'IN_PROGRESS']);
  const page = listPage(tasks, '', 'ASSIGNED', t => t.code, t => t.status, 3);
  assert.equal(page.current, 1); assert.equal(page.count, 0);
  assert.deepEqual(listFilterOptions([], t => t.status, 'ASSIGNED'), ['ASSIGNED']);
});
