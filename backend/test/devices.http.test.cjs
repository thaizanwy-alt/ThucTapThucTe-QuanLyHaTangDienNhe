const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module.js');
const { User } = require('../dist/users/user.entity.js');
const { UserRole } = require('../dist/users/user-role.enum.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');

test('Nest starts with PostgreSQL; Device HTTP CRUD, roles, validation and concurrent placement work', async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const fixtureProjectIds = [];
  try {
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const database = app.get(DataSource);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', database: 'connected' });
    const manager = await database.getRepository(User).findOneBy({ role: UserRole.MANAGER, isActive: true });
    const technician = await database.getRepository(User).findOneBy({ role: UserRole.TECHNICIAN, isActive: true });
    assert.ok(manager && technician, 'Local DB requires active manager and technician');
    const jwt = app.get(JwtService);
    const auth = async user => ({ Authorization: `Bearer ${await jwt.signAsync({ sub: user.id })}` });
    const managerHeaders = await auth(manager);
    const technicianHeaders = await auth(technician);
    const suffix = randomUUID().toUpperCase();
    const projects = database.getRepository(Project);
    for (const tag of ['A', 'B']) {
      const project = await projects.save(projects.create({ code: `DEVICE-HTTP-${tag}-${suffix}`, name: `HTTP fixture ${tag}` }));
      fixtureProjectIds.push(project.id);
    }
    const [projectId, otherProjectId] = fixtureProjectIds;
    const areas = database.getRepository(ProjectArea);
    const area = await areas.save(areas.create({ projectId, type: 'FLOOR', code: 'F-01', name: 'Floor', sortOrder: 0 }));
    const systems = database.getRepository(ProjectSystem);
    const lan = await systems.save(systems.create({ projectId, code: 'LAN-01', name: 'LAN', category: 'LAN' }));
    const wifi = await systems.save(systems.create({ projectId, code: 'WIFI-01', name: 'WiFi', category: 'WIFI' }));
    const otherSystem = await systems.save(systems.create({ projectId: otherProjectId, code: 'LAN-01', name: 'Other', category: 'LAN' }));
    const path = `/projects/${projectId}/devices`;
    const request = async (method, url, body, headers = managerHeaders) => fetch(`${base}${url}`, {
      method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = async (method, url, body, expected, headers = managerHeaders) => {
      const response = await request(method, url, body, headers);
      assert.equal(response.status, expected, `${method} ${url}: ${response.status}`);
      return expected === 204 ? null : response.json();
    };
    await result('GET', path, undefined, 401, {});
    await result('GET', '/projects/bad-id/devices', undefined, 400);
    await result('GET', `/projects/${randomUUID()}/devices`, undefined, 404);
    assert.deepEqual(await result('GET', path, undefined, 200), []);
    await result('POST', path, {}, 403, technicianHeaders);
    const overflowInput = { type: 'RACK', code: 'R-OVERFLOW', name: 'Overflow', capacityU: 2147483648 };
    await result('POST', path, overflowInput, 400);
    // Invalid capacity is rejected before service project lookup/transaction (which would return 404).
    await result('POST', `/projects/${randomUUID()}/devices`, overflowInput, 400);
    assert.deepEqual(await result('GET', path, undefined, 200), []);
    const rack = await result('POST', path, { type: 'RACK', code: ' rack-01 ', name: ' Rack ', areaId: area.id, capacityU: 2147483647 }, 201);
    assert.equal(rack.code, 'RACK-01');
    assert.equal(rack.name, 'Rack');
    assert.equal(rack.capacityU, 2147483647);
    await result('PATCH', `${path}/${rack.id}`, { capacityU: 2147483648 }, 400);
    await result('PATCH', `/projects/${randomUUID()}/devices/${randomUUID()}`, { capacityU: 2147483648 }, 400);
    assert.equal((await result('GET', `${path}/${rack.id}`, undefined, 200)).capacityU, 2147483647);
    assert.equal((await result('PATCH', `${path}/${rack.id}`, { capacityU: 1 }, 200)).capacityU, 1);
    assert.equal((await result('PATCH', `${path}/${rack.id}`, { capacityU: 2147483647 }, 200)).capacityU, 2147483647);
    // POST with uppercase rackId must resolve the same inherited location as subsequent GET.
    const sw = await result('POST', path, { type: 'SWITCH', code: 'SW-01', name: 'Switch', rackId: rack.id.toUpperCase(), systemIds: [lan.id, wifi.id] }, 201);
    assert.equal(sw.effectiveAreaId, area.id);
    assert.equal(sw.areaId, null);
    assert.deepEqual(sw.systemIds, [lan.id, wifi.id].sort());
    const item = `${path}/${sw.id}`;
    assert.equal((await result('GET', item, undefined, 200)).effectiveAreaId, sw.effectiveAreaId);
    for (const body of [{}, { code: null }, { name: null }, { type: 'AP' }, { type: null }, { systemIds: null }, { systemIds: [lan.id, lan.id] }, { capacityU: 0 }, { rackId: rack.id, areaId: area.id }]) {
      await result('PATCH', item, body, 400);
    }
    await result('PATCH', item, { name: 'No' }, 403, technicianHeaders);
    await result('DELETE', item, undefined, 403, technicianHeaders);
    await result('GET', `/projects/${otherProjectId}/devices/${sw.id}`, undefined, 404);
    await result('PATCH', item, { name: 'Not saved', systemIds: [otherSystem.id] }, 404);
    assert.equal((await result('GET', item, undefined, 200)).name, 'Switch');
    await result('POST', path, { type: 'AP', code: 'AP-01', name: 'AP', rackId: rack.id }, 400);
    await result('POST', path, { type: 'CAMERA', code: ' sw-01 ', name: 'Duplicate' }, 409);
    const direct = await result('PATCH', item, { rackId: null, areaId: area.id, systemIds: [wifi.id] }, 200);
    assert.equal(direct.rackId, null);
    assert.equal(direct.effectiveAreaId, area.id);
    assert.deepEqual(direct.systemIds, [wifi.id]);
    // PATCH back into the rack with uppercase UUID must also return its inherited location.
    const returned = await result('PATCH', item, { rackId: rack.id.toUpperCase(), areaId: null, description: null, systemIds: [] }, 200);
    assert.equal(returned.effectiveAreaId, area.id);
    assert.deepEqual(returned.systemIds, []);
    assert.equal((await result('GET', item, undefined, 200)).effectiveAreaId, returned.effectiveAreaId);
    await result('PATCH', item, { systemIds: [lan.id] }, 200);
    await result('DELETE', `${path}/${rack.id}`, undefined, 409);
    await result('DELETE', `/projects/${projectId}/areas/${area.id}`, undefined, 409);
    await result('DELETE', `/projects/${projectId}/systems/${lan.id}`, undefined, 409);
    const technicianList = await result('GET', path, undefined, 200, technicianHeaders);
    assert.equal(technicianList.length, 2);
    assert.ok(technicianList.every(device => !('passwordHash' in device)));
    assert.equal((await result('GET', item, undefined, 200, technicianHeaders)).id, sw.id);

    const concurrent = await result('POST', path, { type: 'SWITCH', code: 'SW-02', name: 'Concurrent' }, 201);
    const race = await Promise.all([
      request('PATCH', `${path}/${concurrent.id}`, { areaId: area.id }),
      request('PATCH', `${path}/${concurrent.id}`, { rackId: rack.id }),
    ]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 400]);
    const final = await result('GET', `${path}/${concurrent.id}`, undefined, 200);
    assert.notEqual(final.areaId !== null, final.rackId !== null);
    await result('DELETE', `${path}/${concurrent.id}`, undefined, 204);
    await result('DELETE', item, undefined, 204);
    await result('GET', item, undefined, 404);
    await result('DELETE', `${path}/${rack.id}`, undefined, 204);
    assert.deepEqual(await result('GET', path, undefined, 200), []);
  } finally {
    // Only remove the UUID-scoped fixture projects created above; existing data is untouched.
    if (fixtureProjectIds.length > 0) {
      await app.get(DataSource).transaction(async entityManager => {
        await entityManager.query('DELETE FROM project_device_systems WHERE project_id = ANY($1::uuid[])', [fixtureProjectIds]);
        await entityManager.query('DELETE FROM project_devices WHERE project_id = ANY($1::uuid[]) AND rack_id IS NOT NULL', [fixtureProjectIds]);
        await entityManager.query('DELETE FROM project_devices WHERE project_id = ANY($1::uuid[])', [fixtureProjectIds]);
        await entityManager.query('DELETE FROM project_systems WHERE project_id = ANY($1::uuid[])', [fixtureProjectIds]);
        await entityManager.query('DELETE FROM project_areas WHERE project_id = ANY($1::uuid[])', [fixtureProjectIds]);
        await entityManager.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [fixtureProjectIds]);
      });
    }
    await app.close();
  }
});
