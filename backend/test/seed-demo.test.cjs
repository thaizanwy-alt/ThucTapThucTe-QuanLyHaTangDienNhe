const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { main, requireManagedProject, assertDeviceFixture, PROJECT_CODE, MARKER } = require('../scripts/seed-demo.cjs');

test('demo seed refuses an existing project code without its ownership marker', () => {
  assert.throws(() => requireManagedProject({ description: 'Công trình của người dùng', status: 'IN_PROGRESS' }),
    new RegExp(`${PROJECT_CODE} already exists`));
  assert.throws(() => requireManagedProject({ description: MARKER, status: 'COMPLETED' }), /status was changed/);
  assert.doesNotThrow(() => requireManagedProject({ description: MARKER, status: 'IN_PROGRESS' }));
});

test('device fixture comparison normalizes null, UUID case and system order, but rejects optional-field drift', () => {
  const areaId = randomUUID();
  const systemIds = [randomUUID(), randomUUID()];
  const expected = {
    code: 'RACK-CORE', type: 'RACK', name: 'Demo rack', areaId, rackId: null,
    systemIds, description: 'Demo description', capacityU: 42,
    brand: null, model: null, serialNumber: null, locationNote: null,
  };
  const existing = { ...expected, areaId: areaId.toUpperCase(), systemIds: [...systemIds].reverse(), brand: undefined };
  assert.doesNotThrow(() => assertDeviceFixture(existing, expected));
  for (const field of ['description', 'capacityU', 'brand', 'model', 'serialNumber', 'locationNote']) {
    const changed = { ...existing, [field]: field === 'capacityU' ? 24 : 'Changed' };
    assert.throws(() => assertDeviceFixture(changed, expected), /Device code RACK-CORE conflicts/);
  }
  assert.throws(() => assertDeviceFixture({ ...existing, systemIds: [systemIds[0]] }, expected), /conflicts/);
  assert.throws(() => assertDeviceFixture({ ...existing, areaId: randomUUID() }, expected), /conflicts/);
});

for (const changedField of ['description', 'capacityU']) {
  test(`seed preflight refuses matching Device code with changed ${changedField} before dependent writes`, async () => {
    const projectId = randomUUID();
    const areaId = randomUUID();
    const systemIds = [randomUUID(), randomUUID(), randomUUID()];
    const technicianId = randomUUID();
    const managerToken = randomUUID();
    const technicianToken = randomUUID();
    const calls = [];
    const rack = {
      id: randomUUID(), projectId, code: 'RACK-CORE', type: 'RACK',
      name: 'Tủ rack trung tâm — tầng 1', areaId, rackId: null, capacityU: 42,
      systemIds, description: 'Thiết bị demo — không đại diện hiện trạng thực',
      brand: null, model: null, serialNumber: null, locationNote: null,
      [changedField]: changedField === 'capacityU' ? 24 : 'Different description',
    };
    const fetchImpl = async (url, init) => {
      const route = new URL(url).pathname;
      calls.push({ method: init.method, route });
      let result;
      if (route === '/health') result = { status: 'ok', database: 'connected' };
      else if (route === '/auth/login') {
        const { email } = JSON.parse(init.body);
        result = { accessToken: email.startsWith('manager') ? managerToken : technicianToken };
      } else if (route === '/auth/me') {
        result = init.headers.Authorization === `Bearer ${managerToken}`
          ? { id: randomUUID(), role: 'MANAGER' }
          : { id: technicianId, role: 'TECHNICIAN' };
      } else if (route === '/users/technicians') result = [{ id: technicianId }];
      else if (route === '/projects') result = [{ id: projectId, code: PROJECT_CODE, description: MARKER, status: 'IN_PROGRESS' }];
      else if (route === `/projects/${projectId}/areas`) result = [{ id: areaId, code: 'T01-KT' }];
      else if (route === `/projects/${projectId}/systems`) result = ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING']
        .map((code, index) => ({ id: systemIds[index], code }));
      else if (route === `/projects/${projectId}/devices`) result = [rack];
      else throw new Error(`Unexpected API route ${route}`);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const envOverride = {
      DEMO_API_URL: 'http://127.0.0.1:3000',
      DEMO_MANAGER_PASSWORD: randomUUID(), DEMO_TECHNICIAN_PASSWORD: randomUUID(),
      DEMO_MANAGER_EMAIL: 'manager.demo@example.local', DEMO_TECHNICIAN_EMAIL: 'technician.demo@example.local',
    };
    await assert.rejects(main({ envOverride, fetchImpl }), /Device code RACK-CORE conflicts/);
    assert.equal(calls.filter(({ method, route }) => method !== 'GET' && route !== '/auth/login').length, 0);
  });
}
