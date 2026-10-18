const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
const { DevicesService } = require('../dist/devices/devices.service.js');
const { ProjectDevice } = require('../dist/devices/project-device.entity.js');
const { DeviceType } = require('../dist/devices/device-type.enum.js');
const { UserRole } = require('../dist/users/user-role.enum.js');

const rejectsStatus = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);

async function expectCode(runner, sql, parameters, codes) {
  await runner.query('SAVEPOINT device_constraint_check');
  try {
    await assert.rejects(runner.query(sql, parameters), error => codes.includes(error.driverError?.code ?? error.code));
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT device_constraint_check');
    await runner.query('RELEASE SAVEPOINT device_constraint_check');
  }
}

test('ProjectDevice service, composite FK and transactions use an owned disposable PostgreSQL database', { timeout: 180000 }, async t => {
  await withDisposableHttpDb('devices', async (dataSource, verify) => {
  const runner = dataSource.createQueryRunner();
  let failure;
  try {
    await runner.connect();
    await verify(runner);
    await runner.startTransaction();
    const [actor] = await runner.query('INSERT INTO users (email,password_hash,role,is_active) VALUES ($1,$2,$3,true) RETURNING id,email',
      [`device-manager-${randomUUID()}@example.invalid`, randomUUID(), UserRole.MANAGER]);
    const suffix = randomUUID().replaceAll('-', '').toUpperCase();
    const project = async tag => (await runner.query('INSERT INTO projects (code,name) VALUES ($1,$2) RETURNING id', [`DEVICE-DB-${tag}-${suffix}`, `Device DB ${tag}`]))[0].id;
    const projectId = await project('A');
    const otherProjectId = await project('B');
    const area = async (id, tag) => (await runner.query(`INSERT INTO project_areas (project_id,type,code,name) VALUES ($1,'FLOOR',$2,$2) RETURNING id`, [id, tag]))[0].id;
    const areaId = await area(projectId, 'F-01');
    const nextAreaId = await area(projectId, 'F-02');
    const otherAreaId = await area(otherProjectId, 'F-01');
    const system = async (id, tag, category) => (await runner.query('INSERT INTO project_systems (project_id,code,name,category) VALUES ($1,$2,$2,$3) RETURNING id', [id, tag, category]))[0].id;
    const lanId = await system(projectId, 'LAN-01', 'LAN');
    const wifiId = await system(projectId, 'WIFI-01', 'WIFI');
    const secondLanId = await system(projectId, 'LAN-02', 'LAN');
    const otherSystemId = await system(otherProjectId, 'LAN-01', 'LAN');
    // Service transactions use nested PostgreSQL savepoints inside this fixture transaction.
    const service = new DevicesService({ transaction: (...args) => runner.manager.transaction(...args) });
    const manager = { ...actor, role: UserRole.MANAGER, isActive: true };
    const create = (code, type, extra = {}, id = projectId) => service.createDevice(id, { code, name: `Device ${code}`, type, ...extra }, manager);
    const rack = await create(' rack-01 ', DeviceType.RACK, { areaId, capacityU: 42, systemIds: [lanId] });
    const otherRack = await create('RACK-01', DeviceType.RACK, {}, otherProjectId);
    const sw = await create('SW-01', DeviceType.SWITCH, { rackId: rack.id, systemIds: [lanId, wifiId, secondLanId], brand: ' Brand ' });

    await t.test('six types, normalized labels, many systems and inherited location', async () => {
      assert.equal(rack.code, 'RACK-01');
      assert.equal(sw.brand, 'Brand');
      assert.deepEqual(sw.systemIds, [lanId, wifiId, secondLanId].sort());
      assert.equal(sw.areaId, null);
      assert.equal(sw.effectiveAreaId, areaId);
      for (const type of [DeviceType.PATCH_PANEL, DeviceType.NETWORK_OUTLET, DeviceType.AP, DeviceType.CAMERA]) {
        const created = await create(type.replaceAll('_', '-'), type, { areaId });
        assert.equal(created.type, type);
        assert.deepEqual(created.systemIds, []);
      }
      const rows = await service.listDevices(projectId);
      assert.deepEqual(rows.map(row => row.code), [...rows.map(row => row.code)].sort());
      await service.updateDevice(projectId, rack.id, { areaId: nextAreaId }, manager);
      assert.equal((await service.getDevice(projectId, sw.id)).effectiveAreaId, nextAreaId);
    });

    await t.test('cross-project/missing links return 404; type, location and capacity rules return 400', async () => {
      await rejectsStatus(service.getDevice(otherProjectId, sw.id), 404);
      await rejectsStatus(service.listDevices(randomUUID()), 404);
      await rejectsStatus(service.updateDevice(otherProjectId, sw.id, { name: 'X' }, manager), 404);
      await rejectsStatus(service.deleteDevice(otherProjectId, sw.id, manager), 404);
      for (const extra of [{ areaId: otherAreaId }, { rackId: otherRack.id }, { systemIds: [otherSystemId] }]) {
        await rejectsStatus(create('CROSS', DeviceType.SWITCH, extra), 404);
      }
      await rejectsStatus(create('NOT-RACK', DeviceType.SWITCH, { rackId: sw.id }), 400);
      await rejectsStatus(create('BOTH', DeviceType.SWITCH, { rackId: rack.id, areaId }), 400);
      for (const type of [DeviceType.RACK, DeviceType.AP, DeviceType.CAMERA, DeviceType.NETWORK_OUTLET]) {
        await rejectsStatus(create('BAD', type, { rackId: rack.id }), 400);
      }
      await rejectsStatus(create('BAD-U', DeviceType.SWITCH, { capacityU: 1 }), 400);
      await rejectsStatus(service.updateDevice(projectId, sw.id, { type: DeviceType.RACK }, manager), 400);
    });

    await t.test('location moves validate final state atomically; memberships replace only when provided', async () => {
      await rejectsStatus(service.updateDevice(projectId, sw.id, { areaId }, manager), 400);
      assert.equal((await service.getDevice(projectId, sw.id)).rackId, rack.id);
      const direct = await service.updateDevice(projectId, sw.id, { rackId: null, areaId, description: null }, manager);
      assert.equal(direct.effectiveAreaId, areaId);
      assert.deepEqual(direct.systemIds, [lanId, wifiId, secondLanId].sort());
      const moved = await service.updateDevice(projectId, sw.id, { areaId: null, rackId: rack.id, systemIds: [wifiId] }, manager);
      assert.equal(moved.effectiveAreaId, nextAreaId);
      assert.deepEqual(moved.systemIds, [wifiId]);
      const cleared = await service.updateDevice(projectId, sw.id, { systemIds: [] }, manager);
      assert.deepEqual(cleared.systemIds, []);
      assert.ok(cleared.updatedAt > moved.updatedAt, 'membership-only edits advance updatedAt');
      await service.updateDevice(projectId, sw.id, { systemIds: [lanId] }, manager);
    });

    await t.test('late FK failure rolls back device changes and deleted memberships', async () => {
      const nonexistentId = randomUUID();
      // Force a real FK failure during INSERT, after validation, device save and membership DELETE.
      await verify(runner);
      await runner.query(`CREATE FUNCTION pg_temp.fail_device_membership() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.project_id = '${projectId}'::uuid AND NEW.system_id = '${wifiId}'::uuid THEN
            NEW.system_id := '${nonexistentId}'::uuid;
          END IF;
          RETURN NEW;
        END $$`);
      await verify(runner);
      await runner.query('CREATE TRIGGER device_membership_test BEFORE INSERT ON project_device_systems FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_device_membership()');
      try {
        await rejectsStatus(service.updateDevice(projectId, sw.id, { name: 'Must roll back', rackId: null, areaId, systemIds: [wifiId] }, manager), 409);
        const unchanged = await service.getDevice(projectId, sw.id);
        assert.equal(unchanged.name, 'Device SW-01');
        assert.equal(unchanged.rackId, rack.id);
        assert.equal(unchanged.areaId, null);
        assert.deepEqual(unchanged.systemIds, [lanId]);
        await rejectsStatus(create('ROLLBACK-CREATE', DeviceType.AP, { systemIds: [wifiId] }), 409);
        assert.equal(await runner.manager.getRepository(ProjectDevice).countBy({ projectId, code: 'ROLLBACK-CREATE' }), 0);
      } finally {
        await verify(runner);
        await runner.query('DROP TRIGGER device_membership_test ON project_device_systems');
        await verify(runner);
        await runner.query('DROP FUNCTION pg_temp.fail_device_membership()');
      }
    });

    await t.test('database enforces cross-project FK, unique label, CHECKs and RESTRICT', async () => {
      const insert = `INSERT INTO project_devices (project_id,type,code,name,area_id,rack_id) VALUES ($1,'SWITCH',$2,'Raw',$3,$4)`;
      await expectCode(runner, insert, [projectId, 'RAW-A', otherAreaId, null], ['23503']);
      await expectCode(runner, insert, [projectId, 'RAW-R', null, otherRack.id], ['23503']);
      await expectCode(runner, insert, [projectId, 'SW-01', null, null], ['23505']);
      await expectCode(runner, insert, [projectId, 'RAW-BOTH', areaId, rack.id], ['23514']);
      await expectCode(runner, 'INSERT INTO project_device_systems VALUES ($1,$2,$3)', [projectId, sw.id, otherSystemId], ['23503']);
      await expectCode(runner, 'INSERT INTO project_device_systems VALUES ($1,$2,$3)', [otherProjectId, sw.id, otherSystemId], ['23503']);
      await expectCode(runner, 'DELETE FROM project_devices WHERE id=$1', [rack.id], ['23503', '23001']);
      await expectCode(runner, 'DELETE FROM project_devices WHERE id=$1', [sw.id], ['23503', '23001']);
      await expectCode(runner, 'DELETE FROM project_systems WHERE id=$1', [lanId], ['23503', '23001']);
      await expectCode(runner, 'DELETE FROM project_areas WHERE id=$1', [nextAreaId], ['23503', '23001']);
    });

    await t.test('unique/dependency conflicts preserve data; device deletion removes only its memberships', async () => {
      await rejectsStatus(create(' sw-01 ', DeviceType.CAMERA), 409);
      await rejectsStatus(service.updateDevice(projectId, sw.id, { code: 'RACK-01', systemIds: [] }, manager), 409);
      assert.deepEqual((await service.getDevice(projectId, sw.id)).systemIds, [lanId]);
      await rejectsStatus(service.deleteDevice(projectId, rack.id, manager), 409);
      assert.deepEqual((await service.getDevice(projectId, rack.id)).systemIds, [lanId]);
      await service.deleteDevice(projectId, sw.id, manager);
      await rejectsStatus(service.getDevice(projectId, sw.id), 404);
      assert.equal((await runner.query('SELECT COUNT(*)::int AS count FROM project_device_systems WHERE device_id=$1', [sw.id]))[0].count, 0);
      assert.deepEqual((await service.getDevice(projectId, rack.id)).systemIds, [lanId]);
      await service.deleteDevice(projectId, rack.id, manager);
    });
  } catch (error) { failure = error; }
  finally {
    const errors = [];
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); } catch (error) { errors.push(error); }
    try { await runner.release(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Device fixture cleanup failed', { cause: failure ?? errors[0] });
  }
  if (failure) throw failure;
  });
});
