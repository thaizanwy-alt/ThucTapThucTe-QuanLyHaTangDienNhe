// Uses only a disposable database; the demo database and its fixtures are not changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource: localSource } = require('../dist/database/data-source.js');
const { DevicesService } = require('../dist/devices/devices.service.js');
const { RacksService } = require('../dist/devices/racks.service.js');
const { ConnectionsService } = require('../dist/connections/connections.service.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { User } = require('../dist/users/user.entity.js');

const rejectsStatus = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);
const placement = (rackId, startU, heightU, mountMode = 'U') =>
  ({ areaId: null, rackId, mountMode, startU, heightU });

test('Rack layout: migration, legacy data, roles, capacity, concurrency, HTTP guards and safe down', { timeout: 180000 }, async t => {
  const databaseName = 'rack_layout_test_' + randomUUID().replaceAll('-', '');
  assert.match(databaseName, /^rack_layout_test_[a-f0-9]{32}$/);
  const options = localSource.options;
  const admin = new Client({ host: options.host, port: options.port, user: options.username,
    password: options.password, database: options.database });
  const db = new DataSource({ ...options, database: databaseName });
  const oldName = process.env.DB_NAME;
  let created = false;
  let app;
  try {
    await admin.connect();
    await admin.query('CREATE DATABASE "' + databaseName + '"');
    created = true;
    await db.initialize();
    assert.equal(db.options.synchronize, false);
    await db.runMigrations();
    assert.equal(await db.showMigrations(), false);
    const projects = db.getRepository(Project);
    const first = await projects.save(projects.create({ code: 'RACK-A', name: 'Rack test A' }));
    const second = await projects.save(projects.create({ code: 'RACK-B', name: 'Rack test B' }));
    const areas = db.getRepository(ProjectArea);
    const floor = await areas.save(areas.create({ projectId: first.id, code: 'F01', name: 'Floor', type: 'FLOOR', sortOrder: 0 }));
    const room = await areas.save(areas.create({ projectId: first.id, code: 'F01-R01', name: 'Room', type: 'ROOM', parentId: floor.id, sortOrder: 0 }));
    const otherArea = await areas.save(areas.create({ projectId: second.id, code: 'F01', name: 'Other floor', type: 'FLOOR', sortOrder: 0 }));
    const manager = { role: 'MANAGER' };
    const technician = { role: 'TECHNICIAN' };
    const devices = new DevicesService(db);
    const racks = new RacksService(db);
    const connections = new ConnectionsService(db);
    const dev = (code, type, extra = {}, projectId = first.id) =>
      devices.createDevice(projectId, { code, name: code, type, ...extra }, manager);
    const main = await dev('RACK-MAIN', 'RACK', { areaId: floor.id, capacityU: 10 });
    const sub = await dev('RACK-SUB', 'RACK', { areaId: room.id, capacityU: 6 });
    const anotherMain = await dev('RACK-ANOTHER', 'RACK', { areaId: floor.id, capacityU: 8 });
    const foreignMain = await dev('RACK-FOREIGN', 'RACK', { areaId: otherArea.id, capacityU: 8 }, second.id);
    const sw = await dev('SW-LEGACY', 'SWITCH', { rackId: main.id });

    await t.test('legacy racks and mounted devices remain unclassified and unplaced', async () => {
      assert.equal((await racks.listRacks(first.id)).length, 3);
      assert.equal((await racks.getLayout(first.id, main.id)).rack.rackRole, null);
      assert.deepEqual((await racks.getLayout(first.id, main.id)).unplaced.map(item => item.code), ['SW-LEGACY']);
      assert.equal((await devices.getDevice(first.id, sw.id)).mountMode, null);
    });

    await t.test('SQL writes reject NULL U height and served areas pointing to a non-rack', async () => {
      await assert.rejects(db.query(`UPDATE project_devices SET mount_mode='U', start_u=1, height_u=NULL WHERE id=$1`, [sw.id]),
        error => (error.driverError?.code ?? error.code) === '23514');
      await assert.rejects(db.query(`UPDATE project_devices SET mount_mode=NULL, start_u=1, height_u=1 WHERE id=$1`, [sw.id]),
        error => (error.driverError?.code ?? error.code) === '23514');
      await assert.rejects(db.query('INSERT INTO rack_served_areas VALUES ($1,$2,$3)', [first.id, sw.id, floor.id]),
        error => (error.driverError?.code ?? error.code) === '23503');
      const typeRack = await dev('RACK-TYPE-CHANGE', 'RACK');
      await db.query('INSERT INTO rack_served_areas VALUES ($1,$2,$3)', [first.id, typeRack.id, floor.id]);
      await assert.rejects(db.query(`UPDATE project_devices SET type='SWITCH' WHERE id=$1`, [typeRack.id]),
        error => (error.driverError?.code ?? error.code) === '23001');
      assert.equal((await db.query('SELECT type FROM project_devices WHERE id=$1', [typeRack.id]))[0].type, 'RACK');
    });

    await t.test('typed FK serializes concurrent served-area insert and Device.type change', { timeout: 15000 }, async () => {
      const errorCode = error => error.driverError?.code ?? error.code;
      const delay = () => new Promise(resolve => setTimeout(resolve, 50));
      const race = async (rackCode, firstStatement, secondStatement, expectedCode) => {
        const rack = await dev(rackCode, 'RACK');
        const values = statement => statement.includes('rack_served_areas')
          ? [first.id, rack.id, floor.id] : [first.id, rack.id];
        const firstRunner = db.createQueryRunner();
        const secondRunner = db.createQueryRunner();
        try {
          await firstRunner.connect(); await secondRunner.connect();
          await firstRunner.startTransaction(); await secondRunner.startTransaction();
          await firstRunner.query("SET LOCAL lock_timeout = '3s'");
          await secondRunner.query("SET LOCAL lock_timeout = '3s'");
          await firstRunner.query(firstStatement, values(firstStatement));
          const competing = secondRunner.query(secondStatement, values(secondStatement))
            .then(() => ({ success: true }), error => ({ success: false, code: errorCode(error) }));
          await delay();
          await firstRunner.commitTransaction();
          assert.deepEqual(await competing, { success: false, code: expectedCode });
          return rack;
        } finally {
          if (firstRunner.isTransactionActive) await firstRunner.rollbackTransaction();
          if (secondRunner.isTransactionActive) await secondRunner.rollbackTransaction();
          await firstRunner.release(); await secondRunner.release();
        }
      };
      const linked = await race('RACK-RACE-LINK-FIRST',
        'INSERT INTO rack_served_areas(project_id,rack_id,area_id) VALUES ($1,$2,$3)',
        "UPDATE project_devices SET type='SWITCH' WHERE project_id=$1 AND id=$2", '23001');
      assert.equal((await db.query('SELECT type FROM project_devices WHERE id=$1', [linked.id]))[0].type, 'RACK');
      const changed = await race('RACK-RACE-TYPE-FIRST',
        "UPDATE project_devices SET type='SWITCH' WHERE project_id=$1 AND id=$2",
        'INSERT INTO rack_served_areas(project_id,rack_id,area_id) VALUES ($1,$2,$3)', '23503');
      assert.equal((await db.query('SELECT type FROM project_devices WHERE id=$1', [changed.id]))[0].type, 'SWITCH');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM rack_served_areas WHERE rack_id=$1', [changed.id]))[0].count, 0);
    });

    await t.test('valid transactions create Rack then link Area, and unlink before deleting Area/Rack', { timeout: 10000 }, async () => {
      const temporaryArea = await areas.save(areas.create({ projectId: first.id, code: 'F-TRANSIENT',
        name: 'Transient floor', type: 'FLOOR', sortOrder: 0 }));
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await runner.startTransaction();
        await runner.query("SET LOCAL lock_timeout = '3s'");
        const rackId = (await runner.query(`INSERT INTO project_devices(project_id,type,code,name)
          VALUES ($1,'RACK','RACK-TRANSIENT','Transient rack') RETURNING id`, [first.id]))[0].id;
        await runner.query('INSERT INTO rack_served_areas(project_id,rack_id,area_id) VALUES ($1,$2,$3)',
          [first.id, rackId, temporaryArea.id]);
        await runner.commitTransaction();
        assert.equal((await db.query('SELECT count(*)::int AS count FROM rack_served_areas WHERE rack_id=$1', [rackId]))[0].count, 1);

        await runner.startTransaction();
        await runner.query("SET LOCAL lock_timeout = '3s'");
        await runner.query('DELETE FROM rack_served_areas WHERE project_id=$1 AND rack_id=$2', [first.id, rackId]);
        await runner.query('DELETE FROM project_areas WHERE project_id=$1 AND id=$2', [first.id, temporaryArea.id]);
        await runner.query('DELETE FROM project_devices WHERE project_id=$1 AND id=$2', [first.id, rackId]);
        await runner.commitTransaction();
        assert.equal((await db.query('SELECT count(*)::int AS count FROM project_devices WHERE id=$1', [rackId]))[0].count, 0);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    });

    await t.test('MAIN/SUB hierarchy, explicit served areas, same-project FK and restricted delete', async () => {
      await rejectsStatus(racks.updateRack(first.id, main.id, { rackRole: 'MAIN' }, manager), 400);
      const configured = await racks.updateRack(first.id, main.id,
        { rackRole: 'MAIN', parentRackId: null, areaId: floor.id, capacityU: 10, servedAreaIds: [floor.id] }, manager);
      assert.deepEqual(configured.servedAreaIds, [floor.id]);
      await racks.updateRack(first.id, anotherMain.id,
        { rackRole: 'MAIN', areaId: floor.id, capacityU: 8, servedAreaIds: [room.id] }, manager);
      await racks.updateRack(first.id, sub.id,
        { rackRole: 'SUB', parentRackId: main.id, areaId: room.id, capacityU: 6, servedAreaIds: [room.id] }, manager);
      assert.equal((await racks.getLayout(first.id, sub.id)).rack.parentRackId, main.id);
      await rejectsStatus(racks.updateRack(first.id, main.id, { rackRole: null }, manager), 409);
      await rejectsStatus(devices.deleteDevice(first.id, main.id, manager), 409);
      await rejectsStatus(racks.updateRack(first.id, sub.id, { parentRackId: foreignMain.id }, manager), 404);
      await rejectsStatus(racks.updateRack(first.id, sub.id, { servedAreaIds: [otherArea.id] }, manager), 404);
      await rejectsStatus(racks.updateRack(first.id, main.id, { parentRackId: sub.id }, manager), 400);
      await rejectsStatus(racks.updateRack(second.id, main.id, { capacityU: 9 }, manager), 404);
      await assert.rejects(db.query('INSERT INTO rack_served_areas VALUES ($1,$2,$3)', [first.id, main.id, otherArea.id]),
        error => (error.driverError?.code ?? error.code) === '23503');
      assert.deepEqual((await racks.getLayout(first.id, main.id)).rack.servedAreaIds, [floor.id]);
    });

    await t.test('U boundaries, overlap, unplaced list, ZERO_U PDU and explicit RJ45 whitelist', async () => {
      const panel = await dev('PP-01', 'PATCH_PANEL', { rackId: main.id });
      const pdu = await dev('PDU-01', 'PDU', { rackId: main.id });
      await assert.rejects(db.query(`UPDATE project_devices SET mount_mode='ZERO_U', start_u=NULL, height_u=NULL WHERE id=$1`, [pdu.id]),
        error => (error.driverError?.code ?? error.code) === '23514');
      const ups = await dev('UPS-01', 'UPS', { rackId: main.id });
      for (const type of ['NVR', 'ROUTER', 'ODF', 'CABLE_MANAGER', 'SHELF']) {
        const item = await dev(type.replaceAll('_', '-') + '-01', type, { rackId: anotherMain.id });
        await rejectsStatus(connections.createPort(first.id, item.id, { code: 'P01' }, manager), 400);
      }
      await rejectsStatus(connections.createPort(first.id, pdu.id, { code: 'P01' }, manager), 400);
      await racks.putPlacement(first.id, sw.id, placement(main.id, 1, 2), manager);
      await rejectsStatus(racks.putPlacement(first.id, panel.id, placement(main.id, 2, 1), manager), 409);
      await rejectsStatus(racks.putPlacement(first.id, panel.id, placement(main.id, 10, 2), manager), 409);
      await racks.putPlacement(first.id, panel.id, placement(main.id, 10, 1), manager);
      await racks.putPlacement(first.id, pdu.id, placement(main.id, null, 0, 'ZERO_U'), manager);
      await rejectsStatus(racks.putPlacement(first.id, ups.id, placement(main.id, null, 0, 'ZERO_U'), manager), 400);
      await racks.putPlacement(first.id, ups.id, placement(main.id, null, 2), manager);
      const layout = await racks.getLayout(first.id, main.id);
      assert.deepEqual(layout.positioned.map(item => item.code), ['PP-01', 'SW-LEGACY']);
      assert.deepEqual(layout.zeroU.map(item => item.code), ['PDU-01']);
      assert.deepEqual(layout.unplaced.map(item => item.code), ['UPS-01']);
      assert.equal(layout.occupiedU, 3);
      await rejectsStatus(devices.updateDevice(first.id, main.id, { capacityU: 9 }, manager), 409);
      await rejectsStatus(racks.updateRack(first.id, main.id, { capacityU: 9 }, manager), 409);
      const moved = await devices.updateDevice(first.id, panel.id, { rackId: anotherMain.id }, manager);
      assert.equal(moved.mountMode, null);
      assert.equal(moved.startU, null);
      assert.equal(moved.heightU, null);
      await rejectsStatus(racks.putPlacement(first.id, panel.id, placement(foreignMain.id, 1, 1), manager), 404);
      await rejectsStatus(racks.putPlacement(first.id, panel.id, { ...placement(main.id, 3, 1), areaId: room.id }, manager), 400);
      await rejectsStatus(racks.putPlacement(first.id, main.id, placement(main.id, 3, 1), manager), 400);
      await rejectsStatus(racks.putPlacement(first.id, panel.id, placement(main.id, 0, 1), manager), 400);
    });

    await t.test('two concurrent requests for the same U range yield one success and one 409', async () => {
      const a = await dev('UPS-RACE-A', 'UPS', { rackId: anotherMain.id });
      const b = await dev('UPS-RACE-B', 'UPS', { rackId: anotherMain.id });
      const outcomes = await Promise.allSettled([
        racks.putPlacement(first.id, a.id, placement(anotherMain.id, 5, 2), manager),
        racks.putPlacement(first.id, b.id, placement(anotherMain.id, 5, 2), manager),
      ]);
      assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason.getStatus?.() === 409).length, 1);
      const layout = await racks.getLayout(first.id, anotherMain.id);
      assert.equal(layout.positioned.filter(item => item.startU === 5).length, 1);
    });

    await t.test('Nest boots on temporary DB; HTTP validation, 401/403 and technician read-only', async () => {
      const { hash } = require('bcryptjs');
      for (const role of ['MANAGER', 'TECHNICIAN']) {
        await db.getRepository(User).save({ email: role.toLowerCase() + '@rack-test.invalid',
          passwordHash: await hash(randomBytes(24).toString('hex'), 4), role, isActive: true });
      }
      process.env.DB_NAME = databaseName;
      const { NestFactory } = require('@nestjs/core');
      const { ValidationPipe } = require('@nestjs/common');
      const { JwtService } = require('@nestjs/jwt');
      const { AppModule } = require('../dist/app.module.js');
      app = await NestFactory.create(AppModule, { logger: false });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      assert.equal(app.get(DataSource).options.database, databaseName);
      const base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
      const headers = {};
      for (const role of ['MANAGER', 'TECHNICIAN']) {
        const user = await db.getRepository(User).findOneBy({ role });
        headers[role] = { Authorization: 'Bearer ' + await app.get(JwtService).signAsync({ sub: user.id, authVersion: user.authVersion }) };
      }
      const request = async (method, route, body, status, role = 'MANAGER') => {
        const response = await fetch(base + route, { method, headers: { ...(headers[role] || {}), 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        assert.equal(response.status, status, method + ' ' + route + ': ' + await response.clone().text());
        return response.json();
      };
      assert.deepEqual(await request('GET', '/health', undefined, 200, 'NONE'), { status: 'ok', database: 'connected' });
      const root = '/projects/' + first.id;
      await request('GET', root + '/racks', undefined, 401, 'NONE');
      await request('GET', root + '/racks', undefined, 200, 'TECHNICIAN');
      await request('GET', root + '/racks/' + main.id + '/layout', undefined, 200, 'TECHNICIAN');
      await request('PATCH', root + '/racks/' + main.id, { capacityU: 10 }, 403, 'TECHNICIAN');
      await request('PUT', root + '/devices/' + sw.id + '/placement', placement(main.id, 1, 2), 403, 'TECHNICIAN');
      await request('PATCH', root + '/racks/' + main.id, {}, 400);
      await request('PATCH', root + '/racks/' + main.id, { servedAreaIds: null }, 400);
      await request('PUT', root + '/devices/' + sw.id + '/placement', { rackId: main.id }, 400);
      await request('GET', '/projects/' + second.id + '/racks/' + main.id + '/layout', undefined, 404);
      const httpUps = await dev('UPS-HTTP-CONFLICT', 'UPS', { rackId: main.id });
      await request('PUT', root + '/devices/' + httpUps.id + '/placement', placement(main.id, 1, 1), 409);
      await request('PATCH', root + '/racks/' + main.id, { rackRole: null }, 409);
      await app.close(); app = undefined;
    });

    await t.test('down refuses to discard new enum Device data', async () => {
      await db.undoLastMigration(); // Remove the later User security migration before testing rack migration down.
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateProjectAcceptances1802000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateEvidenceAttachments1801000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateInspections1800000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'EnforceRackServedAreaForeignKey1799000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'EnforceRackLayoutIntegrity1798000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'AddRackLayout1797000000000');
      await assert.rejects(db.undoLastMigration(), /Rack layout contains data/);
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'AddRackLayout1797000000000');
      assert.equal((await db.query("SELECT count(*)::int AS count FROM project_devices WHERE type='PDU'"))[0].count, 1);
    });
  } finally {
    if (app) await app.close();
    if (db.isInitialized) await db.destroy();
    if (oldName === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = oldName;
    if (created) await admin.query('DROP DATABASE "' + databaseName + '"');
    await admin.end();
  }
});
