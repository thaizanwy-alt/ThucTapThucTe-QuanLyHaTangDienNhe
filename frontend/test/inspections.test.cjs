const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/inspection-form.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { inspectionPayload, resultPayload, recheckPayload, issueActions, InspectionRequestGate, saveInspectionAndRefresh } = loaded.exports;
const systems = [{ id: 'system', category: 'LAN' }];
const templates = [{ id: 'template', category: 'LAN', isActive: true }];
const devices = [{ id: 'device', systemIds: ['system'] }, { id: 'foreign', systemIds: [] }];
const draft = { code: ' check-01 ', title: ' Test ', systemId: 'system', templateId: 'template', scope: 'none', scopeId: '' };
const item = { version: 2, activeIssue: null };
const issue = { assigneeId: 'tech', status: 'RESOLVED', version: 3 };

test('create payload normalizes text and keeps mutually exclusive nullable scope', () => {
  assert.deepEqual(inspectionPayload(draft, systems, templates, devices, ['area']), { code: 'CHECK-01', title: 'Test', systemId: 'system', templateId: 'template', areaId: null, deviceId: null });
  assert.equal(inspectionPayload({ ...draft, scope: 'area', scopeId: 'area' }, systems, templates, devices, ['area']).deviceId, null);
  assert.equal(inspectionPayload({ ...draft, scope: 'device', scopeId: 'device' }, systems, templates, devices, []).areaId, null);
  assert.throws(() => inspectionPayload({ ...draft, scope: 'device', scopeId: 'foreign' }, systems, templates, devices, []));
  assert.throws(() => inspectionPayload(draft, systems, [{ ...templates[0], category: 'CAMERA' }], devices, []));
  for (const value of ['', '  ', 'A/B']) assert.throws(() => inspectionPayload({ ...draft, code: value }, systems, templates, devices, []));
});
test('FAIL creates one issue only when none active; blank note becomes null', () => {
  assert.deepEqual(resultPayload(item, 'FAIL', ' ', ' Broken ', 'tech', [{ id: 'tech' }]), { expectedVersion: 2, result: 'FAIL', note: null, issue: { description: 'Broken', assigneeId: 'tech' } });
  assert.throws(() => resultPayload(item, 'FAIL', '', ' ', 'tech', [{ id: 'tech' }]));
  assert.throws(() => resultPayload(item, 'FAIL', '', 'Broken', 'inactive', [{ id: 'tech' }]));
  const active = { ...item, activeIssue: { status: 'OPEN' } };
  assert.equal(resultPayload(active, 'FAIL', 'More notes', '', '', []).issue, undefined);
  assert.throws(() => resultPayload(active, 'PASS', '', '', '', []));
});
test('result/recheck versions and required notes; PASS omits return reason', () => {
  assert.deepEqual(recheckPayload(issue, 2, 'PASS', ' Verified ', ''), { expectedVersion: 3, expectedItemVersion: 2, result: 'PASS', note: 'Verified' });
  assert.equal(recheckPayload(issue, 2, 'FAIL', 'Still failing', ' Fix again ').reason, 'Fix again');
  for (const v of [null, 0, '2', 2147483647]) assert.throws(() => recheckPayload(issue, v, 'PASS', 'OK', ''));
  assert.throws(() => recheckPayload({ ...issue, status: 'CLOSED' }, 2, 'PASS', 'OK', ''));
  assert.throws(() => recheckPayload(issue, 2, 'FAIL', 'OK', ' '));
});
test('roles and ownership expose only contract actions; CLOSED has none', () => {
  const manager = { id: 'mgr', role: 'MANAGER' }, tech = { id: 'tech', role: 'TECHNICIAN' };
  assert.equal(issueActions(manager, { ...issue, status: 'OPEN' }).assign, true);
  assert.equal(issueActions(manager, issue).recheck, true);
  assert.equal(issueActions(tech, { ...issue, status: 'OPEN' }).start, true);
  assert.equal(issueActions(tech, { ...issue, assigneeId: 'other', status: 'OPEN' }).start, false);
  for (const user of [manager, tech]) assert.ok(Object.values(issueActions(user, { ...issue, status: 'CLOSED' })).every(v => !v));
});
test('late responses after Project/revision change cannot publish old data', () => {
  const gate = new InspectionRequestGate(); const a = gate.begin(); const b = gate.begin();
  assert.equal(gate.current(a), false); assert.equal(gate.current(b), true);
  gate.invalidate(); assert.equal(gate.current(b), false);
});
test('write failure retains form; successful write closes/hides even if GET fails; retry never POSTs', async () => {
  let posts = 0, closes = 0, gets = 0;
  await assert.rejects(saveInspectionAndRefresh(async () => { throw new Error('409'); }, () => closes++, async () => true));
  assert.equal(closes, 0);
  const refresh = async () => { gets++; return false; };
  assert.equal(await saveInspectionAndRefresh(async () => { posts++; }, () => closes++, refresh), false);
  await refresh(); assert.equal(posts, 1); assert.equal(closes, 1); assert.equal(gets, 2);
});
