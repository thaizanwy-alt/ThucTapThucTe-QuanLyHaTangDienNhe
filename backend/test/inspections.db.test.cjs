// All writes/down tests are confined to a disposable database, never the demo Project.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DataSource } = require('typeorm');
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
const { InspectionsService } = require('../dist/inspections/inspections.service.js');
const { seedTemplates } = require('../dist/inspections/seed-templates.js');
const { ChecklistTemplate, ChecklistTemplateItem, ProjectInspection, InspectionItem, RemediationIssue } = require('../dist/inspections/inspection.entities.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { User } = require('../dist/users/user.entity.js');
const { DevicesService } = require('../dist/devices/devices.service.js');
const rejects = (promise, status) => assert.rejects(promise, e => e.getStatus?.() === status);

// Run the actual service using two independent PostgreSQL transactions. Hold the
// first after its writes, and release COMMIT only after PostgreSQL confirms that
// the second is blocked by that connection (not a timing/Promise.all assumption).
async function orderedRace(db, firstAction, secondAction) {
  const first = db.createQueryRunner(), second = db.createQueryRunner();
  let release, ready, failReady;
  const gate = new Promise(resolve => { release = resolve; });
  const prepared = new Promise((resolve, reject) => { ready = resolve; failReady = reject; });
  const settle = promise => promise.then(value => ({ value }), error => ({ error }));
  let firstResult, secondResult, failure;
  const service = (runner, hold) => new InspectionsService({
    transaction: async work => {
      try {
        await runner.startTransaction('READ COMMITTED');
        await runner.query("SET LOCAL lock_timeout = '8s'");
        await runner.query("SET LOCAL statement_timeout = '12s'");
        const value = await work(runner.manager);
        if (hold) { ready(); await gate; }
        await runner.commitTransaction();
        return value;
      } catch (error) {
        if (hold) failReady(error);
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
      }
    },
  });
  try {
    await first.connect(); await second.connect();
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    assert.notEqual(firstPid, secondPid);
    firstResult = settle(firstAction(service(first, true)));
    await prepared;
    secondResult = settle(secondAction(service(second, false)));
    const deadline = Date.now() + 6000;
    let blocked = false;
    do {
      blocked = (await db.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [firstPid, secondPid]))[0].blocked;
      if (blocked) break;
      await new Promise(resolve => setImmediate(resolve));
    } while (Date.now() < deadline);
    assert.equal(blocked, true, 'second transaction must actually wait for the first PostgreSQL lock');
    release();
    return [await firstResult, await secondResult];
  } catch (error) { failure = error; throw error; }
  finally {
    release();
    if (firstResult) await firstResult;
    if (secondResult) await secondResult;
    const errors = [];
    for (const runner of [first, second]) {
      try { if (runner.isTransactionActive) await runner.rollbackTransaction(); } catch (error) { errors.push(error); }
      try { await runner.release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Inspection race cleanup failed', { cause: failure ?? errors[0] });
  }
}

test('Checklist/Issue PostgreSQL and HTTP contract', { timeout: 180000 }, async t => {
  await withDisposableHttpDb('inspection', async (db, verify) => {
  const name = db.options.database;
  assert.match(name, /^inspection_test_[a-f0-9]{32}$/);
  const previousDb = process.env.DB_NAME, previousJwt = process.env.JWT_SECRET;
  let app, failure;
  try {
    await verify();
    assert.equal(db.options.synchronize, false); assert.equal(await db.showMigrations(), false);
    const svc = new InspectionsService(db);
    const users = db.getRepository(User);
    const makeUser = (email, role, isActive = true) => users.save({ email, role, isActive, passwordHash: randomBytes(32).toString('hex') });
    const manager = await makeUser('manager@check.invalid', 'MANAGER');
    const tech = await makeUser('tech@check.invalid', 'TECHNICIAN');
    const otherTech = await makeUser('other@check.invalid', 'TECHNICIAN');
    const inactive = await makeUser('inactive@check.invalid', 'TECHNICIAN', false);
    const p = await db.getRepository(Project).save({ code: 'CHECK-A', name: 'Check A' });
    const p2 = await db.getRepository(Project).save({ code: 'CHECK-B', name: 'Check B' });
    const systems = db.getRepository(ProjectSystem);
    const lan = await systems.save({ projectId: p.id, code: 'LAN', name: 'LAN', category: 'LAN' });
    const wifi = await systems.save({ projectId: p.id, code: 'WIFI', name: 'WiFi', category: 'WIFI' });
    const otherSystem = await systems.save({ projectId: p2.id, code: 'LAN', name: 'LAN B', category: 'LAN' });
    const area = await db.getRepository(ProjectArea).save({ projectId: p.id, code: 'F01', name: 'Floor', type: 'FLOOR' });
    const otherArea = await db.getRepository(ProjectArea).save({ projectId: p2.id, code: 'F01', name: 'Floor B', type: 'FLOOR' });
    const devices = new DevicesService(db);
    const device = await devices.createDevice(p.id, { code: 'SW-01', name: 'Switch', type: 'SWITCH', systemIds: [lan.id] }, manager);
    const noSystem = await devices.createDevice(p.id, { code: 'SW-02', name: 'Switch 2', type: 'SWITCH' }, manager);
    const otherDevice = await devices.createDevice(p2.id, { code: 'SW-01', name: 'Switch B', type: 'SWITCH' }, manager);
    let template, sheet, item, issue;
    let serial = 0;
    const create = (extra = {}) => svc.createInspection(p.id, { code: 'CHECK-' + (++serial), title: 'Inspection', systemId: lan.id, templateId: template.id, ...extra }, manager);
    const put = (i, result, extra = {}) => svc.putResult(p.id, i.inspectionId, i.id, { expectedVersion: i.version, result, ...extra }, manager);

    await t.test('template seed is idempotent and never overwrites a conflicting published revision', async () => {
      assert.deepEqual(await seedTemplates(db), { templates: 3, items: 9 });
      assert.deepEqual(await seedTemplates(db), { templates: 0, items: 0 });
      const templates = await svc.listTemplates('LAN', manager);
      template = templates[0]; assert.equal(template.items.length, 3);
      await db.getRepository(ChecklistTemplateItem).update(template.items[0].id, { title: 'Changed' });
      await rejects(seedTemplates(db), 409);
      assert.equal((await db.getRepository(ChecklistTemplateItem).findOneBy({ id: template.items[0].id })).title, 'Changed');
      await db.getRepository(ChecklistTemplateItem).update(template.items[0].id, { title: template.items[0].title });
    });

    await t.test('scope, category and device-System are validated at creation only; snapshot is independent', async () => {
      for (const extra of [{ areaId: area.id, deviceId: device.id }]) await rejects(create(extra), 400);
      await rejects(create({ deviceId: noSystem.id }), 400);
      await rejects(create({ areaId: otherArea.id }), 404);
      await rejects(create({ deviceId: otherDevice.id }), 404);
      await rejects(create({ systemId: otherSystem.id }), 404);
      await rejects(create({ systemId: wifi.id }), 409);
      sheet = await create({ code: ' check-main ', title: ' Main ', deviceId: device.id.toUpperCase() });
      assert.equal(sheet.code, 'CHECK-MAIN'); assert.equal(sheet.title, 'Main'); assert.equal(sheet.items.length, 3);
      assert.equal(sheet.passed, false); assert.equal(sheet.summary.notChecked, 3);
      item = sheet.items[0];
      await db.getRepository(ChecklistTemplateItem).update(template.items[0].id, { title: 'New template title' });
      assert.equal((await svc.getInspection(p.id, sheet.id, manager)).items[0].title, item.title);
      await rejects(seedTemplates(db), 409);
      await db.getRepository(ChecklistTemplateItem).update(template.items[0].id, { title: template.items[0].title });
      await devices.updateDevice(p.id, device.id, { systemIds: [] }, manager);
      assert.equal((await svc.getInspection(p.id, sheet.id, manager)).deviceId, device.id);
      await rejects(create({ deviceId: device.id }), 400);
      assert.equal((await create({ areaId: area.id })).areaId, area.id);
      const otherSheet = await create({ areaId: null, deviceId: null });
      assert.equal(otherSheet.deviceId, null);
      await rejects(svc.putResult(p.id, otherSheet.id, item.id, { expectedVersion: item.version, result: 'PASS' }, manager), 404);
      await rejects(create({ code: sheet.code }), 409);
    });

    await t.test('FAIL requires issue; failed transaction leaves item and issue untouched', async () => {
      await rejects(put(item, 'FAIL'), 400);
      await rejects(put(item, 'FAIL', { issue: { description: 'Cable', assigneeId: inactive.id } }), 409);
      await rejects(put(item, 'FAIL', { issue: { description: 'Cable', assigneeId: manager.id } }), 409);
      await verify(); await db.query(`CREATE FUNCTION inspection_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback' USING ERRCODE='23503'; END $$`);
      await verify(); await db.query('CREATE TRIGGER inspection_test_failure BEFORE UPDATE ON inspection_items FOR EACH ROW EXECUTE FUNCTION inspection_test_failure()');
      try { await rejects(put(item, 'FAIL', { issue: { description: 'Cable', assigneeId: tech.id } }), 409); }
      finally { await verify(); await db.query('DROP TRIGGER inspection_test_failure ON inspection_items'); await verify(); await db.query('DROP FUNCTION inspection_test_failure()'); }
      assert.equal(await db.getRepository(RemediationIssue).countBy({ itemId: item.id }), 0);
      assert.equal((await db.getRepository(InspectionItem).findOneBy({ id: item.id })).version, 1);
    });

    await t.test('simultaneous FAIL requests: one success, one 409, exactly one active Issue', async () => {
      const attempts = await Promise.allSettled([1, 2].map(() => put(item, 'FAIL', { issue: { description: 'Cable missing', assigneeId: tech.id } })));
      assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(attempts.find(r => r.status === 'rejected').reason.getStatus(), 409);
      item = attempts.find(r => r.status === 'fulfilled').value; issue = item.activeIssue;
      assert.equal(await db.getRepository(RemediationIssue).countBy({ itemId: item.id }), 1);
      await rejects(put(item, 'PASS'), 409); await rejects(put(item, 'NOT_CHECKED'), 409);
      await rejects(put(item, 'FAIL', { issue: { description: 'Duplicate', assigneeId: tech.id } }), 409);
      const refreshed = await put(item, 'FAIL', { note: 'Still failing' }); item = refreshed;
      assert.equal(refreshed.activeIssue.id, issue.id);
    });

    await t.test('ownership, reassignment and start use current Issue version after locking', async () => {
      assert.equal((await svc.listIssues(p.id, otherTech)).length, 0);
      await rejects(svc.getIssue(p.id, issue.id, otherTech), 404);
      await rejects(svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, otherTech), 404);
      await rejects(svc.getIssue(p2.id, issue.id, manager), 404);
      await rejects(svc.getInspection(p2.id, sheet.id, manager), 404);
      await rejects(svc.putResult(p2.id, sheet.id, item.id, { expectedVersion: item.version, result: 'PASS' }, manager), 404);
      issue = await svc.assignIssue(p.id, issue.id, { expectedVersion: issue.version, assigneeId: otherTech.id }, manager);
      await rejects(svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, tech), 404);
      issue = await svc.assignIssue(p.id, issue.id, { expectedVersion: issue.version, assigneeId: tech.id }, manager);
      const outcomes = await Promise.allSettled([1, 2].map(() => svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, tech)));
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(r => r.status === 'rejected').reason.getStatus(), 409);
      issue = outcomes.find(r => r.status === 'fulfilled').value;
      await rejects(svc.assignIssue(p.id, issue.id, { expectedVersion: issue.version, assigneeId: otherTech.id }, manager), 409);
    });

    await t.test('controlled reassignment/start concurrency respects both serial orders and current ownership', async () => {
      const raceTech = await makeUser('race@check.invalid', 'TECHNICIAN');
      for (const assignFirst of [true, false]) {
        const raceSheet = await create();
        const raceItem = await put(raceSheet.items[0], 'FAIL', { issue: { description: 'Ownership race', assigneeId: tech.id } });
        const original = raceItem.activeIssue;
        const assign = s => s.assignIssue(p.id, original.id, { expectedVersion: original.version, assigneeId: raceTech.id }, manager);
        const start = s => s.startIssue(p.id, original.id, { expectedVersion: original.version }, tech);
        const [winner, loser] = await orderedRace(db, assignFirst ? assign : start, assignFirst ? start : assign);
        assert.equal(winner.error, undefined);
        assert.equal(loser.error?.getStatus(), assignFirst ? 404 : 409);
        assert.equal(winner.value.version, original.version + 1);
        assert.equal(winner.value.status, assignFirst ? 'OPEN' : 'IN_PROGRESS');
        assert.equal(winner.value.assigneeId, assignFirst ? raceTech.id : tech.id);
        const stored = await db.getRepository(RemediationIssue).findOneByOrFail({ id: original.id });
        assert.equal(stored.version, original.version + 1);
        assert.equal(stored.status, winner.value.status);
        assert.equal(stored.assigneeId, winner.value.assigneeId);
        assert.deepEqual({ ...await db.getRepository(InspectionItem).findOneByOrFail({ id: raceItem.id }) },
          Object.fromEntries(Object.entries(raceItem).filter(([key]) => !['issues', 'activeIssue'].includes(key))));
        if (assignFirst) {
          await rejects(svc.startIssue(p.id, original.id, { expectedVersion: stored.version }, tech), 404);
          const newOwnerStart = await svc.startIssue(p.id, original.id, { expectedVersion: stored.version }, raceTech);
          assert.equal(newOwnerStart.status, 'IN_PROGRESS');
          assert.equal(newOwnerStart.version, original.version + 2);
        }
      }
    });

    await t.test('controlled PUT result/recheck concurrency checks versions without contradictory item/Issue writes', async () => {
      for (const putFirst of [true, false]) {
        const raceSheet = await create();
        const raceItem = await put(raceSheet.items[0], 'FAIL', { issue: { description: 'Result race', assigneeId: tech.id } });
        let original = await svc.startIssue(p.id, raceItem.activeIssue.id, { expectedVersion: 1 }, tech);
        original = await svc.resolveIssue(p.id, original.id, { expectedVersion: original.version, resolutionNote: 'Fixed for race' }, tech);
        const recheck = s => s.recheckIssue(p.id, original.id, {
          expectedVersion: original.version, expectedItemVersion: raceItem.version, result: 'PASS', note: 'Verified race',
        }, manager);
        const update = s => s.putResult(p.id, raceSheet.id, raceItem.id, {
          expectedVersion: raceItem.version, result: 'FAIL', note: 'Still failing race',
          // If recheck wins, stale PUT must fail before creating a new Issue.
          ...(putFirst ? {} : { issue: { description: 'Must not be created', assigneeId: tech.id } }),
        }, manager);
        const [winner, loser] = await orderedRace(db, putFirst ? update : recheck, putFirst ? recheck : update);
        assert.equal(winner.error, undefined);
        assert.equal(loser.error?.getStatus(), 409);
        const storedItem = await db.getRepository(InspectionItem).findOneByOrFail({ id: raceItem.id });
        const storedIssue = await db.getRepository(RemediationIssue).findOneByOrFail({ id: original.id });
        assert.equal(storedItem.version, raceItem.version + 1);
        assert.equal(storedItem.result, putFirst ? 'FAIL' : 'PASS');
        assert.equal(storedItem.note, putFirst ? 'Still failing race' : 'Verified race');
        assert.equal(storedIssue.status, putFirst ? 'RESOLVED' : 'CLOSED');
        assert.equal(storedIssue.version, original.version + (putFirst ? 0 : 1));
        assert.equal(await db.getRepository(RemediationIssue).countBy({ itemId: raceItem.id }), 1);
        if (putFirst) {
          assert.equal(winner.value.version, storedItem.version);
          assert.deepEqual({ ...storedIssue }, Object.fromEntries(Object.entries(original).filter(([key]) =>
            !['assignee', 'item', 'inspectionId', 'inspectionCode', 'systemId', 'areaId', 'deviceId'].includes(key))));
        } else {
          assert.equal(winner.value.status, 'CLOSED');
          assert.equal(winner.value.item.version, storedItem.version);
          assert.equal(storedIssue.reviewedById, manager.id);
          assert.ok(storedIssue.reviewedAt);
        }
        const detail = await svc.getInspection(p.id, raceSheet.id, manager);
        assert.equal(detail.summary.openIssues, putFirst ? 1 : 0);
        assert.equal(detail.items[0].activeIssue?.id ?? null, putFirst ? original.id : null);
      }
    });

    await t.test('resolve leaves FAIL; recheck validates both versions and required return reason', async () => {
      await rejects(svc.resolveIssue(p.id, issue.id, { expectedVersion: issue.version, resolutionNote: ' ' }, tech), 400);
      issue = await svc.resolveIssue(p.id, issue.id, { expectedVersion: issue.version, resolutionNote: 'Fixed cable' }, tech);
      assert.equal(issue.status, 'RESOLVED'); assert.equal(issue.item.result, 'FAIL');
      assert.equal((await svc.getInspection(p.id, sheet.id, manager)).summary.openIssues, 1);
      const body = { expectedVersion: issue.version, expectedItemVersion: item.version, result: 'FAIL', note: 'Still bad', reason: 'Retest failed' };
      await rejects(svc.recheckIssue(p.id, issue.id, { ...body, expectedVersion: issue.version - 1 }, manager), 409);
      await rejects(svc.recheckIssue(p.id, issue.id, { ...body, expectedItemVersion: item.version - 1 }, manager), 409);
      await rejects(svc.recheckIssue(p.id, issue.id, { ...body, reason: null }, manager), 400);
      assert.equal((await svc.getIssue(p.id, issue.id, manager)).status, 'RESOLVED');
      issue = await svc.recheckIssue(p.id, issue.id, body, manager); item = issue.item;
      assert.equal(issue.status, 'OPEN'); assert.equal(issue.resolutionNote, null); assert.equal(issue.resolvedAt, null);
      assert.equal(issue.reviewedAt, null); assert.equal(item.result, 'FAIL'); assert.equal(issue.returnReason, body.reason);
    });

    await t.test('PASS/CLOSED recheck is atomic; CLOSED immutable, future FAIL creates a new Issue', async () => {
      issue = await svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, tech);
      issue = await svc.resolveIssue(p.id, issue.id, { expectedVersion: issue.version, resolutionNote: 'Fixed again' }, tech);
      await verify(); await db.query(`CREATE FUNCTION inspection_test_close_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='CLOSED' THEN RAISE EXCEPTION 'test rollback' USING ERRCODE='23503'; END IF; RETURN NEW; END $$`);
      await verify(); await db.query('CREATE TRIGGER inspection_test_close_failure BEFORE UPDATE ON remediation_issues FOR EACH ROW EXECUTE FUNCTION inspection_test_close_failure()');
      const body = { expectedVersion: issue.version, expectedItemVersion: item.version, result: 'PASS', note: 'Verified' };
      try { await rejects(svc.recheckIssue(p.id, issue.id, body, manager), 409); }
      finally { await verify(); await db.query('DROP TRIGGER inspection_test_close_failure ON remediation_issues'); await verify(); await db.query('DROP FUNCTION inspection_test_close_failure()'); }
      assert.equal((await svc.getIssue(p.id, issue.id, manager)).item.result, 'FAIL');
      const closing = await Promise.allSettled([1, 2].map(() => svc.recheckIssue(p.id, issue.id, body, manager)));
      assert.equal(closing.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(closing.find(r => r.status === 'rejected').reason.getStatus(), 409);
      issue = closing.find(r => r.status === 'fulfilled').value; item = issue.item;
      assert.equal(issue.status, 'CLOSED'); assert.equal(item.result, 'PASS');
      const closed = { ...await db.getRepository(RemediationIssue).findOneBy({ id: issue.id }) };
      await rejects(svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, tech), 409);
      await rejects(svc.assignIssue(p.id, issue.id, { expectedVersion: issue.version, assigneeId: otherTech.id }, manager), 409);
      item = await put(item, 'FAIL', { issue: { description: 'New fault', assigneeId: tech.id } });
      assert.notEqual(item.activeIssue.id, issue.id);
      assert.deepEqual({ ...await db.getRepository(RemediationIssue).findOneBy({ id: issue.id }) }, closed);
      issue = item.activeIssue;
    });

    await t.test('passed requires every item PASS and zero non-CLOSED issues; all active statuses are counted', async () => {
      const current = await svc.getInspection(p.id, sheet.id, manager);
      for (const i of current.items.filter(i => i.id !== item.id)) await put(i, 'PASS');
      for (const action of [null, 'start', 'resolve']) {
        if (action === 'start') issue = await svc.startIssue(p.id, issue.id, { expectedVersion: issue.version }, tech);
        if (action === 'resolve') issue = await svc.resolveIssue(p.id, issue.id, { expectedVersion: issue.version, resolutionNote: 'Fixed' }, tech);
        const state = await svc.getInspection(p.id, sheet.id, manager);
        assert.equal(state.summary.openIssues, 1); assert.equal(state.passed, false);
      }
      issue = await svc.recheckIssue(p.id, issue.id, { expectedVersion: issue.version, expectedItemVersion: item.version, result: 'PASS', note: 'Retested' }, manager);
      const passed = await svc.getInspection(p.id, sheet.id, manager);
      assert.equal(passed.summary.openIssues, 0); assert.equal(passed.summary.pass, 3); assert.equal(passed.passed, true);
      // Defensive summary check even for an inconsistent SQL import outside supported API.
      await db.query('UPDATE remediation_issues SET status=\'OPEN\' WHERE id=$1', [issue.id]);
      assert.equal((await svc.getInspection(p.id, sheet.id, manager)).passed, false);
      await db.query('UPDATE remediation_issues SET status=\'CLOSED\' WHERE id=$1', [issue.id]);
      assert.equal((await svc.listInspections(p.id, manager)).find(s => s.id === sheet.id).passed, true);
    });

    await t.test('real SQL rejects cross-Project FKs, duplicate active issues, null and invalid CHECK values', async () => {
      await assert.rejects(db.query('UPDATE project_inspections SET area_id=$1 WHERE id=$2', [otherArea.id, sheet.id]), e => e.driverError.code === '23514' || e.driverError.code === '23503');
      const scoped = await create({ areaId: area.id });
      await assert.rejects(db.query('UPDATE project_inspections SET area_id=$1 WHERE id=$2', [otherArea.id, scoped.id]), e => e.driverError.code === '23503');
      await assert.rejects(db.query('UPDATE project_inspections SET system_id=$1 WHERE id=$2', [otherSystem.id, scoped.id]), e => e.driverError.code === '23503');
      await assert.rejects(db.query('UPDATE remediation_issues SET project_id=$1 WHERE id=$2', [p2.id, issue.id]), e => e.driverError.code === '23503');
      await assert.rejects(db.query('UPDATE inspection_items SET project_id=$1 WHERE id=$2', [p2.id, item.id]), e => e.driverError.code === '23503');
      await assert.rejects(db.query('UPDATE inspection_items SET version=0 WHERE id=$1', [item.id]), e => e.driverError.code === '23514');
      await assert.rejects(db.query('UPDATE inspection_items SET result=NULL WHERE id=$1', [item.id]), e => e.driverError.code === '23502');
      await assert.rejects(db.query('UPDATE remediation_issues SET description=\' \' WHERE id=$1', [issue.id]), e => e.driverError.code === '23514');
      const open = await put(issue.item, 'FAIL', { issue: { description: 'SQL constraint test', assigneeId: tech.id } });
      await assert.rejects(db.query('INSERT INTO remediation_issues(project_id,item_id,description,assignee_id) VALUES($1,$2,$3,$4)', [p.id, item.id, 'Duplicate', tech.id]), e => e.driverError.code === '23505');
      await assert.rejects(db.query('INSERT INTO remediation_issues(project_id,item_id,description,assignee_id) VALUES($1,$2,$3,$4)', [p2.id, item.id, 'Wrong project', tech.id]), e => e.driverError.code === '23503' || e.driverError.code === '23505');
      issue = open.activeIssue; item = open;
    });

    await t.test('Nest boot, health database connected; HTTP roles/null/ownership/versions and safe response', async () => {
      process.env.DB_NAME = name; process.env.JWT_SECRET = randomBytes(48).toString('hex');
      const { NestFactory } = require('@nestjs/core');
      const { ValidationPipe } = require('@nestjs/common');
      const { JwtService } = require('@nestjs/jwt');
      const { AppModule } = require('../dist/app.module.js');
      app = await NestFactory.create(AppModule, { logger: false });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.listen(0, '127.0.0.1'); await verify(app.get(DataSource));
      assert.equal(app.get(DataSource).options.database, name);
      const base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
      const headers = {};
      for (const u of [manager, tech, otherTech, inactive]) headers[u.id] = { Authorization: 'Bearer ' + await app.get(JwtService).signAsync({ sub: u.id, authVersion: u.authVersion }) };
      const request = async (method, path, body, status, u = manager) => {
        const res = await fetch(base + path, { method, headers: { ...(u ? headers[u.id] : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        assert.equal(res.status, status, `${method} ${path}`);
        const raw = await res.text(); assert.equal(raw.includes('passwordHash'), false); assert.equal(raw.includes('password_hash'), false);
        return raw ? JSON.parse(raw) : undefined;
      };
      assert.deepEqual(await request('GET', '/health', undefined, 200, null), { status: 'ok', database: 'connected' });
      const root = '/projects/' + p.id;
      await request('GET', '/checklist-templates?category=LAN', undefined, 200);
      await request('GET', '/checklist-templates?category=BAD', undefined, 400);
      await request('GET', '/checklist-templates', undefined, 403, tech);
      await request('GET', root + '/inspections', undefined, 401, null);
      await request('GET', root + '/inspections', undefined, 401, inactive);
      await request('GET', root + '/inspections', undefined, 403, tech);
      for (const body of [{}, { code: null, title: 'X', systemId: lan.id, templateId: template.id }]) await request('POST', root + '/inspections', body, 400);
      const body = { code: 'HTTP-CHECK', title: 'HTTP', systemId: lan.id, templateId: template.id };
      await request('POST', root + '/inspections', { ...body, areaId: area.id, deviceId: noSystem.id }, 400);
      await request('POST', root + '/inspections', { ...body, deviceId: noSystem.id }, 400);
      await request('POST', root + '/inspections', { ...body, deviceId: otherDevice.id }, 404);
      const created = await request('POST', root + '/inspections', body, 201);
      await request('POST', root + '/inspections', body, 409);
      await request('POST', root + '/inspections', body, 403, tech);
      const path = root + '/inspections/' + created.id + '/items/' + created.items[0].id + '/result';
      await request('PUT', path, {}, 400);
      await request('PUT', path, { result: null, expectedVersion: 1 }, 400);
      await request('PUT', path, { result: 'PASS', expectedVersion: null }, 400);
      await request('PUT', path, { result: 'PASS', expectedVersion: 1 }, 403, tech);
      const failed = await request('PUT', path, { result: 'FAIL', expectedVersion: 1, issue: { description: 'Fault', assigneeId: tech.id } }, 200);
      await request('PUT', path, { result: 'PASS', expectedVersion: 1 }, 409);
      const issuePath = root + '/issues/' + failed.activeIssue.id;
      await request('GET', issuePath, undefined, 404, otherTech);
      await request('POST', issuePath + '/start', { expectedVersion: 1 }, 404, otherTech);
      await request('GET', '/projects/' + p2.id + '/issues/' + failed.activeIssue.id, undefined, 404);
      await request('GET', '/projects/' + p2.id + '/inspections/' + created.id, undefined, 404);
      await request('POST', issuePath + '/start', { expectedVersion: 1 }, 403);
      await request('POST', issuePath + '/start', {}, 400, tech);
      let result = await request('POST', issuePath + '/start', { expectedVersion: 1 }, 200, tech);
      await request('POST', issuePath + '/resolve', { expectedVersion: result.version, resolutionNote: null }, 400, tech);
      result = await request('POST', issuePath + '/resolve', { expectedVersion: result.version, resolutionNote: 'Fixed' }, 200, tech);
      await request('POST', issuePath + '/recheck', { expectedVersion: result.version, expectedItemVersion: null, result: 'PASS', note: 'OK' }, 400);
      await request('POST', issuePath + '/recheck', { expectedVersion: result.version, expectedItemVersion: failed.version, result: 'PASS', note: 'OK' }, 403, tech);
      await request('POST', issuePath + '/recheck', { expectedVersion: result.version, expectedItemVersion: 1, result: 'PASS', note: 'OK' }, 409);
      result = await request('POST', issuePath + '/recheck', { expectedVersion: result.version, expectedItemVersion: failed.version, result: 'PASS', note: 'OK' }, 200);
      assert.equal(result.status, 'CLOSED'); assert.equal(result.item.result, 'PASS');
      const own = await request('GET', root + '/issues', undefined, 200, otherTech); assert.deepEqual(own, []);
      await app.close(); app = undefined;
    });

    await t.test('isolated migration down/up removes only checklist schema; existing data preserved', async () => {
      const before = {};
      for (const table of ['users', 'projects', 'project_areas', 'project_systems', 'project_devices', 'project_tasks']) before[table] = await db.query(table === 'users'
        ? 'SELECT id,email,role,is_active FROM users ORDER BY id'
        : `SELECT * FROM ${table} ORDER BY id`);
      await verify(); await db.undoLastMigration(); // Remove the later User security migration before the checklist migration sequence.
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateProjectAcceptances1802000000000');
      await verify(); await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateEvidenceAttachments1801000000000');
      await verify(); await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name, 'CreateInspections1800000000000');
      await verify(); await db.undoLastMigration();
      assert.equal((await db.query("SELECT to_regclass('inspection_items') AS name"))[0].name, null);
      for (const [table, rows] of Object.entries(before)) assert.deepEqual(await db.query(table === 'users'
        ? 'SELECT id,email,role,is_active FROM users ORDER BY id'
        : `SELECT * FROM ${table} ORDER BY id`), rows);
      await verify(); await db.runMigrations(); assert.equal(await db.showMigrations(), false);
    });
  } catch (error) { failure = error; }
  finally {
    try { if (app) await app.close(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Inspection app cleanup failed', { cause: failure }) : error; }
    if (previousDb === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = previousDb;
    if (previousJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwt;
  }
  if (failure) throw failure;
  });
});
