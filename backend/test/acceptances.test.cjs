const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const dto = require('../dist/acceptances/acceptance.dto');
const { canonical } = require('../dist/acceptances/acceptances.service');
const valid = async (type, body) => (await validate(plainToInstance(type, body), { whitelist: true })).length === 0;

test('acceptance DTO normalization, null, selection and version validation', async () => {
  const body = { code: ' ac-01 ', title: ' Acceptance ', systemId: randomUUID(), inspectionIds: [], evidenceIds: [], note: null };
  const instance = plainToInstance(dto.CreateAcceptanceDto, body);
  assert.equal(instance.code, 'AC-01'); assert.equal(instance.title, 'Acceptance');
  assert.equal(await valid(dto.CreateAcceptanceDto, body), true);
  for (const key of ['code', 'title', 'systemId', 'inspectionIds', 'evidenceIds']) {
    for (const value of [null, undefined, '']) assert.equal(await valid(dto.CreateAcceptanceDto, { ...body, [key]: value }), false);
  }
  assert.equal(await valid(dto.CreateAcceptanceDto, { ...body, title: '  ' }), false);
  const id = randomUUID();
  assert.equal(await valid(dto.CreateAcceptanceDto, { ...body, inspectionIds: [id, id] }), false);
  for (const key of ['code', 'title', 'inspectionIds', 'evidenceIds', 'expectedVersion']) assert.equal(await valid(dto.UpdateAcceptanceDto, { expectedVersion: 1, [key]: null }), false);
  assert.equal(await valid(dto.UpdateAcceptanceDto, { expectedVersion: 1, note: null, inspectionIds: [] }), true);
  assert.equal(await valid(dto.ConfirmAcceptanceDto, { expectedVersion: 1, expectedSourceFingerprint: 'a'.repeat(64) }), true);
  assert.equal(await valid(dto.ConfirmAcceptanceDto, { expectedVersion: 1, expectedSourceFingerprint: null }), false);
  assert.equal(await valid(dto.ReplacementAcceptanceDto, { code: 'AC-02', title: 'New', reason: ' ' }), false);
  const replacement = { code: 'AC-02', title: 'New', reason: 'Correction', inspectionIds: [], evidenceIds: [] };
  assert.equal(await valid(dto.ReplacementAcceptanceDto, replacement), true);
  for (const key of ['inspectionIds', 'evidenceIds']) {
    for (const value of [undefined, null, '', [id, id], ['invalid']]) {
      assert.equal(await valid(dto.ReplacementAcceptanceDto, { ...replacement, [key]: value }), false);
    }
  }
});
test('fingerprint serialization is stable for key order and dates', () => {
  const date = new Date('2026-01-01T00:00:00Z');
  assert.equal(canonical({ b: date, a: { c: 1, b: null } }), canonical({ a: { b: null, c: 1 }, b: date.toISOString() }));
});
