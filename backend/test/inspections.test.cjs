const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const dto = require('../dist/inspections/dto/inspection.dto.js');
const valid = async (type, body) => (await validate(plainToInstance(type, body), { whitelist: true })).length === 0;

test('inspection creation normalizes code/title, requires IDs, allows nullable scope', async () => {
  const body = { code: ' check-01 ', title: ' Check ', systemId: randomUUID(), templateId: randomUUID(), areaId: null, deviceId: null };
  const instance = plainToInstance(dto.CreateInspectionDto, body);
  assert.equal(instance.code, 'CHECK-01'); assert.equal(instance.title, 'Check');
  assert.equal(await valid(dto.CreateInspectionDto, body), true);
  for (const key of ['code', 'title', 'systemId', 'templateId']) {
    for (const value of [null, '', undefined]) assert.equal(await valid(dto.CreateInspectionDto, { ...body, [key]: value }), false);
  }
});

test('result/version validation rejects null, empty, invalid enum and malformed nested issue', async () => {
  assert.equal(await valid(dto.PutInspectionResultDto, { expectedVersion: 1, result: 'PASS', note: null }), true);
  for (const body of [{}, { expectedVersion: null, result: 'PASS' }, { expectedVersion: 1, result: null },
    { expectedVersion: 0, result: 'PASS' }, { expectedVersion: '1', result: 'FAIL' },
    { expectedVersion: 1, result: 'UNKNOWN' }, { expectedVersion: 1, result: 'FAIL', issue: {} },
    { expectedVersion: 1, result: 'FAIL', issue: [] },
    { expectedVersion: 1, result: 'FAIL', issue: { description: ' ', assigneeId: randomUUID() } },
    { expectedVersion: 1, result: 'PASS', note: 2 }]) assert.equal(await valid(dto.PutInspectionResultDto, body), false);
});

test('issue action DTOs require versions and nonblank notes, recheck both versions', async () => {
  for (const type of [dto.VersionDto, dto.AssignIssueDto, dto.ResolveIssueDto, dto.RecheckIssueDto]) {
    assert.equal(await valid(type, {}), false);
  }
  assert.equal(await valid(dto.AssignIssueDto, { expectedVersion: 1, assigneeId: null }), false);
  assert.equal(await valid(dto.ResolveIssueDto, { expectedVersion: 1, resolutionNote: '  ' }), false);
  const body = { expectedVersion: 2, expectedItemVersion: 3, result: 'PASS', note: ' verified ' };
  assert.equal(await valid(dto.RecheckIssueDto, body), true);
  for (const key of ['expectedVersion', 'expectedItemVersion', 'result', 'note']) {
    assert.equal(await valid(dto.RecheckIssueDto, { ...body, [key]: null }), false);
  }
  assert.equal(await valid(dto.RecheckIssueDto, { ...body, result: 'NOT_CHECKED' }), false);
});
