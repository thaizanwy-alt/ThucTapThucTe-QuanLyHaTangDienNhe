const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/rack-form.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { rackDraft, rackPayload, placementDraft, placementPayload, elevationWindow,
  RackRequestGate, visibleRackSnapshot, saveRackAndRefresh } = loaded.exports;
const rack = (id, role = null, capacityU = 42) => ({ id, rackRole: role, capacityU,
  parentRackId: null, areaId: 'area-a', servedAreaIds: ['room-a'] });
const main = rack('main', 'MAIN');
const sub = rack('sub', 'SUB', 24);
const racks = [main, sub];
const device = { id: 'switch', type: 'SWITCH', areaId: null, rackId: 'main', mountMode: null, startU: null, heightU: null };

test('legacy rack remains nullable; MAIN/SUB require explicit location/capacity/served Areas', () => {
  const legacy = rack('legacy', null, null);
  legacy.areaId = null; legacy.servedAreaIds = [];
  assert.deepEqual(rackPayload(rackDraft(legacy), legacy.id, racks), {
    rackRole: null, parentRackId: null, areaId: null, capacityU: null, servedAreaIds: [],
  });
  for (const override of [{ areaId: '' }, { capacity: '' }, { servedAreaIds: [] }]) {
    assert.throws(() => rackPayload({ ...rackDraft(main), ...override }, main.id, racks));
  }
  const input = rackPayload({ ...rackDraft(main), servedAreaIds: ['floor-a'] }, main.id, racks);
  assert.deepEqual(input.servedAreaIds, ['floor-a'], 'FLOOR never implicitly includes ROOM');
  assert.equal(input.parentRackId, null);
});

test('SUB selects a different MAIN, not SUB/self; demoting MAIN clears parent', () => {
  const draft = { ...rackDraft(sub), parentId: 'main' };
  assert.equal(rackPayload(draft, sub.id, racks).parentRackId, 'main');
  for (const parentId of ['', 'sub', 'unknown']) assert.throws(() => rackPayload({ ...draft, parentId }, sub.id, racks));
  assert.equal(rackPayload({ ...draft, role: 'MAIN' }, sub.id, racks).parentRackId, null);
});

test('placement PUT includes every key, clears previous Area/Rack and permits unplace', () => {
  const draft = { ...placementDraft(device, main.id), rackId: 'sub', mode: 'U', start: '22', height: '2' };
  assert.deepEqual(placementPayload(draft, device, racks), { areaId: null, rackId: 'sub', mountMode: 'U', startU: 22, heightU: 2 });
  assert.deepEqual(placementPayload({ ...draft, target: 'area', areaId: 'room-a' }, device, racks),
    { areaId: 'room-a', rackId: null, mountMode: null, startU: null, heightU: null });
  assert.deepEqual(placementPayload({ ...draft, target: 'none' }, device, racks),
    { areaId: null, rackId: null, mountMode: null, startU: null, heightU: null });
  assert.deepEqual(placementPayload({ ...draft, mode: '' }, device, racks),
    { areaId: null, rackId: 'sub', mountMode: null, startU: null, heightU: null });
});

test('U bounds and optional start; ZERO_U only PDU with height 0, no start', () => {
  const draft = { ...placementDraft(device, main.id), mode: 'U', start: '42', height: '1' };
  assert.equal(placementPayload(draft, device, racks).startU, 42);
  for (const override of [{ start: '42', height: '2' }, { start: '0' }, { height: '0' }, { height: '1.5' }]) assert.throws(() => placementPayload({ ...draft, ...override }, device, racks));
  assert.equal(placementPayload({ ...draft, start: '' }, device, racks).startU, null);
  assert.throws(() => placementPayload({ ...draft, mode: 'ZERO_U' }, device, racks));
  assert.deepEqual(placementPayload({ ...draft, mode: 'ZERO_U' }, { ...device, type: 'PDU' }, racks),
    { areaId: null, rackId: 'main', mountMode: 'ZERO_U', startU: null, heightU: 0 });
});

test('front elevation U1 is bottom; multi-U spans real height; unplaced/ZERO_U never plotted', () => {
  const ups = { ...device, id: 'ups', type: 'UPS', mountMode: 'U', startU: 1, heightU: 2 };
  const view = elevationWindow(42, 0, [ups, device, { ...device, mountMode: 'ZERO_U', heightU: 0 }]);
  assert.equal(view.units[0], 42); assert.equal(view.units.at(-1), 1);
  assert.deepEqual(view.placed.map(p => [p.device.id, p.row, p.span]), [['ups', 41, 2]]);
  const huge = elevationWindow(2147483647, 0, [ups]);
  assert.equal(huge.units.length, 60); assert.equal(huge.placed.length, 0);
});

test('Project/Rack/revision changes immediately hide old snapshot and invalidate late responses', async () => {
  const gate = new RackRequestGate();
  gate.setScope('project-a:rack-main:0');
  const old = gate.begin();
  const snapshot = { scope: 'project-a:rack-main:0', devices: [device] };
  for (const scope of ['project-b:rack-main:0', 'project-a:rack-sub:0', 'project-a:rack-main:1']) {
    gate.setScope(scope);
    assert.equal(gate.current(old), false);
    assert.equal(visibleRackSnapshot(snapshot, scope), null);
  }
  const pending = gate.begin(); gate.invalidate();
  assert.equal(gate.current(pending), false, 'failed GET/unmount cannot resurrect old snapshot on retry');
  const latest = gate.begin(); assert.equal(gate.current(latest), true);
});

test('committed write closes form before failed GET; retry is GET only; success also closes', async () => {
  let writes = 0, gets = 0, open = true;
  const write = async () => { writes++; };
  const close = () => { open = false; };
  const refresh = async () => { gets++; assert.equal(open, false); return false; };
  assert.equal(await saveRackAndRefresh(write, close, refresh), false);
  assert.equal(writes, 1); assert.equal(gets, 1);
  await refresh(); assert.equal(writes, 1); assert.equal(gets, 2);
  open = true;
  assert.equal(await saveRackAndRefresh(write, close, async () => true), true);
  assert.equal(open, false);
});

test('failed write preserves form and does not refresh or report success', async () => {
  let open = true, gets = 0;
  await assert.rejects(() => saveRackAndRefresh(async () => { throw new Error('409'); }, () => { open = false; }, async () => { gets++; return true; }));
  assert.equal(open, true); assert.equal(gets, 0);
});
