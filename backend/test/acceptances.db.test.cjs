// All writes, down/up and storage faults are confined to disposable DB/storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource } = require('../dist/database/data-source');
const { AcceptancesService } = require('../dist/acceptances/acceptances.service');
const { AcceptanceSnapshot, AcceptanceEvidence, ProjectAcceptance } = require('../dist/acceptances/acceptance.entities');
const { EvidenceService } = require('../dist/evidence/evidence.service');
const { EvidenceStorage } = require('../dist/evidence/evidence.storage');
const { EvidenceAttachment } = require('../dist/evidence/evidence.entity');
const { InspectionsService } = require('../dist/inspections/inspections.service');
const { seedTemplates } = require('../dist/inspections/seed-templates');
const { User } = require('../dist/users/user.entity');
const { Project } = require('../dist/projects/project.entity');
const { ProjectSystem } = require('../dist/projects/project-system.entity');
const { ProjectArea } = require('../dist/projects/project-area.entity');
const { ProjectDevice } = require('../dist/devices/project-device.entity');
const { ProjectDeviceSystem } = require('../dist/devices/project-device-system.entity');
const { ProjectTask } = require('../dist/tasks/project-task.entity');
const { InspectionItem, ProjectInspection } = require('../dist/inspections/inspection.entities');
const rejects = (promise, status) => assert.rejects(promise, e => e.getStatus?.() === status);
const png = Buffer.from([137,80,78,71,13,10,26,10,0]);

async function race(db, storage, firstAction, secondAction) {
  const runners = [db.createQueryRunner(), db.createQueryRunner()];
  let release, ready, failed;
  const gate = new Promise(r => { release = r; });
  const prepared = new Promise((r, j) => { ready = r; failed = j; });
  const settle = p => p.then(value => ({ value }), error => ({ error }));
  let first, second;
  const services = (runner, hold) => {
    const wrapped = { transaction: async (...args) => {
      try {
        await runner.startTransaction(typeof args[0] === 'string' ? args[0] : undefined);
        await runner.query("SET LOCAL lock_timeout='8s'"); await runner.query("SET LOCAL statement_timeout='12s'");
        const value = await args.at(-1)(runner.manager);
        if (hold) { ready(); await gate; }
        await runner.commitTransaction(); return value;
      } catch (error) { if (hold) failed(error); if (runner.isTransactionActive) await runner.rollbackTransaction(); throw error; }
    } };
    const evidence = new EvidenceService(wrapped, storage);
    return { acceptances: new AcceptancesService(wrapped, storage, evidence), inspections: new InspectionsService(wrapped), evidence };
  };
  try {
    await Promise.all(runners.map(r => r.connect()));
    const [ap, bp] = await Promise.all(runners.map(async r => (await r.query('SELECT pg_backend_pid() pid'))[0].pid));
    first = settle(firstAction(services(runners[0], true))); await prepared;
    second = settle(secondAction(services(runners[1], false)));
    let blocked = false; const end = Date.now() + 6000;
    do {
      blocked = (await db.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) blocked', [ap, bp]))[0].blocked;
      if (!blocked) await new Promise(r => setImmediate(r));
    } while (!blocked && Date.now() < end);
    assert.equal(blocked, true, 'independent second connection actually waits for PostgreSQL lock');
    release(); return [await first, await second];
  } finally { release(); if (first) await first; if (second) await second; await Promise.all(runners.map(r => r.release())); }
}

test('Acceptance PostgreSQL/HTTP contract', { timeout: 180000 }, async t => {
  const name = 'acceptance_test_' + randomUUID().replaceAll('-', '');
  const o = dataSource.options;
  const admin = new Client({ host: o.host, port: o.port, user: o.username, password: o.password, database: o.database });
  const db = new DataSource({ ...o, database: name });
  const previous = { DB_NAME: process.env.DB_NAME, JWT_SECRET: process.env.JWT_SECRET, EVIDENCE_STORAGE_DIR: process.env.EVIDENCE_STORAGE_DIR };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-acceptance-'));
  process.env.EVIDENCE_STORAGE_DIR = root;
  let created = false, app;
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`); created = true;
    await db.initialize(); await db.runMigrations();
    const userRepo = db.getRepository(User);
    const manager = await userRepo.save({ email: 'manager@acceptance.invalid', role: 'MANAGER', isActive: true, passwordHash: randomBytes(32).toString('hex') });
    const tech = await userRepo.save({ email: 'tech@acceptance.invalid', role: 'TECHNICIAN', isActive: true, passwordHash: randomBytes(32).toString('hex') });
    const project = await db.getRepository(Project).save({ code: 'AC-A', name: 'Acceptance A', status: 'IN_PROGRESS' });
    const otherProject = await db.getRepository(Project).save({ code: 'AC-B', name: 'Acceptance B' });
    const system = await db.getRepository(ProjectSystem).save({ projectId: project.id, code: 'LAN', name: 'LAN', category: 'LAN' });
    const otherSystem = await db.getRepository(ProjectSystem).save({ projectId: project.id, code: 'LAN-2', name: 'LAN2', category: 'LAN' });
    const foreignSystem = await db.getRepository(ProjectSystem).save({ projectId: otherProject.id, code: 'LAN', name: 'LAN', category: 'LAN' });
    const area = await db.getRepository(ProjectArea).save({ projectId: project.id, code: 'F01', name: 'Floor', type: 'FLOOR' });
    const device = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'CAM-01', name: 'Camera', type: 'CAMERA', areaId: area.id });
    await db.getRepository(ProjectDeviceSystem).save({ projectId: project.id, deviceId: device.id, systemId: system.id });
    const storage = new EvidenceStorage(), evidence = new EvidenceService(db, storage), svc = new AcceptancesService(db, storage, evidence), inspections = new InspectionsService(db);
    await seedTemplates(db); const template = (await inspections.listTemplates('LAN', manager))[0];
    let serial = 0;
    const sheet = (extra = {}) => inspections.createInspection(project.id, { code: 'S-' + (++serial), title: 'Inspection', systemId: system.id, templateId: template.id, ...extra }, manager);
    const pass = async s => { for (const item of s.items) await inspections.putResult(project.id, s.id, item.id, { expectedVersion: item.version, result: 'PASS', note: 'Verified' }, manager); return inspections.getInspection(project.id, s.id, manager); };
    const draft = (s, evidenceIds = [], extra = {}) => svc.create(project.id, { code: 'AC-' + (++serial), title: 'Acceptance', systemId: system.id, inspectionIds: s ? [s.id] : [], evidenceIds, ...extra }, manager);
    const confirm = async a => { const r = await svc.readiness(project.id, a.id, manager); return svc.confirm(project.id, a.id, { expectedVersion: a.version, expectedSourceFingerprint: r.sourceFingerprint }, manager); };
    const upload = async target => {
      await storage.root(); const key = randomUUID(), file = path.join(root, 'tmp', key); await fs.writeFile(file, png);
      return evidence.upload(project.id, target, manager, randomUUID(), { key, path: file, originalName: 'test.png', mimeType: 'image/png', sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), caption: 'Evidence' });
    };
    let confirmed, retained, historical;

    await t.test('selection cross-project/System, scope history, duplicate UUID case, FK and empty PATCH', async () => {
      const s = await sheet({ deviceId: device.id });
      await rejects(draft(s, [], { systemId: otherSystem.id }), 400);
      await rejects(svc.create(otherProject.id, { code: 'BAD', title: 'Bad', systemId: foreignSystem.id, inspectionIds: [s.id], evidenceIds: [] }, manager), 404);
      await rejects(draft(s, [], { inspectionIds: [s.id, s.id.toUpperCase()] }), 400);
      await rejects(draft(s, [], { systemId: foreignSystem.id }), 404);
      const a = await draft(s); await rejects(svc.update(project.id, a.id, { expectedVersion: 1 }, manager), 400);
      await rejects(svc.get(otherProject.id, a.id, manager), 404);
      const anotherSheet = await sheet();
      await assert.rejects(db.query('INSERT INTO acceptance_inspections(project_id,acceptance_id,inspection_id) VALUES($1,$2,$3)', [otherProject.id, a.id, anotherSheet.id]), e => e.code === '23503');
      const offItem = await upload({ inspectionItemId: anotherSheet.items[0].id });
      await rejects(draft(s, [offItem.id]), 400);
      await rejects(svc.create(otherProject.id, { code: 'BAD-FILE', title: 'Bad file', systemId: foreignSystem.id, inspectionIds: [], evidenceIds: [offItem.id] }, manager), 404);
      const failedItem = await inspections.putResult(project.id, anotherSheet.id, anotherSheet.items[0].id, { expectedVersion: 1, result: 'FAIL', issue: { description: 'Outside selection', assigneeId: tech.id } }, manager);
      const offIssue = await upload({ issueId: failedItem.activeIssue.id }); await rejects(draft(s, [offIssue.id]), 400);
      await db.getRepository(ProjectDeviceSystem).delete({ deviceId: device.id });
      await pass(s); assert.equal((await confirm(a)).status, 'CONFIRMED', 'historical inspection survives Device System change');
    });
    await t.test('empty sheet, non-PASS and all non-CLOSED issues block; readiness is advisory', async () => {
      const empty = await sheet(); await db.getRepository(InspectionItem).delete({ inspectionId: empty.id });
      for (const s of [null, empty, await sheet()]) { const a = await draft(s); assert.equal((await svc.readiness(project.id, a.id, manager)).eligible, false); await rejects(confirm(a), 409); }
      const s = await sheet(); let item = await inspections.putResult(project.id, s.id, s.items[0].id, { expectedVersion: 1, result: 'FAIL', issue: { description: 'Fault', assigneeId: tech.id } }, manager);
      let issue = await inspections.startIssue(project.id, item.activeIssue.id, { expectedVersion: 1 }, tech);
      issue = await inspections.resolveIssue(project.id, issue.id, { expectedVersion: issue.version, resolutionNote: 'Fixed' }, tech);
      const a = await draft(s); await rejects(confirm(a), 409);
      await inspections.recheckIssue(project.id, issue.id, { expectedVersion: issue.version, expectedItemVersion: issue.item.version, result: 'PASS', note: 'Passed' }, manager);
      for (const i of s.items.slice(1)) await inspections.putResult(project.id, s.id, i.id, { expectedVersion: 1, result: 'PASS' }, manager);
      assert.equal((await confirm(a)).status, 'CONFIRMED');
    });
    await t.test('fingerprint covers Project/System/Area/Device/actors; stable ordering; stale fingerprint 409', async () => {
      const s = await pass(await sheet({ areaId: area.id })); const a = await draft(s);
      let r = await svc.readiness(project.id, a.id, manager);
      assert.deepEqual(await svc.readiness(project.id, a.id, manager), r);
      for (const [entity, id, changes] of [[Project, project.id, { name: 'Changed Project' }], [ProjectSystem, system.id, { name: 'Changed System' }], [ProjectArea, area.id, { name: 'Changed Area' }], [User, manager.id, { email: 'changed@acceptance.invalid' }]]) {
        await db.getRepository(entity).update(id, changes);
        await rejects(svc.confirm(project.id, a.id, { expectedVersion: 1, expectedSourceFingerprint: r.sourceFingerprint }, manager), 409);
        const next = await svc.readiness(project.id, a.id, manager); assert.notEqual(next.sourceFingerprint, r.sourceFingerprint); r = next;
      }
      await db.getRepository(ProjectDeviceSystem).save({ projectId: project.id, deviceId: device.id, systemId: system.id });
      const ds = await pass(await sheet({ deviceId: device.id })); const da = await draft(ds); const before = await svc.readiness(project.id, da.id, manager);
      await db.getRepository(ProjectDevice).update(device.id, { name: 'Changed Camera' }); assert.notEqual((await svc.readiness(project.id, da.id, manager)).sourceFingerprint, before.sourceFingerprint);
      const two = await draft(null, [], { inspectionIds: [ds.id, s.id] }); const one = await svc.readiness(project.id, two.id, manager);
      await svc.update(project.id, two.id, { expectedVersion: 1, inspectionIds: [s.id, ds.id] }, manager);
      assert.equal((await svc.readiness(project.id, two.id, manager)).sourceFingerprint, one.sourceFingerprint);
    });
    await t.test('missing/hash-corrupt file rolls back confirmation, snapshot and pins; deleted source blocked', async () => {
      const s = await sheet(); const e = await upload({ inspectionItemId: s.items[0].id }); await pass(s);
      const row = await db.getRepository(EvidenceAttachment).findOneByOrFail({ id: e.id }); const a = await draft(s, [e.id]);
      await fs.unlink(path.join(root, 'files', row.storageKey)); await rejects(confirm(a), 503);
      await fs.writeFile(path.join(root, 'files', row.storageKey), Buffer.from('corrupt')); await rejects(confirm(a), 409);
      assert.equal(await db.getRepository(AcceptanceSnapshot).countBy({ acceptanceId: a.id }), 0);
      assert.equal((await db.getRepository(AcceptanceEvidence).findOneBy({ acceptanceId: a.id })).pinnedStorageKey, null);
      assert.equal((await svc.get(project.id, a.id, manager)).status, 'DRAFT'); await fs.writeFile(path.join(root, 'files', row.storageKey), png);
      // Task source allows soft deletion while draft is being prepared.
      const task = await db.getRepository(ProjectTask).save({ projectId: project.id, systemId: system.id, code: 'TASK-' + (++serial), title: 'Task', assigneeId: tech.id });
      const te = await upload({ taskId: task.id }); const ta = await draft(s, [te.id]); await evidence.remove(project.id, te.id, { expectedVersion: 1, reason: 'Removed' }, manager);
      await rejects(confirm(ta), 409); await rejects(svc.file(project.id, ta.id, te.id, manager, false), 404);
      await rejects(draft(s, [te.id]), 409);
      const foreignTask = await db.getRepository(ProjectTask).save({ projectId: project.id, systemId: otherSystem.id, code: 'TASK-' + (++serial), title: 'Other System', assigneeId: tech.id });
      const fe = await upload({ taskId: foreignTask.id }); await rejects(draft(s, [fe.id]), 400);
    });
    await t.test('immutable snapshot, Technician whitelist, historical pin survives source caption/delete; Project.status unchanged', async () => {
      const s = await pass(await sheet()); const task = await db.getRepository(ProjectTask).save({ projectId: project.id, systemId: system.id, code: 'TASK-' + (++serial), title: 'Task', assigneeId: tech.id });
      retained = await upload({ taskId: task.id }); const a = await draft(s, [retained.id]);
      const status = (await db.getRepository(Project).findOneBy({ id: project.id })).status;
      confirmed = await confirm(a); historical = confirmed.snapshot;
      await rejects(svc.update(project.id, a.id, { expectedVersion: 2, title: 'Rewrite' }, manager), 409);
      await rejects(confirm(confirmed), 409);
      await inspections.putResult(project.id, s.id, s.items[0].id, { expectedVersion: 2, result: 'NOT_CHECKED', note: 'Later check' }, manager);
      await db.getRepository(Project).update(project.id, { name: 'Later name' });
      await evidence.update(project.id, retained.id, { expectedVersion: 1, caption: 'Later caption' }, manager);
      await evidence.remove(project.id, retained.id, { expectedVersion: 2, reason: 'Source deleted' }, manager);
      await rejects(evidence.content(project.id, retained.id, manager, false), 404);
      const file = await svc.file(project.id, a.id, retained.id, manager, false); assert.deepEqual(await file.handle.readFile(), png); await file.handle.close();
      assert.deepEqual((await svc.get(project.id, a.id, manager)).snapshot, historical);
      const summary = await svc.get(project.id, a.id, tech);
      assert.deepEqual(Object.keys(summary).sort(), ['id','projectId','systemId','code','title','status','version','confirmedAt','replacesId','replacedById','project','system','summary'].sort());
      assert.equal(JSON.stringify(summary).includes('Verified'), false); assert.equal('snapshot' in summary, false);
      await rejects(svc.file(project.id, a.id, retained.id, tech, false), 403);
      const d = await draft(s); await rejects(svc.get(project.id, d.id, tech), 404); await rejects(svc.readiness(project.id, d.id, tech), 403);
      assert.equal((await db.getRepository(Project).findOneBy({ id: project.id })).status, status);
    });
    await t.test('two confirms serialize: exactly one succeeds; no duplicate snapshot', async () => {
      const a = await draft(await pass(await sheet())); const r = await svc.readiness(project.id, a.id, manager); const dto = { expectedVersion: 1, expectedSourceFingerprint: r.sourceFingerprint };
      const [first, second] = await race(db, storage, s => s.acceptances.confirm(project.id, a.id, dto, manager), s => s.acceptances.confirm(project.id, a.id, dto, manager));
      assert.equal(first.value.status, 'CONFIRMED'); assert.equal(second.error.getStatus(), 409); assert.equal(await db.getRepository(AcceptanceSnapshot).countBy({ acceptanceId: a.id }), 1);
    });
    await t.test('confirm vs checklist mutation in both lock orders: historical snapshot or stale fingerprint, never mixed state', async () => {
      for (const confirmFirst of [true, false]) {
        const s = await pass(await sheet()), a = await draft(s), r = await svc.readiness(project.id, a.id, manager);
        const c = x => x.acceptances.confirm(project.id, a.id, { expectedVersion: 1, expectedSourceFingerprint: r.sourceFingerprint }, manager);
        const mutate = x => x.inspections.putResult(project.id, s.id, s.items[0].id, { expectedVersion: 2, result: 'NOT_CHECKED' }, manager);
        const [first, second] = await race(db, storage, confirmFirst ? c : mutate, confirmFirst ? mutate : c);
        assert.ok(first.value);
        if (confirmFirst) { assert.equal(second.value.result, 'NOT_CHECKED'); assert.equal((await svc.get(project.id, a.id, manager)).snapshot.content.inspections[0].items[0].result, 'PASS'); }
        else { assert.equal(second.error.getStatus(), 409); assert.equal((await svc.get(project.id, a.id, manager)).snapshot, null); }
      }
    });
    await t.test('confirm vs evidence soft delete in both lock orders: pinned file or rejection', async () => {
      for (const confirmFirst of [true, false]) {
        const s = await pass(await sheet()); const task = await db.getRepository(ProjectTask).save({ projectId: project.id, systemId: system.id, code: 'TASK-' + (++serial), title: 'Task', assigneeId: tech.id });
        const e = await upload({ taskId: task.id }), a = await draft(s, [e.id]), r = await svc.readiness(project.id, a.id, manager);
        const c = x => x.acceptances.confirm(project.id, a.id, { expectedVersion: 1, expectedSourceFingerprint: r.sourceFingerprint }, manager);
        const remove = x => x.evidence.remove(project.id, e.id, { expectedVersion: 1, reason: 'Race' }, manager);
        const [first, second] = await race(db, storage, confirmFirst ? c : remove, confirmFirst ? remove : c);
        assert.equal(first.error, undefined); assert.equal(second.error?.getStatus(), confirmFirst ? undefined : 409);
        if (confirmFirst) { const file = await svc.file(project.id, a.id, e.id, manager, false); assert.deepEqual(await file.handle.readFile(), png); await file.handle.close(); }
        else assert.equal((await svc.get(project.id, a.id, manager)).status, 'DRAFT');
      }
    });
    await t.test('replacement candidates serialize; old retained; further replacement only from latest', async () => {
      const original = await confirm(await draft(await pass(await sheet())));
      const make = code => svc.replacement(project.id, original.id, { code, title: 'Replacement', reason: 'Correction', inspectionIds: original.inspectionIds, evidenceIds: [] }, manager);
      const a = await make('REP-A'), b = await make('REP-B');
      assert.equal((await svc.get(project.id, original.id, manager)).replacedById, null);
      const ra = await svc.readiness(project.id, a.id, manager), rb = await svc.readiness(project.id, b.id, manager);
      const [first, second] = await race(db, storage,
        s => s.acceptances.confirm(project.id, a.id, { expectedVersion: 1, expectedSourceFingerprint: ra.sourceFingerprint }, manager),
        s => s.acceptances.confirm(project.id, b.id, { expectedVersion: 1, expectedSourceFingerprint: rb.sourceFingerprint }, manager));
      assert.equal(first.value.status, 'CONFIRMED'); assert.equal(second.error.getStatus(), 409);
      assert.equal((await svc.get(project.id, original.id, manager)).replacedById, a.id);
      assert.deepEqual((await svc.get(project.id, original.id, manager)).snapshot, original.snapshot);
      await rejects(make('REP-OLD'), 409);
      const next = await svc.replacement(project.id, a.id, { code: 'REP-NEXT', title: 'Next', reason: 'Next correction', inspectionIds: a.inspectionIds, evidenceIds: [] }, manager);
      await confirm(next); assert.equal((await svc.get(project.id, a.id, manager)).replacedById, next.id);
    });
    await t.test('Nest boots; HTTP JWT/roles/summary, validation/version/content and cross-project', async http => {
      process.env.DB_NAME = name; process.env.JWT_SECRET = randomBytes(48).toString('hex');
      const { NestFactory } = require('@nestjs/core'), { ValidationPipe } = require('@nestjs/common'), { JwtService } = require('@nestjs/jwt');
      const { AppModule } = require('../dist/app.module');
      app = await NestFactory.create(AppModule, { logger: false }); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.listen(0, '127.0.0.1');
      const base = await app.getUrl(), jwt = app.get(JwtService);
      const auth = u => ({ Authorization: 'Bearer ' + jwt.sign({ sub: u.id, authVersion: u.authVersion }), 'Content-Type': 'application/json' });
      const send = (method, url, user, body) => fetch(base + url, { method, headers: user ? auth(user) : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const prefix = `/projects/${project.id}/acceptances`, url = prefix + '/' + confirmed.id;
      assert.equal((await send('GET', '/health')).status, 200); assert.equal((await (await send('GET', '/health')).json()).database, 'connected');
      assert.equal((await send('GET', prefix)).status, 401); assert.equal((await send('POST', prefix, tech, {})).status, 403);
      const result = await send('GET', url, tech); assert.equal(result.status, 200); assert.deepEqual(await result.json(), JSON.parse(JSON.stringify(await svc.get(project.id, confirmed.id, tech))));
      for (const suffix of ['/readiness', `/files/${retained.id}/content`, `/files/${retained.id}/preview`]) assert.equal((await send('GET', url + suffix, tech)).status, 403);
      assert.equal((await send('GET', url + `/files/${retained.id}/content`)).status, 401);
      const file = await send('GET', url + `/files/${retained.id}/content`, manager); assert.equal(file.status, 200); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      assert.equal((await send('GET', `/projects/${otherProject.id}/acceptances/${confirmed.id}`, manager)).status, 404);
      const readySheet = await pass(await sheet());
      const createResponse = await send('POST', prefix, manager, { code: 'HTTP-AC', title: 'HTTP acceptance', systemId: system.id, inspectionIds: [readySheet.id], evidenceIds: [] });
      assert.equal(createResponse.status, 201); const d = await createResponse.json(); const du = prefix + '/' + d.id;
      assert.equal((await send('POST', prefix, manager, { code: 'HTTP-AC', title: 'Duplicate', systemId: system.id, inspectionIds: [], evidenceIds: [] })).status, 409);
      assert.equal((await send('GET', prefix + '?status=UNKNOWN', manager)).status, 400);
      assert.equal((await send('GET', prefix + '?systemId=' + system.id, manager)).status, 200);
      assert.equal((await send('GET', du, tech)).status, 404);
      for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, title: null }, { expectedVersion: 1, inspectionIds: null }]) assert.equal((await send('PATCH', du, manager, body)).status, 400);
      assert.equal((await send('PATCH', du, manager, { expectedVersion: 2, note: null })).status, 409);
      assert.equal((await send('PATCH', du, manager, { expectedVersion: 1, note: null })).status, 200);
      const read = await (await send('GET', du + '/readiness', manager)).json();
      const response = await send('POST', du + '/confirm', manager, { expectedVersion: 2, expectedSourceFingerprint: read.sourceFingerprint }); assert.equal(response.status, 200);
      const detail = JSON.stringify(await response.json()); for (const secret of ['passwordHash', 'storageKey', 'pinnedStorageKey']) assert.equal(detail.includes(secret), false);
      assert.equal((await send('POST', du + '/replacement', tech, { code: 'HTTP-REP', title: 'Replacement', reason: 'Fix' })).status, 403);
      const replaced = await send('POST', du + '/replacement', manager, { code: 'HTTP-REP', title: 'Replacement', reason: 'Fix', inspectionIds: [], evidenceIds: [] }); assert.equal(replaced.status, 201); assert.equal((await replaced.json()).replacesId, d.id);
      assert.equal((await send('GET', prefix + '?status=DRAFT', tech)).status, 200); assert.deepEqual(await (await send('GET', prefix + '?status=DRAFT', tech)).json(), []);
      await http.test('HTTP replacement uses fresh selections after source Task moves System; old snapshot and pin survive', async () => {
        const taskResponse = await send('POST', `/projects/${project.id}/tasks`, manager, {
          code: 'TASK-REPLACEMENT', title: 'Replacement source', systemId: system.id, assigneeId: tech.id,
        });
        assert.equal(taskResponse.status, 201); const task = await taskResponse.json(); assert.equal(task.status, 'ASSIGNED');
        const sourceSheet = await pass(await sheet()), sourceFile = await upload({ taskId: task.id });
        const original = await confirm(await draft(sourceSheet, [sourceFile.id]));
        const oldSnapshot = original.snapshot;
        const oldLinks = await db.getRepository(AcceptanceEvidence).findBy({ acceptanceId: original.id });
        const oldUrl = prefix + '/' + original.id;
        const moved = await send('PATCH', `/projects/${project.id}/tasks/${task.id}`, manager, { systemId: otherSystem.id });
        assert.equal(moved.status, 200); assert.equal((await moved.json()).systemId, otherSystem.id);
        const body = { code: 'HTTP-MOVED-REP', title: 'Corrected', reason: 'Choose current sources', inspectionIds: [], evidenceIds: [] };
        for (const key of ['inspectionIds', 'evidenceIds']) {
          for (const value of [undefined, null, [sourceFile.id, sourceFile.id]]) {
            assert.equal((await send('POST', oldUrl + '/replacement', manager, { ...body, [key]: value })).status, 400);
          }
        }
        const before = await db.getRepository(ProjectAcceptance).count();
        const bad = await send('POST', oldUrl + '/replacement', manager, { ...body, inspectionIds: [sourceSheet.id], evidenceIds: [sourceFile.id] });
        assert.equal(bad.status, 400);
        assert.equal(await db.getRepository(ProjectAcceptance).count(), before);
        assert.equal(await db.getRepository(ProjectAcceptance).existsBy({ projectId: project.id, code: body.code }), false);
        const response = await send('POST', oldUrl + '/replacement', manager, body);
        assert.equal(response.status, 201); const candidate = await response.json();
        assert.deepEqual(candidate.inspectionIds, []); assert.deepEqual(candidate.evidenceIds, []);
        assert.equal((await svc.get(project.id, original.id, manager)).replacedById, null);
        const candidateUrl = prefix + '/' + candidate.id;
        const incomplete = await (await send('GET', candidateUrl + '/readiness', manager)).json();
        assert.equal(incomplete.eligible, false);
        const updated = await send('PATCH', candidateUrl, manager, { expectedVersion: 1, inspectionIds: [sourceSheet.id], evidenceIds: [] });
        assert.equal(updated.status, 200);
        const current = await (await send('GET', candidateUrl + '/readiness', manager)).json();
        assert.equal((await send('POST', candidateUrl + '/confirm', manager, { expectedVersion: 1, expectedSourceFingerprint: current.sourceFingerprint })).status, 409);
        assert.equal((await send('POST', candidateUrl + '/confirm', manager, { expectedVersion: 2, expectedSourceFingerprint: current.sourceFingerprint })).status, 200);
        const old = await (await send('GET', oldUrl, manager)).json();
        assert.equal(old.replacedById, candidate.id); assert.deepEqual(old.snapshot, JSON.parse(JSON.stringify(oldSnapshot)));
        assert.deepEqual(await db.getRepository(AcceptanceEvidence).findBy({ acceptanceId: original.id }), oldLinks);
        const pinned = await send('GET', oldUrl + `/files/${sourceFile.id}/content`, manager);
        assert.equal(pinned.status, 200); assert.deepEqual(Buffer.from(await pinned.arrayBuffer()), png);
      });
      await app.close(); app = undefined;
    });
    await t.test('isolated migration down/up preserves every older business row and disk file', async () => {
      const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('migrations','project_acceptances','acceptance_inspections','acceptance_evidence','acceptance_snapshots') ORDER BY tablename")).map(r => r.tablename);
      const before = {};
      for (const table of tables) before[table] = await db.query(table === 'users'
        ? 'SELECT id,email,role,is_active FROM users ORDER BY id'
        : `SELECT * FROM "${table}" ORDER BY to_jsonb("${table}")::text`);
      const files = (await fs.readdir(path.join(root, 'files'))).sort();
      await db.undoLastMigration(); // Remove the later User security migration before testing acceptance down.
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateProjectAcceptances1802000000000');
      await db.undoLastMigration(); assert.equal((await db.query("SELECT to_regclass('project_acceptances') name"))[0].name, null);
      for (const table of tables) assert.deepEqual(await db.query(table === 'users'
        ? 'SELECT id,email,role,is_active FROM users ORDER BY id'
        : `SELECT * FROM "${table}" ORDER BY to_jsonb("${table}")::text`), before[table]);
      assert.deepEqual((await fs.readdir(path.join(root, 'files'))).sort(), files); await db.runMigrations(); assert.equal(await db.showMigrations(), false);
    });
  } finally {
    if (app) await app.close(); if (db.isInitialized) await db.destroy();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(root).startsWith('elv-acceptance-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
