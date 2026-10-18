// Uses a disposable PostgreSQL database; never reverts migrations on the local demo database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DataSource } = require('typeorm');
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
const { DevicesService } = require('../dist/devices/devices.service.js');
const { ConnectionsService } = require('../dist/connections/connections.service.js');
const { DeviceNetworkProfile } = require('../dist/devices/device-network-profile.entity.js');
const { ProjectDeviceSystem } = require('../dist/devices/project-device-system.entity.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');
const { User } = require('../dist/users/user.entity.js');

const rejectsStatus = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);
const end = port => ({ portId: port.id, side: 'SINGLE' });

test('Network profile and switch VLAN/PoE: PostgreSQL constraints, trace, HTTP, delete rollback and isolated migration down/up',
  { timeout: 180000 }, async t => {
    await withDisposableHttpDb('network', async (db, verify) => {
    const databaseName = db.options.database;
    assert.match(databaseName, /^network_test_[a-f0-9]{32}$/);
    const previousDatabase = process.env.DB_NAME;
    let app, failure;
    try {
      await verify();
      assert.equal(db.options.synchronize, false);
      assert.equal(await db.showMigrations(), false);
      const manager = { role: 'MANAGER' };
      const devices = new DevicesService(db);
      const connections = new ConnectionsService(db);
      const projects = db.getRepository(Project);
      const project = await projects.save({ code: 'NETWORK-A', name: 'Network test A' });
      const otherProject = await projects.save({ code: 'NETWORK-B', name: 'Network test B' });
      const system = await db.getRepository(ProjectSystem).save({ projectId: project.id, code: 'CAM', name: 'Camera', category: 'CAMERA' });
      const createDevice = (code, type, extra = {}, projectId = project.id) =>
        devices.createDevice(projectId, { code, name: code, type, ...extra }, manager);
      const camera = await createDevice('CAM-01', 'CAMERA', { systemIds: [system.id] });
      const anotherCamera = await createDevice('CAM-02', 'CAMERA');
      const ap = await createDevice('AP-01', 'AP');
      const sw = await createDevice('SW-01', 'SWITCH');
      const otherCamera = await createDevice('CAM-OTHER', 'CAMERA', {}, otherProject.id);
      const profile = (deviceId, body, projectId = project.id) => devices.putNetworkProfile(projectId, deviceId, body, manager);
      const port = (device, code, metadata = {}) => connections.createPort(device.projectId, device.id, { code, ...metadata }, manager);

      await t.test('GET null, complete PUT, manual duplicate IP warning, nullable mode and cross-project rules', async () => {
        assert.equal(await devices.getNetworkProfile(project.id, camera.id), null);
        const first = await profile(camera.id, { addressMode: 'STATIC', ipAddress: '192.168.10.20', macAddress: 'AA:BB:CC:DD:EE:01' });
        assert.deepEqual(first.warnings, []);
        assert.equal(first.ipAddress, '192.168.10.20');
        const duplicate = await profile(anotherCamera.id, { addressMode: 'DHCP', ipAddress: '192.168.10.20', macAddress: null });
        assert.deepEqual(duplicate.warnings, ['DUPLICATE_IP_IN_PROJECT']);
        assert.deepEqual((await devices.getNetworkProfile(project.id, camera.id)).warnings, ['DUPLICATE_IP_IN_PROJECT']);
        assert.equal((await db.getRepository(DeviceNetworkProfile).countBy({ projectId: project.id, ipAddress: '192.168.10.20' })), 2);
        const cleared = await profile(anotherCamera.id, { addressMode: null, ipAddress: null, macAddress: null });
        assert.deepEqual(cleared.warnings, []);
        assert.equal((await devices.getNetworkProfile(project.id, camera.id)).warnings.length, 0);
        await rejectsStatus(profile(camera.id, { addressMode: null, ipAddress: '192.168.10.20', macAddress: null }), 400);
        await rejectsStatus(profile(camera.id, { addressMode: 'STATIC', ipAddress: null }), 400);
        await rejectsStatus(devices.getNetworkProfile(otherProject.id, camera.id), 404);
        await rejectsStatus(profile(camera.id, { addressMode: null, ipAddress: null, macAddress: null }, otherProject.id), 404);
        await rejectsStatus(devices.getNetworkProfile(project.id, sw.id), 400);
        assert.equal((await profile(ap.id, { addressMode: 'DHCP', ipAddress: null, macAddress: null })).addressMode, 'DHCP');
        await assert.rejects(db.query('INSERT INTO device_network_profiles(project_id,device_id) VALUES($1,$2)', [project.id, otherCamera.id]),
          error => (error.driverError?.code ?? error.code) === '23503');
      });

      await t.test('same IP in different projects never creates a cross-project warning', async () => {
        const sameIp = { addressMode: 'STATIC', ipAddress: '192.168.10.20', macAddress: null };
        assert.deepEqual((await profile(otherCamera.id, sameIp, otherProject.id)).warnings, []);
        assert.deepEqual((await devices.getNetworkProfile(project.id, camera.id)).warnings, []);
        assert.deepEqual((await devices.getNetworkProfile(otherProject.id, otherCamera.id)).warnings, []);
        assert.equal((await db.getRepository(DeviceNetworkProfile).countBy({ ipAddress: sameIp.ipAddress })), 2);
      });

      await t.test('switch-only VLAN/PoE, boundaries, direct trace and rewire reflect final switch port', async () => {
        const cp = await port(camera, 'ETH1');
        const p1 = await port(sw, 'P01', { accessVlanId: 1, poeEnabled: true });
        const p2 = await port(sw, 'P02', { accessVlanId: 4094, poeEnabled: false });
        const p3 = await port(sw, 'P03', { accessVlanId: null, poeEnabled: null });
        await rejectsStatus(port(ap, 'ETH1', { poeEnabled: false }), 400);
        await rejectsStatus(connections.updatePort(project.id, camera.id, cp.id, { accessVlanId: 20 }, manager), 400);
        assert.equal((await connections.updatePort(project.id, sw.id, p2.id, { poeEnabled: false }, manager)).accessVlanId, 4094);
        await assert.rejects(db.query('UPDATE device_ports SET access_vlan_id=4095 WHERE id=$1', [p3.id]),
          error => (error.driverError?.code ?? error.code) === '23514');
        const wire = await connections.createConnection(project.id, { kind: 'PATCH', a: end(cp), b: end(p1) }, manager);
        let trace = await connections.trace(project.id, camera.code);
        assert.equal(trace.networkProfile.ipAddress, '192.168.10.20');
        assert.deepEqual(trace.paths[0].switchPort, { portId: p1.id, accessVlanId: 1, poeEnabled: true });
        assert.equal(trace.paths[0].complete, true);
        const rewired = await connections.rewire(project.id, wire.id,
          { kind: 'PATCH', a: end(p2), b: end(cp), expectedVersion: wire.version }, manager);
        assert.equal(rewired.version, 2);
        trace = await connections.trace(project.id, camera.code);
        assert.deepEqual(trace.paths[0].switchPort, { portId: p2.id, accessVlanId: 4094, poeEnabled: false });
        await rejectsStatus(connections.rewire(project.id, wire.id,
          { kind: 'PATCH', a: end(cp), b: end(p1), expectedVersion: 1 }, manager), 409);
        const occupiedCamera = await createDevice('CAM-BUSY', 'CAMERA');
        const occupiedPort = await port(occupiedCamera, 'ETH1');
        await connections.createConnection(project.id, { kind: 'PATCH', a: end(occupiedPort), b: end(p3) }, manager);
        await rejectsStatus(connections.rewire(project.id, wire.id,
          { kind: 'PATCH', a: end(cp), b: end(p3), expectedVersion: 2 }, manager), 409);
        assert.deepEqual((await connections.trace(project.id, camera.code)).paths[0].switchPort, trace.paths[0].switchPort);
        await rejectsStatus(devices.deleteDevice(project.id, camera.id, manager), 409);
        assert.ok(await devices.getNetworkProfile(project.id, camera.id));
        assert.equal(await db.getRepository(ProjectDeviceSystem).countBy({ projectId: project.id, deviceId: camera.id }), 1);
        await connections.deleteConnection(project.id, wire.id, manager);
        await connections.deletePort(project.id, camera.id, cp.id, manager);
        await devices.deleteDevice(project.id, camera.id, manager);
        assert.equal(await devices.getNetworkProfile(project.id, camera.id).catch(error => error.getStatus?.()), 404);
        assert.equal(await db.getRepository(ProjectDeviceSystem).countBy({ projectId: project.id, deviceId: camera.id }), 0);
      });

      await t.test('camera trace through panel or outlet uses the final switch port, including after rewire', async () => {
        const panelCamera = await createDevice('CAM-PANEL', 'CAMERA');
        const outletCamera = await createDevice('CAM-OUTLET', 'CAMERA');
        const panel = await createDevice('PANEL-TRACE', 'PATCH_PANEL');
        const outlet = await createDevice('OUTLET-TRACE', 'NETWORK_OUTLET');
        const traceSwitch = await createDevice('SW-TRACE', 'SWITCH');
        const panelCameraPort = await port(panelCamera, 'ETH1');
        const outletCameraPort = await port(outletCamera, 'ETH1');
        const panelPort1 = await port(panel, 'P01');
        const panelPort2 = await port(panel, 'P02');
        const outletPort = await port(outlet, 'P01');
        const switchPort1 = await port(traceSwitch, 'P01', { accessVlanId: 100, poeEnabled: true });
        const switchPort2 = await port(traceSwitch, 'P02', { accessVlanId: 200, poeEnabled: false });
        const switchPort3 = await port(traceSwitch, 'P03', { accessVlanId: 300, poeEnabled: null });
        await connections.createConnection(project.id,
          { kind: 'FIXED', a: end(panelCameraPort), b: { portId: panelPort1.id, side: 'REAR' } }, manager);
        const panelPatch = await connections.createConnection(project.id,
          { kind: 'PATCH', a: { portId: panelPort1.id, side: 'FRONT' }, b: end(switchPort1) }, manager);
        await connections.createConnection(project.id,
          { kind: 'PATCH', a: end(outletCameraPort), b: { portId: outletPort.id, side: 'FRONT' } }, manager);
        await connections.createConnection(project.id,
          { kind: 'FIXED', a: { portId: outletPort.id, side: 'REAR' }, b: { portId: panelPort2.id, side: 'REAR' } }, manager);
        const outletPatch = await connections.createConnection(project.id,
          { kind: 'PATCH', a: { portId: panelPort2.id, side: 'FRONT' }, b: end(switchPort2) }, manager);
        const panelTrace = (await connections.trace(project.id, panelCamera.code)).paths[0];
        assert.equal(panelTrace.complete, true);
        assert.equal(panelTrace.segments.length, 2);
        assert.deepEqual(panelTrace.switchPort, { portId: switchPort1.id, accessVlanId: 100, poeEnabled: true });
        const outletTrace = (await connections.trace(project.id, outletCamera.code)).paths[0];
        assert.equal(outletTrace.complete, true);
        assert.equal(outletTrace.segments.length, 3);
        assert.deepEqual(outletTrace.switchPort, { portId: switchPort2.id, accessVlanId: 200, poeEnabled: false });
        await connections.rewire(project.id, panelPatch.id,
          { kind: 'PATCH', a: end(switchPort3), b: { portId: panelPort1.id, side: 'FRONT' }, expectedVersion: panelPatch.version }, manager);
        await connections.rewire(project.id, outletPatch.id,
          { kind: 'PATCH', a: end(switchPort1), b: { portId: panelPort2.id, side: 'FRONT' }, expectedVersion: outletPatch.version }, manager);
        assert.deepEqual((await connections.trace(project.id, panelCamera.code)).paths[0].switchPort,
          { portId: switchPort3.id, accessVlanId: 300, poeEnabled: null });
        assert.deepEqual((await connections.trace(project.id, outletCamera.code)).paths[0].switchPort,
          { portId: switchPort1.id, accessVlanId: 100, poeEnabled: true });
      });

      await t.test('late delete dependency failure rolls back profile and System cleanup', async () => {
        const doomed = await createDevice('CAM-ROLLBACK', 'CAMERA', { systemIds: [system.id] });
        await profile(doomed.id, { addressMode: 'STATIC', ipAddress: null, macAddress: null });
        await verify(); await db.query(`CREATE FUNCTION network_test_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF OLD.id = '${doomed.id}'::uuid THEN RAISE EXCEPTION 'test dependency' USING ERRCODE = '23503'; END IF; RETURN OLD; END $$`);
        await verify(); await db.query('CREATE TRIGGER network_test_block_delete BEFORE DELETE ON project_devices FOR EACH ROW EXECUTE FUNCTION network_test_block_delete()');
        try {
          await rejectsStatus(devices.deleteDevice(project.id, doomed.id, manager), 409);
          assert.ok(await devices.getNetworkProfile(project.id, doomed.id));
          assert.equal(await db.getRepository(ProjectDeviceSystem).countBy({ projectId: project.id, deviceId: doomed.id }), 1);
          assert.ok(await devices.getDevice(project.id, doomed.id));
        } finally {
          await verify(); await db.query('DROP TRIGGER network_test_block_delete ON project_devices');
          await verify(); await db.query('DROP FUNCTION network_test_block_delete()');
        }
      });

      await t.test('Nest boots with real PostgreSQL; HTTP GET null/PUT and roles, validation, 404', async () => {
        const { hash } = require('bcryptjs');
        for (const role of ['MANAGER', 'TECHNICIAN']) {
          await db.getRepository(User).save({ email: role.toLowerCase() + '@network-test.invalid',
            passwordHash: await hash(randomBytes(24).toString('hex'), 4), role, isActive: true });
        }
        process.env.DB_NAME = databaseName;
        const { NestFactory } = require('@nestjs/core');
        const { ValidationPipe } = require('@nestjs/common');
        const { JwtService } = require('@nestjs/jwt');
        const { AppModule } = require('../dist/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.listen(0, '127.0.0.1'); await verify(app.get(DataSource));
        assert.equal(app.get(DataSource).options.database, databaseName);
        const base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
        const headers = {};
        for (const role of ['MANAGER', 'TECHNICIAN']) {
          const user = await db.getRepository(User).findOneBy({ role });
          headers[role] = { Authorization: 'Bearer ' + await app.get(JwtService).signAsync({ sub: user.id, authVersion: user.authVersion }) };
        }
        const request = async (method, path, body, status, role = 'MANAGER') => {
          const response = await fetch(base + path, { method, headers: { ...(headers[role] || {}), 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          assert.equal(response.status, status, method + ' ' + path);
          const raw = await response.text();
          return raw ? JSON.parse(raw) : undefined;
        };
        assert.deepEqual(await request('GET', '/health', undefined, 200, 'NONE'), { status: 'ok', database: 'connected' });
        const httpCamera = await createDevice('CAM-HTTP', 'CAMERA');
        const path = '/projects/' + project.id + '/devices/' + httpCamera.id + '/network-profile';
        await request('GET', path, undefined, 401, 'NONE');
        assert.equal(await request('GET', path, undefined, 200, 'TECHNICIAN'), null);
        const body = { addressMode: 'DHCP', ipAddress: null, macAddress: ' aa:bb:cc:dd:ee:ff ' };
        await request('PUT', path, body, 401, 'NONE');
        await request('PUT', path, body, 403, 'TECHNICIAN');
        for (const invalid of [{}, { addressMode: null, ipAddress: '192.168.1.1', macAddress: null },
          { addressMode: 'DHCP', ipAddress: '2001:db8::1', macAddress: null },
          { addressMode: 'DHCP', ipAddress: null, macAddress: 'BAD' }]) await request('PUT', path, invalid, 400);
        const result = await request('PUT', path, body, 200);
        assert.equal(result.macAddress, 'AA:BB:CC:DD:EE:FF');
        assert.deepEqual(result.warnings, []);
        assert.equal((await request('GET', path, undefined, 200, 'TECHNICIAN')).addressMode, 'DHCP');
        const raceCamera = await createDevice('CAM-RACE', 'CAMERA');
        const racePath = '/projects/' + project.id + '/devices/' + raceCamera.id + '/network-profile';
        const concurrentBodies = [
          { addressMode: 'STATIC', ipAddress: '192.168.10.41', macAddress: null },
          { addressMode: 'DHCP', ipAddress: '192.168.10.42', macAddress: null },
        ];
        const concurrentResults = await Promise.all(concurrentBodies.map(value => request('PUT', racePath, value, 200)));
        assert.deepEqual(concurrentResults.map(value => value.warnings), [[], []]);
        assert.equal(await db.getRepository(DeviceNetworkProfile).countBy({ projectId: project.id, deviceId: raceCamera.id }), 1);
        const finalProfile = await request('GET', racePath, undefined, 200, 'TECHNICIAN');
        assert.ok(concurrentBodies.some(value => value.addressMode === finalProfile.addressMode && value.ipAddress === finalProfile.ipAddress));
        const httpPort = await port(httpCamera, 'ETH1');
        await request('DELETE', '/projects/' + project.id + '/devices/' + httpCamera.id, undefined, 409);
        assert.ok(await devices.getNetworkProfile(project.id, httpCamera.id));
        await request('POST', '/projects/' + project.id + '/devices/' + ap.id + '/ports',
          { code: 'BAD-META', poeEnabled: false }, 400);
        await request('GET', '/projects/' + otherProject.id + '/devices/' + httpCamera.id + '/network-profile', undefined, 404);
        await request('PUT', '/projects/' + otherProject.id + '/devices/' + httpCamera.id + '/network-profile', body, 404);
        await request('GET', '/projects/' + project.id + '/devices/' + sw.id + '/network-profile', undefined, 400);
        const portPath = '/projects/' + project.id + '/devices/' + sw.id + '/ports';
        await request('POST', portPath, { code: 'HTTP-P', accessVlanId: 20, poeEnabled: true }, 403, 'TECHNICIAN');
        const createdPort = await request('POST', portPath, { code: 'HTTP-P', accessVlanId: 20, poeEnabled: true }, 201);
        assert.equal(createdPort.accessVlanId, 20);
        assert.equal(createdPort.poeEnabled, true);
        await request('PATCH', portPath + '/' + createdPort.id, { accessVlanId: 4095 }, 400);
        assert.equal((await request('PATCH', portPath + '/' + createdPort.id, { accessVlanId: null, poeEnabled: null }, 200)).poeEnabled, null);
        assert.equal((await connections.listPorts(project.id, httpCamera.id))[0].id, httpPort.id);
        await app.close(); app = undefined;
      });

      await t.test('isolated down/up touches only new profile schema and port columns', async () => {
        const before = (await db.query('SELECT count(*)::int AS count FROM project_devices'))[0].count;
        await verify(); await db.undoLastMigration(); // Remove the later User security migration before testing historical down/up.
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateProjectAcceptances1802000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateEvidenceAttachments1801000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateInspections1800000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,
          'EnforceRackServedAreaForeignKey1799000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,
          'EnforceRackLayoutIntegrity1798000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,
          'AddRackLayout1797000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,
          'AddDeviceNetworkProfileAndPortMetadata1796000000000');
        await verify(); await db.undoLastMigration();
        assert.equal((await db.query("SELECT to_regclass('public.device_network_profiles') AS name"))[0].name, null);
        assert.equal((await db.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='device_ports' AND column_name='poe_enabled'"))[0].count, 0);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM project_devices'))[0].count, before);
        await verify(); await db.runMigrations();
        assert.equal(await db.showMigrations(), false);
        assert.equal((await db.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='device_ports' AND column_name='poe_enabled'"))[0].count, 1);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM project_devices'))[0].count, before);
      });
    } catch (error) { failure = error; }
    finally {
      try { if (app) await app.close(); }
      catch (error) { failure = failure ? new AggregateError([failure, error], 'Network app cleanup failed', { cause: failure }) : error; }
      if (previousDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = previousDatabase;
    }
    if (failure) throw failure;
    });
  });
