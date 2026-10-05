const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const { CreatePortDto, UpdatePortDto, CreateConnectionDto, RewireDto, TraceQueryDto, ConnectionsQueryDto } = require('../dist/connections/dto/connection.dto.js');
const { ConnectionsController } = require('../dist/connections/connections.controller.js');
const { ConnectionsService } = require('../dist/connections/connections.service.js');
const { ROLES_KEY } = require('../dist/auth/roles.decorator.js');
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const transform = (metatype, body) => pipe.transform(body, { type: 'body', metatype });
const bad = promise => assert.rejects(promise, error => error.getStatus?.() === 400);
const route = () => ({ kind: 'PATCH', a: { portId: randomUUID(), side: 'SINGLE' }, b: { portId: randomUUID(), side: 'SINGLE' } });

test('port DTO normalizes labels; description remains nullable; required fields reject null/blank', async () => {
  const dto = await transform(CreatePortDto, { code: ' p01 ', description: ' Gi1/0/1 ' });
  assert.equal(dto.code, 'P01'); assert.equal(dto.description, 'Gi1/0/1');
  assert.equal((await transform(UpdatePortDto, { description: null })).description, null);
  for (const Type of [CreatePortDto, UpdatePortDto]) {
    for (const code of [null, '', ' ', 'Gi1/0/1', 'A--B', 1]) await bad(transform(Type, { code }));
    await bad(transform(Type, { code: 'P01', description: 12 }));
  }
  await bad(transform(CreatePortDto, {}));
});

test('connection DTO validates both endpoint objects, UUIDs/sides/kind and integer expectedVersion', async () => {
  const base = route();
  assert.equal((await transform(CreateConnectionDto, { ...base, label: null, description: null })).label, null);
  for (const key of ['a', 'b']) {
    for (const value of [null, [], [base.a], '', 1, {}, { portId: null, side: 'SINGLE' }, { portId: randomUUID(), side: null }, { portId: 'bad', side: 'FRONT' }]) {
      await bad(transform(CreateConnectionDto, { ...base, [key]: value }));
    }
    const missing = { ...base }; delete missing[key];
    await bad(transform(CreateConnectionDto, missing));
  }
  for (const kind of [undefined, null, 'DIRECT', 1]) await bad(transform(CreateConnectionDto, { ...base, kind }));
  for (const expectedVersion of [undefined, null, 0, -1, 1.5, '1', 2147483647]) await bad(transform(RewireDto, { ...base, expectedVersion }));
  assert.equal((await transform(RewireDto, { ...base, expectedVersion: 1 })).expectedVersion, 1);
});

test('trace/filter query validation does not silently accept missing codes or null UUID', async () => {
  assert.equal((await transform(TraceQueryDto, { deviceCode: ' cam-01 ' })).deviceCode, 'CAM-01');
  for (const deviceCode of [undefined, null, '', 'bad/code']) await bad(transform(TraceQueryDto, { deviceCode }));
  for (const deviceId of [null, '', 'bad']) await bad(transform(ConnectionsQueryDto, { deviceId }));
  assert.equal((await transform(ConnectionsQueryDto, {})).deviceId, undefined);
});

test('all writes require MANAGER in both controller and service', async () => {
  const service = new ConnectionsService({ transaction() { throw new Error('must not access database'); } });
  const user = { role: 'TECHNICIAN' }, id = randomUUID();
  const calls = [
    ['createPort', [id, id, {}, user]], ['updatePort', [id, id, id, {}, user]],
    ['deletePort', [id, id, id, user]], ['createConnection', [id, {}, user]],
    ['rewire', [id, id, {}, user]], ['deleteConnection', [id, id, user]],
  ];
  for (const [method, args] of calls) {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ConnectionsController.prototype[method]), ['MANAGER']);
    await assert.rejects(service[method](...args), error => error.getStatus?.() === 403);
  }
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ConnectionsController), ['MANAGER', 'TECHNICIAN']);
});
