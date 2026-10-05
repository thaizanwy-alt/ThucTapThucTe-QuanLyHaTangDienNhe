const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const loadTs = relative => {
  const filename = path.resolve(__dirname, relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded._compile(compiled, filename);
  return loaded.exports;
};
const { availableFaces, allowedKinds, connectionFaceChoices, missingFaceLabel, portPayload, networkProfilePayload,
  poeLabel, vlanLabel, hasDuplicateIpWarning, supportsDevicePorts } = loadTs('../src/connection-form.ts');
const { saveDeviceAndNotify } = loadTs('../src/device-refresh.ts');
const { invalidateTraceRequest, visibleTrace } = loadTs('../src/trace-request.ts');

const device = (id, type) => ({ id, code: id.toUpperCase(), type });
const port = (id, deviceId, sides) => ({ id, deviceId, code: id.toUpperCase(), sides: sides.map(([side, connectionId = null]) => ({ side, connectionId })) });

test('new rack equipment is never offered a physical RJ45 port', () => {
  for (const type of ['RACK', 'UPS', 'PDU', 'NVR', 'ROUTER', 'ODF', 'CABLE_MANAGER', 'SHELF']) assert.equal(supportsDevicePorts(type), false);
  for (const type of ['SWITCH', 'PATCH_PANEL', 'NETWORK_OUTLET', 'CAMERA', 'AP']) assert.equal(supportsDevicePorts(type), true);
});

test('free faces expose FRONT/REAR/SINGLE and own connection during rewire, never another occupied face', () => {
  const devices = [device('cam', 'CAMERA'), device('panel', 'PATCH_PANEL'), device('sw', 'SWITCH')];
  const ports = [port('c1', 'cam', [['SINGLE', 'own']]), port('p1', 'panel', [['FRONT', 'other'], ['REAR', 'own']]),
    port('s1', 'sw', [['SINGLE']])];
  assert.deepEqual(availableFaces(devices, ports).map(face => face.key), ['s1:SINGLE']);
  assert.deepEqual(availableFaces(devices, ports, 'own').map(face => face.key), ['c1:SINGLE', 'p1:REAR', 's1:SINGLE']);
});

test('only backend-supported device/side pairings and cable kinds are offered', () => {
  const faces = availableFaces(
    [device('cam', 'CAMERA'), device('ap', 'AP'), device('out', 'NETWORK_OUTLET'), device('panel', 'PATCH_PANEL'), device('sw', 'SWITCH')],
    [port('cam-p', 'cam', [['SINGLE']]), port('ap-p', 'ap', [['SINGLE']]), port('out-p', 'out', [['FRONT'], ['REAR']]),
      port('panel-p', 'panel', [['FRONT'], ['REAR']]), port('sw-p', 'sw', [['SINGLE']])],
  );
  const face = key => faces.find(item => item.key === key);
  const kinds = (a, b) => allowedKinds(face(a), face(b));
  assert.deepEqual(kinds('cam-p:SINGLE', 'sw-p:SINGLE'), ['FIXED', 'PATCH']);
  assert.deepEqual(kinds('cam-p:SINGLE', 'panel-p:REAR'), ['FIXED']);
  assert.deepEqual(kinds('ap-p:SINGLE', 'out-p:FRONT'), ['PATCH']);
  assert.deepEqual(kinds('out-p:REAR', 'panel-p:REAR'), ['FIXED']);
  assert.deepEqual(kinds('panel-p:FRONT', 'sw-p:SINGLE'), ['PATCH']);
  assert.deepEqual(kinds('sw-p:SINGLE', 'panel-p:FRONT'), ['PATCH']);
  assert.deepEqual(kinds('cam-p:SINGLE', 'out-p:REAR'), []);
  assert.deepEqual(kinds('out-p:FRONT', 'sw-p:SINGLE'), []);
  assert.deepEqual(kinds('panel-p:FRONT', 'panel-p:REAR'), []);
});

test('connect button and form share one pair selector; two free switch ports are not enough', () => {
  const switches = [device('sw-1', 'SWITCH'), device('sw-2', 'SWITCH')];
  const switchPorts = [port('p-1', 'sw-1', [['SINGLE']]), port('p-2', 'sw-2', [['SINGLE']])];
  assert.equal(connectionFaceChoices(switches, switchPorts).firstOptions.length, 0);
  assert.ok(connectionFaceChoices([...switches, device('cam', 'CAMERA')],
    [...switchPorts, port('eth1', 'cam', [['SINGLE']])]).firstOptions.length > 0);
});

test('missing trace face identifies device, port and side, with safe fallback for deleted data', () => {
  const missing = { portId: 'p-02', side: 'FRONT' };
  assert.equal(missingFaceLabel(missing, [device('panel', 'PATCH_PANEL')], [port('p-02', 'panel', [['FRONT']])]),
    'PANEL / P-02 / Trước');
  assert.match(missingFaceLabel(missing, [], [port('p-02', 'panel', [['FRONT']])]), /thiết bị không còn trong danh sách \/ P-02 \/ Trước/);
  assert.match(missingFaceLabel(missing, [], []), /cổng không còn trong danh sách \(p-02\) \/ Trước/);
  assert.equal(missingFaceLabel(null, [], []), 'mặt cổng chưa xác định');
});

test('successful Device write notifies connections before its own GET, even if that GET fails', async () => {
  const steps = [];
  await saveDeviceAndNotify(async () => { steps.push('POST accepted'); }, () => steps.push('notify connections'));
  await assert.rejects(async () => { steps.push('GET failed'); throw new Error('GET failed'); });
  assert.deepEqual(steps, ['POST accepted', 'notify connections', 'GET failed']);
  let notifications = 0;
  await assert.rejects(saveDeviceAndNotify(async () => { throw new Error('POST failed'); }, () => { notifications++; }));
  assert.equal(notifications, 0);
});

test('device refresh invalidates a late trace and retry cannot revive the old result', async () => {
  const request = { current: 0 };
  let resolveTrace;
  const response = new Promise(resolve => { resolveTrace = resolve; });
  let displayed = { revision: 1, value: { device: { code: 'CAM-OLD' } } };
  assert.equal(visibleTrace(displayed, 2), null); // hidden on the first render after revision changes
  const started = ++request.current;
  const pending = response.then(value => { if (started === request.current) displayed = { revision: 1, value }; });
  invalidateTraceRequest(request); displayed = null; // deviceRevision starts a GET
  resolveTrace({ device: { code: 'CAM-LATE' } });
  await pending;
  assert.equal(visibleTrace(displayed, 2), null);
  invalidateTraceRequest(request); displayed = null; // failed GET, then retry GET
  assert.equal(visibleTrace(displayed, 2), null);
});

test('port form normalizes code and preserves unknown VLAN/PoE versus false', () => {
  assert.deepEqual(portPayload(' p-01 ', ' Gi1/0/1 ', true, '', ''),
    { code: 'P-01', description: 'Gi1/0/1', accessVlanId: null, poeEnabled: null });
  assert.deepEqual(portPayload('ETH1', '', true, '4094', 'false'),
    { code: 'ETH1', description: null, accessVlanId: 4094, poeEnabled: false });
  assert.deepEqual(portPayload('P01', '', false, '10', 'true'), { code: 'P01', description: null });
  for (const vlan of ['0', '4095', '1.5', 'abc']) assert.throws(() => portPayload('P01', '', true, vlan, ''));
  assert.throws(() => portPayload('P 01', '', false, '', ''));
  assert.equal(vlanLabel(null), 'Chưa biết');
  assert.equal(poeLabel(null), 'Chưa biết');
  assert.equal(poeLabel(false), 'Tắt');
});

test('network profile PUT always sends three nullable keys and duplicate IP is a warning, not a blocker', () => {
  assert.deepEqual(networkProfilePayload('', '', ''), { addressMode: null, ipAddress: null, macAddress: null });
  assert.deepEqual(networkProfilePayload('STATIC', ' 192.168.1.20 ', ' aa:bb:cc:dd:ee:ff '),
    { addressMode: 'STATIC', ipAddress: '192.168.1.20', macAddress: 'AA:BB:CC:DD:EE:FF' });
  assert.deepEqual(networkProfilePayload('DHCP', '', ''), { addressMode: 'DHCP', ipAddress: null, macAddress: null });
  assert.throws(() => networkProfilePayload('', '192.168.1.20', ''));
  assert.throws(() => networkProfilePayload('BOGUS', '', ''));
  assert.throws(() => networkProfilePayload('STATIC', '999.1.1.1', ''));
  assert.throws(() => networkProfilePayload('STATIC', '', 'not-a-mac'));
  assert.equal(hasDuplicateIpWarning(['DUPLICATE_IP_IN_PROJECT']), true);
  assert.equal(hasDuplicateIpWarning([]), false);
  assert.equal(hasDuplicateIpWarning(undefined), false);
});
