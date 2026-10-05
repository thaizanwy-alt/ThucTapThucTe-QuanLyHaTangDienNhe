const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationPipe } = require('@nestjs/common');
const { PutDeviceNetworkProfileDto } = require('../dist/devices/dto/network-profile.dto.js');
const { CreatePortDto, UpdatePortDto } = require('../dist/connections/dto/connection.dto.js');
const { DevicesController } = require('../dist/devices/devices.controller.js');
const { ROLES_KEY } = require('../dist/auth/roles.decorator.js');

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const validate = (metatype, value) => pipe.transform(value, { type: 'body', metatype });
const bad = value => assert.rejects(value, error => error.getStatus?.() === 400);

test('PUT network profile requires every key; nullable values, IPv4 and normalized MAC', async () => {
  const full = { addressMode: 'STATIC', ipAddress: '192.168.10.20', macAddress: ' aa:bb:cc:dd:ee:ff ' };
  const dto = await validate(PutDeviceNetworkProfileDto, full);
  assert.equal(dto.macAddress, 'AA:BB:CC:DD:EE:FF');
  assert.deepEqual(Object.keys(await validate(PutDeviceNetworkProfileDto,
    { addressMode: null, ipAddress: null, macAddress: null })).sort(), ['addressMode', 'ipAddress', 'macAddress']);
  for (const key of Object.keys(full)) {
    const missing = { ...full }; delete missing[key];
    await bad(validate(PutDeviceNetworkProfileDto, missing));
  }
  for (const value of ['BOGUS', '', 1]) await bad(validate(PutDeviceNetworkProfileDto, { ...full, addressMode: value }));
  for (const value of ['999.1.1.1', '2001:db8::1', '', 123]) await bad(validate(PutDeviceNetworkProfileDto, { ...full, ipAddress: value }));
  for (const value of ['AA-BB-CC-DD-EE-FF', 'AA:BB:CC:DD:EE', '', 123]) await bad(validate(PutDeviceNetworkProfileDto, { ...full, macAddress: value }));
});

test('switch port DTO bounds VLAN and checks nullable PoE', async () => {
  for (const Type of [CreatePortDto, UpdatePortDto]) {
    const data = Type === CreatePortDto ? { code: 'P01' } : {};
    for (const value of [0, 4095, 1.5, '20', false]) await bad(validate(Type, { ...data, accessVlanId: value }));
    for (const value of [1, 4094, null]) assert.equal((await validate(Type, { ...data, accessVlanId: value })).accessVlanId, value);
    for (const value of ['true', 1]) await bad(validate(Type, { ...data, poeEnabled: value }));
    for (const value of [true, false, null]) assert.equal((await validate(Type, { ...data, poeEnabled: value })).poeEnabled, value);
  }
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, DevicesController.prototype.putNetworkProfile), ['MANAGER']);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, DevicesController), ['MANAGER', 'TECHNICIAN']);
});
