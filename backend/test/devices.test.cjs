const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const { ROLES_KEY } = require('../dist/auth/roles.decorator.js');
const { UserRole } = require('../dist/users/user-role.enum.js');
const { DevicesController } = require('../dist/devices/devices.controller.js');
const { DevicesService } = require('../dist/devices/devices.service.js');
const { DeviceType } = require('../dist/devices/device-type.enum.js');
const { CreateProjectDeviceDto, UpdateProjectDeviceDto } = require('../dist/devices/dto/device.dto.js');

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const transform = (Type, body) => pipe.transform(body, { type: 'body', metatype: Type });
const rejectsStatus = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);

test('device DTO normalizes code/text and accepts nullable fields and distinct systemIds', async () => {
  assert.equal(Object.keys(DeviceType).length, 6);
  for (const type of Object.values(DeviceType)) {
    const dto = await transform(CreateProjectDeviceDto, { type, code: ' dev-01 ', name: ' Thiết bị ', brand: ' Hãng ', systemIds: [randomUUID(), randomUUID()] });
    assert.equal(dto.code, 'DEV-01');
    assert.equal(dto.name, 'Thiết bị');
    assert.equal(dto.brand, 'Hãng');
  }
  const dto = await transform(UpdateProjectDeviceDto, {
    areaId: null, rackId: null, capacityU: null, brand: null, model: null,
    serialNumber: null, description: null, locationNote: null, systemIds: [],
  });
  assert.deepEqual(dto.systemIds, []);
  assert.equal(dto.description, null);
  assert.equal(dto.areaId, null);
});

test('device DTO rejects null, wrong types, malformed codes and immutable type; service rejects empty PATCH', async () => {
  for (const body of [
    { code: null }, { name: null }, { name: '   ' }, { code: 'A--B' }, { code: 'bad code' },
    { type: DeviceType.SWITCH }, { type: null }, { systemIds: null }, { systemIds: 'bad' },
    { systemIds: [randomUUID(), null] }, { areaId: '' }, { rackId: 1 },
    { capacityU: 0 }, { capacityU: 1.5 }, { capacityU: '42' }, { brand: 1 },
  ]) await rejectsStatus(transform(UpdateProjectDeviceDto, body), 400);
  const id = randomUUID();
  await rejectsStatus(transform(UpdateProjectDeviceDto, { systemIds: [id, id.toUpperCase()] }), 400);
  for (const body of [{ type: null }, { code: null }, { name: null }]) {
    await rejectsStatus(transform(CreateProjectDeviceDto, { type: DeviceType.RACK, code: 'R-01', name: 'Rack', ...body }), 400);
  }
  const service = new DevicesService({ transaction: () => { throw new Error('empty PATCH must not enter a transaction'); } });
  const manager = { role: UserRole.MANAGER };
  for (const body of [{}, { unexpected: true }]) {
    await rejectsStatus(service.updateDevice(randomUUID(), randomUUID(), await transform(UpdateProjectDeviceDto, body), manager), 400);
  }
});

test('device writes require manager in service and controller; read routes allow both roles', async () => {
  const service = new DevicesService({ transaction: () => { throw new Error('unauthorized write must not enter a transaction'); } });
  const technician = { role: UserRole.TECHNICIAN };
  await rejectsStatus(service.createDevice(randomUUID(), {}, technician), 403);
  await rejectsStatus(service.updateDevice(randomUUID(), randomUUID(), { name: 'X' }, technician), 403);
  await rejectsStatus(service.deleteDevice(randomUUID(), randomUUID(), technician), 403);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, DevicesController), [UserRole.MANAGER, UserRole.TECHNICIAN]);
  for (const method of ['createDevice', 'updateDevice', 'deleteDevice']) {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, DevicesController.prototype[method]), [UserRole.MANAGER]);
  }
});

test('Create and Update capacityU reject integer overflow in ValidationPipe and accept both valid boundaries', async () => {
  for (const Type of [CreateProjectDeviceDto, UpdateProjectDeviceDto]) {
    const base = Type === CreateProjectDeviceDto ? { type: DeviceType.RACK, code: 'R-01', name: 'Rack' } : {};
    await rejectsStatus(transform(Type, { ...base, capacityU: 2147483648 }), 400);
    for (const capacityU of [1, 2147483647]) {
      assert.equal((await transform(Type, { ...base, capacityU })).capacityU, capacityU);
    }
    assert.equal((await transform(Type, { ...base, capacityU: null })).capacityU, null);
    assert.equal((await transform(Type, base)).capacityU, undefined);
  }
});
