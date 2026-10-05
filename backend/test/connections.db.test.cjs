// Isolated PostgreSQL database: never revert migrations or install test triggers in the demo DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource: localSource } = require('../dist/database/data-source.js');
const { ConnectionsService } = require('../dist/connections/connections.service.js');
const { DevicesService } = require('../dist/devices/devices.service.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');
const { ProjectDevice } = require('../dist/devices/project-device.entity.js');
const { DevicePort } = require('../dist/connections/device-port.entity.js');
const { PhysicalConnection } = require('../dist/connections/physical-connection.entity.js');
const { ConnectionEndpoint } = require('../dist/connections/connection-endpoint.entity.js');
const { User } = require('../dist/users/user.entity.js');

const rejectsStatus = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);
const end = (port, side = 'SINGLE') => ({ portId: port.id, side });
const route = (kind, a, b) => ({ kind, a, b });
const saved = value => JSON.parse(JSON.stringify(value));
const checkRace = results => {
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failures = results.filter(r => r.status === 'rejected');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.getStatus?.(), 409);
};

test('Connections: real PostgreSQL constraints/concurrency/rollback, Nest HTTP and migration down/up in a disposable DB', { timeout: 180000 }, async t => {
  const databaseName = 'connections_test_' + randomUUID().replaceAll('-', '');
  assert.match(databaseName, /^connections_test_[a-f0-9]{32}$/);
  const options = localSource.options;
  const admin = new Client({ host: options.host, port: options.port, user: options.username,
    password: options.password, database: options.database });
  const db = new DataSource({ ...options, database: databaseName });
  let created = false;
  let app;
  const originalDatabase = process.env.DB_NAME;
  try {
    await admin.connect();
    await admin.query('CREATE DATABASE "' + databaseName + '"');
    created = true;
    await db.initialize();
    assert.equal(db.options.synchronize, false);
    await db.runMigrations();
    assert.equal(await db.showMigrations(), false);
    const manager = { role: 'MANAGER' };
    const svc = new ConnectionsService(db);
    const devices = new DevicesService(db);
    const projects = db.getRepository(Project);
    const p = await projects.save(projects.create({ code: 'CONN-A', name: 'Temporary connection fixture A' }));
    const other = await projects.save(projects.create({ code: 'CONN-B', name: 'Temporary connection fixture B' }));
    const areaRepo = db.getRepository(ProjectArea);
    const area = await areaRepo.save(areaRepo.create({ projectId: p.id, code: 'F01', name: 'Floor', type: 'FLOOR', sortOrder: 0 }));
    const dev = (type, code, extra = {}, projectId = p.id) => devices.createDevice(projectId, { type, code, name: code, ...extra }, manager);
    const port = (device, code = 'P01') => svc.createPort(device.projectId, device.id, { code }, manager);
    const connect = dto => svc.createConnection(p.id, dto, manager);
    const rack = await dev('RACK', 'RACK-01', { areaId: area.id });
    const sw = await dev('SWITCH', 'SW-01', { rackId: rack.id });
    const panel = await dev('PATCH_PANEL', 'PP-01', { rackId: rack.id });
    const otherSw = await dev('SWITCH', 'SW-OTHER', {}, other.id);
    const otherPort = await port(otherSw);
    let sequence = 0;
    const switchPort = () => port(sw, 'P' + String(++sequence).padStart(2, '0'));
    const panelPort = () => port(panel, 'P' + String(++sequence).padStart(2, '0'));
    const terminal = async (type, code) => { const device = await dev(type, code, { areaId: area.id }); return { device, port: await port(device, 'ETH1') }; };
    const scenarios = [];

    await t.test('port CRUD/normalization, correct sides, same-device ownership and empty PATCH', async () => {
      const outlet = await dev('NETWORK_OUTLET', 'DATA-PORTS', { areaId: area.id });
      const a = await svc.createPort(p.id.toUpperCase(), outlet.id.toUpperCase(), { code: ' p01 ', description: ' Gi1/0/1 ' }, manager);
      const b = await port(outlet, 'P02');
      assert.equal(a.code, 'P01'); assert.equal(a.description, 'Gi1/0/1');
      assert.deepEqual(a.sides, [{ side: 'FRONT', connectionId: null }, { side: 'REAR', connectionId: null }]);
      await rejectsStatus(port(outlet, 'p01'), 409);
      await rejectsStatus(port(rack), 400);
      await rejectsStatus(svc.updatePort(p.id, outlet.id, a.id, {}, manager), 400);
      await rejectsStatus(svc.updatePort(p.id, sw.id, a.id, { code: 'OTHER' }, manager), 404);
      await rejectsStatus(svc.deletePort(other.id, outlet.id, a.id, manager), 404);
      assert.equal((await svc.updatePort(p.id, outlet.id, a.id, { code: ' p03 ', description: null }, manager)).code, 'P03');
      await svc.deletePort(p.id, outlet.id, a.id, manager);
      assert.deepEqual((await svc.listPorts(p.id, outlet.id)).map(x => x.id), [b.id]);
    });

    await t.test('CAMERA and AP concurrent creation with DIFFERENT codes yields one port, one 409', async () => {
      for (const type of ['CAMERA', 'AP']) {
        const device = await dev(type, 'RACE-' + type);
        checkRace(await Promise.allSettled([port(device, 'ETH1'), port(device, 'ETH2')]));
        assert.equal((await svc.listPorts(p.id, device.id)).length, 1);
      }
    });

    await t.test('all three CAMERA/AP paths, outlet starts REAR, UUID casing, rack/area and endpoint responses', async () => {
      for (const type of ['CAMERA', 'AP']) {
        for (const shape of ['DIRECT', 'PANEL', 'OUTLET']) {
          const camera = await terminal(type, type + '-' + shape);
          const target = await switchPort();
          const connections = [];
          let pp, outlet, outletPort;
          if (shape === 'DIRECT') connections.push(await connect(route('PATCH', end(target), { ...end(camera.port), portId: camera.port.id.toUpperCase() })));
          else {
            pp = await panelPort();
            connections.push(await connect(route('PATCH', end(target), end(pp, 'FRONT'))));
            if (shape === 'PANEL') connections.push(await connect(route('FIXED', end(pp, 'REAR'), end(camera.port))));
            else {
              outlet = await dev('NETWORK_OUTLET', type + '-OUTLET-DEVICE', { areaId: area.id });
              outletPort = await port(outlet);
              await port(outlet, 'P02');
              connections.push(await connect(route('FIXED', end(outletPort, 'REAR'), end(pp, 'REAR'))));
              connections.push(await connect(route('PATCH', end(camera.port), end(outletPort, 'FRONT'))));
              const traceOutlet = await svc.trace(p.id, outlet.code);
              assert.equal(traceOutlet.paths.length, 2);
              assert.equal(traceOutlet.paths[0].segments.length, 2);
              assert.equal(traceOutlet.paths[0].segments[0].from.side, 'REAR');
              assert.equal(traceOutlet.paths[1].complete, false);
            }
          }
          const result = await svc.trace(p.id.toUpperCase(), ' ' + camera.device.code.toLowerCase() + ' ');
          assert.equal(result.device.id, camera.device.id);
          assert.equal(result.area.id, area.id);
          assert.equal(result.paths[0].complete, true);
          assert.equal(result.paths[0].missing, null);
          assert.equal(result.paths[0].segments.length, { DIRECT: 1, PANEL: 2, OUTLET: 3 }[shape]);
          assert.equal(result.paths[0].segments[0].from.side, 'SINGLE');
          const last = result.paths[0].segments.at(-1);
          assert.equal(last.to.portId, target.id);
          assert.equal(last.to.device.rack.id, rack.id);
          assert.equal(last.to.device.effectiveAreaId, area.id);
          const filtered = await svc.listConnections(p.id, camera.device.id.toUpperCase());
          assert.equal(filtered.length, 1);
          assert.equal(filtered[0].version, 1);
          assert.ok(filtered[0].a.port.code && filtered[0].b.device.code);
          if (pp) assert.ok((await svc.listPorts(p.id, panel.id)).find(x => x.id === pp.id).sides.every(s => s.connectionId));
          scenarios.push({ ...camera, target, connections, pp, outletPort });
        }
      }
    });

    await t.test('trace returns partial paths/no ports and rejects unsupported/missing devices', async () => {
      const outlet = await dev('NETWORK_OUTLET', 'PARTIAL');
      assert.deepEqual((await svc.trace(p.id, outlet.code)).paths, []);
      const op = await port(outlet);
      const pp = await panelPort();
      let path = (await svc.trace(p.id, outlet.code)).paths[0];
      assert.equal(path.segments.length, 0);
      assert.deepEqual(path.missing, { portId: op.id, side: 'REAR' });
      const fixed = await connect(route('FIXED', end(op, 'REAR'), end(pp, 'REAR')));
      path = (await svc.trace(p.id, outlet.code)).paths[0];
      assert.equal(path.complete, false);
      assert.deepEqual(path.missing, { portId: pp.id, side: 'FRONT' });
      const camera = await terminal('CAMERA', 'PARTIAL-CAMERA');
      const patch = await connect(route('PATCH', end(camera.port), end(op, 'FRONT')));
      assert.equal((await svc.trace(p.id, camera.device.code)).paths[0].segments.length, 2);
      await svc.deleteConnection(p.id, fixed.id, manager);
      path = (await svc.trace(p.id, camera.device.code)).paths[0];
      assert.equal(path.segments.length, 1); assert.equal(path.complete, false);
      assert.deepEqual(path.missing, { portId: op.id, side: 'REAR' });
      await svc.deleteConnection(p.id, patch.id, manager);
      assert.equal((await svc.trace(p.id, camera.device.code)).paths[0].segments.length, 0);
      await rejectsStatus(svc.trace(p.id, sw.code), 400);
      await rejectsStatus(svc.trace(p.id, 'MISSING'), 404);
    });

    await t.test('invalid sides/pairings/self-link and cross-project resources fail without writing', async () => {
      const source = scenarios[0].port;
      const target = await switchPort();
      const count = await db.getRepository(PhysicalConnection).count();
      for (const dto of [
        route('FIXED', end(source, 'REAR'), end(target)),
        route('PATCH', end(target), { portId: target.id.toUpperCase(), side: 'SINGLE' }),
        route('PATCH', end(target), end(await switchPort())),
        route('FIXED', end(await panelPort(), 'FRONT'), end(target)),
      ]) await rejectsStatus(connect(dto), 400);
      await rejectsStatus(connect(route('PATCH', end(source), end(otherPort))), 404);
      await rejectsStatus(svc.listPorts(other.id, sw.id), 404);
      await rejectsStatus(svc.listConnections(p.id, otherSw.id), 404);
      await rejectsStatus(svc.listConnections(randomUUID()), 404);
      await rejectsStatus(svc.rewire(other.id, scenarios[0].connections[0].id, { ...route('PATCH', end(source), end(target)), expectedVersion: 1 }, manager), 404);
      await rejectsStatus(svc.deleteConnection(other.id, scenarios[0].connections[0].id, manager), 404);
      assert.equal(await db.getRepository(PhysicalConnection).count(), count);
    });

    await t.test('two requests claiming the same face (reversed A/B) yield one connection with exactly two ends', async () => {
      const a = await terminal('CAMERA', 'FACE-RACE-A');
      const b = await terminal('AP', 'FACE-RACE-B');
      const target = await switchPort();
      const before = await db.getRepository(PhysicalConnection).count();
      checkRace(await Promise.allSettled([
        connect(route('FIXED', end(a.port), end(target))),
        connect(route('PATCH', end(target), end(b.port))),
      ]));
      assert.equal(await db.getRepository(PhysicalConnection).count(), before + 1);
      const face = (await svc.listPorts(p.id, sw.id)).find(x => x.id === target.id).sides[0];
      assert.ok(face.connectionId);
      assert.equal(await db.getRepository(ConnectionEndpoint).countBy({ connectionId: face.connectionId }), 2);
    });

    await t.test('rewire occupied/cross-project/invalid endpoints rolls back old endpoints, kind and version', async () => {
      const original = scenarios[0];
      const before = saved((await svc.listConnections(p.id, original.device.id))[0]);
      const badRoutes = [
        [route('FIXED', end(original.port), end(scenarios[1].target)), 409],
        [route('PATCH', end(original.port), end(otherPort)), 404],
        [route('PATCH', end(original.port), end(await panelPort(), 'FRONT')), 400],
      ];
      for (const [dto, status] of badRoutes) {
        await rejectsStatus(svc.rewire(p.id, before.id, { ...dto, expectedVersion: before.version }, manager), status);
        assert.deepEqual(saved((await svc.listConnections(p.id, original.device.id))[0]), before);
      }
    });

    await t.test('late FK failure after deleting old endpoints rolls back all of rewire', async () => {
      const original = scenarios[0];
      const before = saved((await svc.listConnections(p.id, original.device.id))[0]);
      const target = await switchPort();
      // This trigger only exists in the isolated disposable database.
      await db.query(`CREATE FUNCTION connection_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.connection_id = '${before.id}'::uuid AND NEW."end" = 'B' THEN NEW.port_id := '${randomUUID()}'::uuid; END IF; RETURN NEW; END $$`);
      await db.query('CREATE TRIGGER connection_test_fail BEFORE INSERT ON connection_endpoints FOR EACH ROW EXECUTE FUNCTION connection_test_fail()');
      try {
        await rejectsStatus(svc.rewire(p.id, before.id, { ...route('FIXED', end(original.port), end(target)), expectedVersion: before.version }, manager), 409);
        assert.deepEqual(saved((await svc.listConnections(p.id, original.device.id))[0]), before);
      } finally {
        await db.query('DROP TRIGGER connection_test_fail ON connection_endpoints');
        await db.query('DROP FUNCTION connection_test_fail()');
      }
    });

    await t.test('concurrent rewire with one expectedVersion has one winner; old face freed, uppercase UUID works', async () => {
      const original = scenarios[0];
      const before = (await svc.listConnections(p.id, original.device.id))[0];
      const targets = [await switchPort(), await switchPort()];
      const results = await Promise.allSettled(targets.map(target => svc.rewire(p.id.toUpperCase(), before.id.toUpperCase(), {
        ...route('FIXED', { ...end(original.port), portId: original.port.id.toUpperCase() }, end(target)), expectedVersion: before.version,
      }, manager)));
      checkRace(results);
      const updated = (await svc.listConnections(p.id, original.device.id))[0];
      assert.equal(updated.version, 2);
      assert.equal(updated.kind, 'FIXED');
      assert.equal((await svc.listPorts(p.id, sw.id)).find(x => x.id === original.target.id).sides[0].connectionId, null);
      await rejectsStatus(svc.rewire(p.id, before.id, { ...route('PATCH', end(original.port), end(original.target)), expectedVersion: 1 }, manager), 409);
      assert.equal((await svc.trace(p.id, original.device.code)).paths[0].complete, true);
    });

    await t.test('rewire swaps A/B; stale version and occupied face leave endpoints, version and trace intact', async () => {
      const original = scenarios[0];
      const before = (await svc.listConnections(p.id, original.device.id))[0];
      const swapped = await svc.rewire(p.id, before.id, {
        ...route(before.kind, { portId: before.b.portId, side: before.b.side }, { portId: before.a.portId, side: before.a.side }),
        expectedVersion: before.version,
      }, manager);
      assert.equal(swapped.version, before.version + 1);
      assert.equal(swapped.a.portId, before.b.portId);
      assert.equal(swapped.a.side, before.b.side);
      assert.equal(swapped.b.portId, before.a.portId);
      assert.equal(swapped.b.side, before.a.side);
      assert.deepEqual((await db.query('SELECT "end", port_id FROM connection_endpoints WHERE connection_id=$1 ORDER BY "end"', [before.id]))
        .map(x => [x.end, x.port_id]), [['A', before.b.portId], ['B', before.a.portId]]);
      const trace = (await svc.trace(p.id, original.device.code)).paths[0];
      assert.equal(trace.complete, true);
      assert.equal(trace.segments[0].connectionId, before.id);
      assert.equal(trace.segments.at(-1).to.portId, before.b.portId);
      const snapshot = saved((await svc.listConnections(p.id, original.device.id))[0]);
      const snapshotTrace = saved((await svc.trace(p.id, original.device.code)).paths[0]);
      await rejectsStatus(svc.rewire(p.id, before.id, {
        ...route('PATCH', end(original.port), end(original.target)), expectedVersion: before.version,
      }, manager), 409);
      await rejectsStatus(svc.rewire(p.id, before.id, {
        ...route('PATCH', end(original.port), end(scenarios[1].target)), expectedVersion: swapped.version,
      }, manager), 409);
      assert.deepEqual(saved((await svc.listConnections(p.id, original.device.id))[0]), snapshot);
      assert.deepEqual(saved((await svc.trace(p.id, original.device.code)).paths[0]), snapshotTrace);
    });

    await t.test('deferred pair constraint rejects zero or one endpoint at COMMIT without persisting parent', async () => {
      const count = await db.getRepository(PhysicalConnection).count();
      const free = await switchPort();
      for (const withOneEnd of [false, true]) {
        const id = randomUUID();
        await assert.rejects(db.transaction(async m => {
          await m.query('INSERT INTO physical_connections(id,project_id,kind) VALUES($1,$2,$3)', [id, p.id, 'PATCH']);
          if (withOneEnd) await m.query('INSERT INTO connection_endpoints(project_id,connection_id,"end",port_id,side) VALUES($1,$2,$3,$4,$5)',
            [p.id, id, 'A', free.id, 'SINGLE']);
        }), e => (e.driverError?.code ?? e.code) === '23514');
        assert.equal((await db.query('SELECT count(*)::int AS count FROM physical_connections WHERE id=$1', [id]))[0].count, 0);
      }
      assert.equal(await db.getRepository(PhysicalConnection).count(), count);
      assert.equal((await svc.listPorts(p.id, sw.id)).find(x => x.id === free.id).sides[0].connectionId, null);
    });

    await t.test('real DB composite FK, unique face/code/end and RESTRICT constraints', async () => {
      const codeError = (sql, values, codes) => assert.rejects(db.query(sql, values), e => codes.includes(e.driverError?.code ?? e.code));
      await codeError('INSERT INTO device_ports(project_id,device_id,code) VALUES($1,$2,$3)', [p.id, otherSw.id, 'P-FOREIGN'], ['23503']);
      await codeError('INSERT INTO device_ports(project_id,device_id,code) VALUES($1,$2,$3)', [p.id, scenarios[0].device.id, scenarios[0].port.code], ['23505']);
      const free = await switchPort();
      const existing = (await svc.listConnections(p.id, scenarios[0].device.id))[0];
      await codeError('UPDATE connection_endpoints SET port_id=$1 WHERE connection_id=$2 AND "end"=$3', [otherPort.id, existing.id, 'A'], ['23503']);
      await codeError('UPDATE connection_endpoints SET project_id=$1 WHERE connection_id=$2 AND "end"=$3', [other.id, existing.id, 'A'], ['23503']);
      await codeError('INSERT INTO connection_endpoints(project_id,connection_id,"end",port_id,side) VALUES($1,$2,$3,$4,$5)', [p.id, existing.id, 'A', scenarios[0].port.id, 'SINGLE'], ['23505']);
      await codeError('INSERT INTO connection_endpoints(project_id,connection_id,"end",port_id,side) VALUES($1,$2,$3,$4,$5)', [p.id, existing.id, 'A', free.id, 'SINGLE'], ['23505']);
      await codeError('DELETE FROM physical_connections WHERE id=$1', [existing.id], ['23503', '23001']);
      await codeError('DELETE FROM device_ports WHERE id=$1', [scenarios[0].port.id], ['23503', '23001']);
      await codeError('DELETE FROM project_devices WHERE id=$1', [scenarios[0].device.id], ['23503', '23001']);
    });

    await t.test('Device with even an unused port returns 409 and preserves System memberships; delete order works', async () => {
      const system = await db.getRepository(ProjectSystem).save({ projectId: p.id, code: 'CAM', name: 'Camera', category: 'CAMERA' });
      const device = await dev('CAMERA', 'DELETE-ME', { systemIds: [system.id] });
      const cp = await port(device);
      await rejectsStatus(devices.deleteDevice(p.id, device.id, manager), 409);
      assert.deepEqual((await devices.getDevice(p.id, device.id)).systemIds, [system.id]);
      const target = await switchPort();
      const connection = await connect(route('PATCH', end(cp), end(target)));
      await rejectsStatus(svc.deletePort(p.id, device.id, cp.id, manager), 409);
      await svc.deleteConnection(p.id, connection.id, manager);
      assert.equal((await svc.listPorts(p.id, device.id))[0].sides[0].connectionId, null);
      await svc.deletePort(p.id, device.id, cp.id, manager);
      await devices.deleteDevice(p.id, device.id, manager);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM project_device_systems WHERE device_id=$1', [device.id]))[0].count, 0);
      await rejectsStatus(devices.deleteDevice(p.id, rack.id, manager), 409);
    });

    await t.test('Nest starts with real PostgreSQL; all HTTP writes guarded, validation/status/response contracts', async () => {
      const { hash } = require('bcryptjs');
      for (const role of ['MANAGER', 'TECHNICIAN']) {
        await db.getRepository(User).save({ email: role.toLowerCase() + '@connection-test.invalid',
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
        headers[role] = { Authorization: 'Bearer ' + await app.get(JwtService).signAsync({ sub: user.id }) };
      }
      const request = async (method, path, body, status, role = 'MANAGER') => {
        const response = await fetch(base + path, { method, headers: { ...(headers[role] || {}), 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        assert.equal(response.status, status, method + ' ' + path + ' status');
        return status === 204 ? null : response.json();
      };
      assert.deepEqual(await request('GET', '/health', undefined, 200, 'NONE'), { status: 'ok', database: 'connected' });
      const root = '/projects/' + p.id;
      const item = root + '/devices/' + sw.id + '/ports';
      const connections = root + '/connections';
      for (const url of [item, connections, connections + '/trace?deviceCode=CAMERA-DIRECT']) {
        await request('GET', url, undefined, 401, 'NONE');
        await request('GET', url, undefined, 200, 'TECHNICIAN');
      }
      for (const [method, url] of [['POST', item], ['PATCH', item + '/' + scenarios[0].port.id],
        ['DELETE', item + '/' + scenarios[0].port.id], ['POST', connections],
        ['POST', connections + '/' + scenarios[0].connections[0].id + '/rewire'],
        ['DELETE', connections + '/' + scenarios[0].connections[0].id]]) {
        await request(method, url, method === 'DELETE' ? undefined : {}, 403, 'TECHNICIAN');
        await request(method, url, method === 'DELETE' ? undefined : {}, 401, 'NONE');
      }
      const createdPort = await request('POST', item, { code: ' http-01 ', description: 'Gi1/0/1' }, 201);
      assert.equal(createdPort.code, 'HTTP-01'); assert.deepEqual(createdPort.sides, [{ side: 'SINGLE', connectionId: null }]);
      for (const body of [{}, { code: null }, { code: 'Gi1/0/1' }]) await request('PATCH', item + '/' + createdPort.id, body, 400);
      assert.equal((await request('PATCH', item + '/' + createdPort.id, { description: null }, 200)).description, null);
      await request('GET', connections + '/trace', undefined, 400);
      await request('GET', connections + '?deviceId=bad', undefined, 400);
      await request('GET', '/projects/' + other.id + '/devices/' + sw.id + '/ports', undefined, 404);
      const camera = await terminal('CAMERA', 'HTTP-CAMERA');
      const dto = route('PATCH', end(camera.port), end(createdPort));
      for (const body of [{}, { ...dto, a: null }, { ...dto, a: [dto.a] }, { ...dto, b: {} }]) await request('POST', connections, body, 400);
      const connected = await request('POST', connections, dto, 201);
      assert.equal(connected.version, 1);
      assert.equal(connected.a.portId, camera.port.id);
      await request('POST', connections, dto, 409);
      const next = await switchPort();
      const rewired = await request('POST', connections + '/' + connected.id + '/rewire', { ...route('FIXED', end(camera.port), end(next)), expectedVersion: 1 }, 200);
      assert.equal(rewired.version, 2);
      await request('POST', connections + '/' + connected.id + '/rewire', { ...dto, expectedVersion: 1 }, 409);
      await request('POST', connections + '/' + connected.id + '/rewire', { ...dto, expectedVersion: null }, 400);
      await request('POST', '/projects/' + other.id + '/connections', dto, 404);
      await request('DELETE', root + '/devices/' + camera.device.id, undefined, 409);
      await request('DELETE', connections + '/' + connected.id, undefined, 204);
      await request('DELETE', connections + '/' + connected.id, undefined, 404);
      await request('DELETE', item + '/' + createdPort.id, undefined, 204);
      await app.close(); app = undefined;
    });

    await t.test('every connection has two endpoints; isolated down/up of pair constraint preserves older tables', async () => {
      const invalid = await db.query('SELECT c.id FROM physical_connections c LEFT JOIN connection_endpoints e ON e.connection_id=c.id GROUP BY c.id HAVING count(e.port_id) <> 2');
      assert.deepEqual(invalid, []);
      const countOld = async () => (await db.query('SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM project_devices) AS devices'))[0];
      const before = await countOld();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'EnforceRackServedAreaForeignKey1799000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'EnforceRackLayoutIntegrity1798000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'AddRackLayout1797000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'AddDeviceNetworkProfileAndPortMetadata1796000000000');
      await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'EnforceConnectionEndpointPair1795000000000');
      await db.undoLastMigration();
      assert.equal((await db.query("SELECT to_regclass('public.device_ports') AS table_name"))[0].table_name, 'device_ports');
      assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname LIKE 'check_physical_connection_endpoint_pair_%'"))[0].count, 0);
      assert.deepEqual(await countOld(), before);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM migrations'))[0].count, 5);
      await db.runMigrations();
      assert.equal(await db.showMigrations(), false);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgname LIKE 'check_physical_connection_endpoint_pair_%'"))[0].count, 2);
      assert.deepEqual(await countOld(), before);
    });
  } finally {
    if (app) await app.close();
    if (db.isInitialized) await db.destroy();
    if (originalDatabase === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = originalDatabase;
    // Only the generated database successfully created by this run is ever dropped.
    if (created) await admin.query('DROP DATABASE "' + databaseName + '"');
    await admin.end();
  }
});
