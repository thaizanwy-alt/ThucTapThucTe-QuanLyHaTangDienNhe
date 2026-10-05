const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load the actual pure form logic without adding a test runner or changing the app build.
const filename = path.resolve(__dirname, '../src/device-form.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { deviceDraft, deviceLabels, devicePayload } = loaded.exports;
const valid = () => ({ ...deviceDraft(), code: ' dev-01 ', name: ' Thiết bị ' });

test('thirteen types; code/name normalized; optional empty text is nullable', () => {
  assert.equal(Object.keys(deviceLabels).length, 13);
  for (const type of Object.keys(deviceLabels)) {
    const input = devicePayload({ ...valid(), type, brand: ' Hãng ' }, false);
    assert.equal(input.type, type);
    assert.equal(input.code, 'DEV-01');
    assert.equal(input.name, 'Thiết bị');
    assert.equal(input.brand, 'Hãng');
    assert.equal(input.description, null);
  }
});

test('PATCH excludes immutable type, replaces all systems and clears the old placement atomically', () => {
  const base = { ...valid(), type: 'SWITCH', areaId: 'area-a', rackId: 'rack-a', systemIds: ['sys-a', 'sys-b'] };
  const rack = devicePayload({ ...base, placement: 'rack' }, true);
  assert.equal(rack.rackId, 'rack-a');
  assert.equal(rack.areaId, null);
  assert.equal('type' in rack, false);
  assert.deepEqual(rack.systemIds, ['sys-a', 'sys-b']);
  const direct = devicePayload({ ...base, placement: 'area', systemIds: [] }, true);
  assert.equal(direct.areaId, 'area-a');
  assert.equal(direct.rackId, null);
  assert.deepEqual(direct.systemIds, []);
  const unplaced = devicePayload({ ...base, placement: 'none' }, true);
  assert.equal(unplaced.areaId, null);
  assert.equal(unplaced.rackId, null);
});

test('rack placement requires a rack and permits only rackable types; area requires selection', () => {
  for (const type of ['RACK', 'AP', 'CAMERA', 'NETWORK_OUTLET']) {
    assert.throws(() => devicePayload({ ...valid(), type, placement: 'rack', rackId: 'rack-a' }, false));
  }
  assert.throws(() => devicePayload({ ...valid(), type: 'SWITCH', placement: 'rack' }, false));
  assert.throws(() => devicePayload({ ...valid(), placement: 'area' }, false));
  for (const type of ['SWITCH', 'PATCH_PANEL', 'UPS', 'PDU', 'NVR', 'ROUTER', 'ODF', 'CABLE_MANAGER', 'SHELF']) {
    assert.equal(devicePayload({ ...valid(), type, placement: 'rack', rackId: 'rack-a' }, false).rackId, 'rack-a');
  }
});

test('capacityU boundaries; non-rack always clears capacity; malformed code/blank name rejected', () => {
  for (const capacityU of ['1', '2147483647']) assert.equal(devicePayload({ ...valid(), capacityU }, false).capacityU, Number(capacityU));
  for (const capacityU of ['0', '-1', '1.5', '2147483648', 'oops']) assert.throws(() => devicePayload({ ...valid(), capacityU }, false));
  assert.equal(devicePayload({ ...valid(), capacityU: '' }, false).capacityU, null);
  assert.equal(devicePayload({ ...valid(), type: 'AP', capacityU: '42' }, false).capacityU, null);
  for (const code of ['', 'A--B', 'A B', '-ABC']) assert.throws(() => devicePayload({ ...valid(), code }, false));
  assert.throws(() => devicePayload({ ...valid(), name: '  ' }, false));
});

test('edit draft retains rack placement, optional values and systems without mutating API response', () => {
  const device = { type: 'SWITCH', code: 'SW-01', name: 'Switch', rackId: 'rack-a', areaId: null,
    capacityU: null, brand: 'Hãng', model: 'Model', serialNumber: 'Serial', description: 'Ghi chú',
    locationNote: 'Vị trí', systemIds: ['sys-a'] };
  const draft = deviceDraft(device);
  assert.equal(draft.placement, 'rack');
  assert.equal(draft.rackId, 'rack-a');
  assert.equal(draft.brand, 'Hãng');
  draft.systemIds.push('sys-b');
  assert.deepEqual(device.systemIds, ['sys-a']);
});
