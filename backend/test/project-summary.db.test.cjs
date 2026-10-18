const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ValidationPipe } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
const { AppModule } = require('../dist/app.module.js');
const { ProjectSummaryService } = require('../dist/projects/project-summary.service.js');
const { User } = require('../dist/users/user.entity.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { ProjectDevice } = require('../dist/devices/project-device.entity.js');
const { ProjectDeviceSystem } = require('../dist/devices/project-device-system.entity.js');
const { RackServedArea } = require('../dist/devices/rack-served-area.entity.js');
const { ProjectTask } = require('../dist/tasks/project-task.entity.js');
const { ChecklistTemplate, ProjectInspection, InspectionItem, RemediationIssue } = require('../dist/inspections/inspection.entities.js');
const { ProjectAcceptance } = require('../dist/acceptances/acceptance.entities.js');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(db) {
  const users = db.getRepository(User);
  const manager = await users.save({ email: 'summary-manager@example.invalid', passwordHash: 'not-a-login-hash', role: 'MANAGER', isActive: true });
  const a = await users.save({ email: 'summary-a@example.invalid', passwordHash: 'not-a-login-hash', role: 'TECHNICIAN', isActive: true });
  const b = await users.save({ email: 'summary-b@example.invalid', passwordHash: 'not-a-login-hash', role: 'TECHNICIAN', isActive: true });
  const forced = await users.save({ email: 'summary-forced@example.invalid', passwordHash: 'not-a-login-hash', role: 'TECHNICIAN', isActive: true, mustChangePassword: true });
  const project = await db.getRepository(Project).save({ code: 'SUMMARY-A', name: 'Summary A', status: 'IN_PROGRESS' });
  const other = await db.getRepository(Project).save({ code: 'SUMMARY-B', name: 'Summary B' });
  const empty = await db.getRepository(Project).save({ code: 'SUMMARY-EMPTY', name: 'Empty' });
  const systems = db.getRepository(ProjectSystem);
  const lan = await systems.save({ projectId: project.id, code: 'LAN', name: 'LAN', category: 'LAN' });
  const wifi = await systems.save({ projectId: project.id, code: 'WIFI', name: 'WiFi', category: 'WIFI' });
  const areaRepo = db.getRepository(ProjectArea);
  const floor = await areaRepo.save({ projectId: project.id, code: 'F01', name: 'Floor', type: 'FLOOR' });
  const room = await areaRepo.save({ projectId: project.id, code: 'R01', name: 'Room', type: 'ROOM', parentId: floor.id });

  let main;
  await db.transaction(async m => {
    main = await m.save(ProjectDevice, { projectId: project.id, code: 'RACK-MAIN', name: 'Main', type: 'RACK', areaId: floor.id, capacityU: 12, rackRole: 'MAIN' });
    await m.save(RackServedArea, { projectId: project.id, rackId: main.id, areaId: floor.id });
  });
  await db.transaction(async m => {
    const sub = await m.save(ProjectDevice, { projectId: project.id, code: 'RACK-SUB', name: 'Sub', type: 'RACK', areaId: room.id, capacityU: 6, rackRole: 'SUB', parentRackId: main.id });
    await m.save(RackServedArea, { projectId: project.id, rackId: sub.id, areaId: room.id });
  });
  await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'RACK-LEGACY', name: 'Legacy', type: 'RACK' });
  const switchDevice = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'SW-01', name: 'Switch', type: 'SWITCH', rackId: main.id });
  await db.getRepository(ProjectDeviceSystem).save([
    { projectId: project.id, deviceId: switchDevice.id, systemId: lan.id },
    { projectId: project.id, deviceId: switchDevice.id, systemId: wifi.id },
  ]);

  const tasks = db.getRepository(ProjectTask);
  let taskNumber = 0;
  for (const status of ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED', 'ASSIGNED']) {
    await tasks.save({ projectId: project.id, systemId: lan.id, assigneeId: taskNumber++ === 5 ? b.id : a.id,
      code: `TASK-${taskNumber}`, title: status, status,
      completionNote: ['SUBMITTED', 'APPROVED'].includes(status) ? 'Finished' : null,
      returnReason: status === 'RETURNED' ? 'More work' : null });
  }

  const template = await db.getRepository(ChecklistTemplate).save({ code: 'SUMMARY-TEMPLATE', name: 'Summary', category: 'LAN', revision: 1, isActive: true });
  const inspections = db.getRepository(ProjectInspection);
  const items = db.getRepository(InspectionItem);
  const issues = db.getRepository(RemediationIssue);
  let inspectionNumber = 0;
  async function sheet(results) {
    const sheet = await inspections.save({ projectId: project.id, systemId: lan.id, templateId: template.id, templateRevision: 1,
      createdById: manager.id, code: `CHECK-${++inspectionNumber}`, title: 'Check' });
    const created = [];
    for (let index = 0; index < results.length; index++) {
      created.push(await items.save({ projectId: project.id, inspectionId: sheet.id, code: `ITEM-${index + 1}`, title: 'Item', result: results[index] }));
    }
    return { sheet, items: created };
  }
  await sheet(['PASS']);
  await sheet(['NOT_CHECKED']);
  await sheet(['PASS', 'NOT_CHECKED']);
  const failed = await sheet(['FAIL', 'FAIL', 'FAIL']);
  const resolved = await sheet(['FAIL']);
  const closed = await sheet(['PASS']);
  await sheet([]); // Imported empty sheet: defensive pendingOrFailed bucket.
  const now = new Date();
  for (const [item, status, assigneeId] of [
    [failed.items[0], 'OPEN', a.id], [failed.items[1], 'IN_PROGRESS', a.id],
    [failed.items[2], 'OPEN', b.id], [resolved.items[0], 'RESOLVED', a.id],
    [closed.items[0], 'CLOSED', a.id],
  ]) {
    await issues.save({ projectId: project.id, itemId: item.id, description: 'Fix', assigneeId, status,
      resolutionNote: ['RESOLVED', 'CLOSED'].includes(status) ? 'Fixed' : null,
      resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? now : null,
      reviewedById: status === 'CLOSED' ? manager.id : null,
      reviewedAt: status === 'CLOSED' ? now : null });
  }
  const acceptance = db.getRepository(ProjectAcceptance);
  async function record(code, status, replacesId = null, systemId = lan.id) {
    return acceptance.save({ projectId: project.id, systemId, code, title: code, status,
      createdById: manager.id, confirmedById: status === 'CONFIRMED' ? manager.id : null,
      confirmedAt: status === 'CONFIRMED' ? now : null,
      replacesId, replacementReason: replacesId ? 'Correction' : null });
  }
  const first = await record('AC-FIRST', 'CONFIRMED');
  await record('AC-DRAFT-REPLACEMENT', 'DRAFT', first.id);
  const second = await record('AC-SECOND', 'CONFIRMED', first.id);
  await record('AC-THIRD', 'CONFIRMED', second.id);
  await record('AC-INDEPENDENT', 'CONFIRMED', null, wifi.id);
  const otherSystem = await systems.save({ projectId: other.id, code: 'LAN', name: 'Other LAN', category: 'LAN' });
  await tasks.save({ projectId: other.id, systemId: otherSystem.id, assigneeId: a.id, code: 'OTHER-TASK', title: 'Other', status: 'ASSIGNED' });
  return { project, other, empty, manager, a, b, forced };
}

test('Project summary PostgreSQL snapshot and HTTP contract', { timeout: 180000 }, async t => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  try {
    await withDisposableHttpDb('summary', async (db, verify) => {
      await verify();
      const f = await fixture(db);
      const service = new ProjectSummaryService(db);
      const managerUser = { id: f.manager.id, role: 'MANAGER' };
      const aUser = { id: f.a.id, role: 'TECHNICIAN' };
      const bUser = { id: f.b.id, role: 'TECHNICIAN' };
      await t.test('aggregate buckets, zero values, project isolation and role whitelist', async () => {
        const summary = await service.get(f.project.id, managerUser);
        assert.equal(summary.projectId, f.project.id);
        assert.ok(Number.isFinite(Date.parse(summary.readAt)));
        assert.equal(summary.workScope, 'PROJECT');
        assert.deepEqual(summary.tasks, { total: 6, byStatus: { ASSIGNED: 2, IN_PROGRESS: 1, SUBMITTED: 1, RETURNED: 1, APPROVED: 1 }, notApproved: 5 });
        assert.deepEqual(summary.issues, { total: 5, byStatus: { OPEN: 2, IN_PROGRESS: 1, RESOLVED: 1, CLOSED: 1 }, notClosed: 4 });
        assert.deepEqual(summary.inspections, { total: 7, passed: 2, notChecked: 1, pendingOrFailed: 4 });
        assert.deepEqual(summary.acceptances, { draft: 1, confirmedCurrent: 2, superseded: 2 });
        assert.deepEqual(summary.inventory, { devicesTotal: 4, areas: { total: 2, floor: 1, room: 1 }, systemsTotal: 2,
          racks: { total: 3, main: 1, sub: 1, unclassified: 1 } });
        assert.equal(summary.inspections.total, summary.inspections.passed + summary.inspections.notChecked + summary.inspections.pendingOrFailed);
        assert.equal(summary.tasks.total, Object.values(summary.tasks.byStatus).reduce((sum, n) => sum + n, 0));
        assert.equal(summary.issues.total, Object.values(summary.issues.byStatus).reduce((sum, n) => sum + n, 0));
        const a = await service.get(f.project.id, aUser);
        const b = await service.get(f.project.id, bUser);
        assert.equal(a.workScope, 'ASSIGNED_TO_ME');
        assert.equal(a.tasks.total, 5); assert.equal(a.tasks.notApproved, 4);
        assert.equal(a.issues.total, 4); assert.equal(a.issues.notClosed, 3);
        assert.equal(a.tasks.byStatus.APPROVED, 1);
        assert.equal(a.issues.byStatus.CLOSED, 1);
        assert.equal(b.tasks.total, 1); assert.equal(b.issues.total, 1);
        for (const value of [a, b]) {
          assert.deepEqual(Object.keys(value).sort(), ['projectId', 'readAt', 'workScope', 'tasks', 'issues', 'inventory', 'acceptances'].sort());
          assert.equal('inspections' in value, false);
          assert.equal('draft' in value.acceptances, false);
          assert.deepEqual(value.acceptances, { confirmedCurrent: 2, superseded: 2 });
          assert.deepEqual(value.inventory, summary.inventory);
          assert.equal(JSON.stringify(value).includes('passwordHash'), false);
        }
        const other = await service.get(f.other.id, managerUser);
        assert.equal(other.tasks.total, 1);
        assert.equal(other.issues.total, 0); assert.equal(other.inspections.total, 0);
        assert.equal(other.acceptances.draft, 0); assert.equal(other.inventory.devicesTotal, 0);
        const empty = await service.get(f.empty.id, managerUser);
        assert.equal(empty.tasks.total, 0); assert.equal(empty.tasks.notApproved, 0);
        assert.ok(Object.values(empty.tasks.byStatus).every(value => value === 0));
        assert.equal(empty.issues.total, 0); assert.equal(empty.issues.notClosed, 0);
        assert.ok(Object.values(empty.issues.byStatus).every(value => value === 0));
        assert.deepEqual(empty.inspections, { total: 0, passed: 0, notChecked: 0, pendingOrFailed: 0 });
        assert.deepEqual(empty.acceptances, { draft: 0, confirmedCurrent: 0, superseded: 0 });
        assert.equal(empty.inventory.devicesTotal, 0);
      });

      await t.test('all groups come from one read-only repeatable-read snapshot', async () => {
        const afterTasks = deferred(), resume = deferred();
        const wrapped = { transaction: (level, work) => db.transaction(level, async m => {
          assert.equal(level, 'REPEATABLE READ');
          const query = m.query.bind(m);
          m.query = async (sql, parameters) => {
            const rows = await query(sql, parameters);
            if (sql.includes('FROM project_tasks WHERE')) {
              assert.equal((await query('SHOW transaction_read_only'))[0].transaction_read_only, 'on');
              afterTasks.resolve(); await resume.promise;
            }
            return rows;
          };
          return work(m);
        }) };
        const pending = new ProjectSummaryService(wrapped).get(f.project.id, managerUser);
        try {
          await Promise.race([afterTasks.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('summary did not reach Task barrier')), 8000))]);
          await db.transaction(async writer => {
            await writer.query("UPDATE project_tasks SET status = 'IN_PROGRESS' WHERE project_id = $1 AND code = 'TASK-1'", [f.project.id]);
            await writer.query("UPDATE remediation_issues SET status = 'IN_PROGRESS' WHERE project_id = $1 AND status = 'OPEN'", [f.project.id]);
            await writer.query(`INSERT INTO project_devices(project_id,code,name,type) VALUES ($1,'CAM-NEW','Camera','CAMERA')`, [f.project.id]);
          });
        } finally { resume.resolve(); }
        const snapshot = await pending;
        assert.equal(snapshot.tasks.byStatus.ASSIGNED, 2);
        assert.equal(snapshot.issues.byStatus.OPEN, 2);
        assert.equal(snapshot.inventory.devicesTotal, 4);
        const later = await service.get(f.project.id, managerUser);
        assert.equal(later.tasks.byStatus.ASSIGNED, 1);
        assert.equal(later.issues.byStatus.OPEN, 0);
        assert.equal(later.inventory.devicesTotal, 5);
      });

      await t.test('Nest HTTP JWT, forced-password guard, 404 and existing Project route', async () => {
        let app, failure;
        try {
          app = await NestFactory.create(AppModule, { logger: false });
          app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
          await app.listen(0, '127.0.0.1');
          await verify(app.get(DataSource));
          const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
          const jwt = app.get(JwtService);
          const auth = user => ({ Authorization: `Bearer ${jwt.sign({ sub: user.id, authVersion: user.authVersion })}` });
          const url = `/projects/${f.project.id}/summary`;
          assert.equal((await fetch(base + url)).status, 401);
          assert.equal((await fetch(base + url, { headers: auth(f.forced) })).status, 403);
          assert.equal((await fetch(base + `/projects/${randomUUID()}/summary`, { headers: auth(f.manager) })).status, 404);
          assert.equal((await fetch(base + '/projects/not-a-uuid/summary', { headers: auth(f.manager) })).status, 400);
          const managerResponse = await fetch(base + url, { headers: auth(f.manager) });
          assert.equal(managerResponse.status, 200);
          const managerJson = await managerResponse.json();
          assert.equal(managerJson.tasks.total, 6); assert.equal(managerJson.issues.total, 5);
          assert.equal(managerJson.inspections.total, 7);
          const techResponse = await fetch(base + url, { headers: auth(f.a) });
          assert.equal(techResponse.status, 200);
          const techJson = await techResponse.json();
          assert.equal(techJson.tasks.total, 5);
          assert.equal('inspections' in techJson, false);
          assert.equal('draft' in techJson.acceptances, false);
          for (const secret of ['passwordHash', 'storageKey', 'snapshot', 'evidenceIds']) assert.equal(JSON.stringify(techJson).includes(secret), false);
          const project = await fetch(base + `/projects/${f.project.id}`, { headers: auth(f.manager) });
          assert.equal(project.status, 200);
          assert.equal((await project.json()).status, 'IN_PROGRESS');
        } catch (error) { failure = error; }
        finally {
          try { if (app) await app.close(); }
          catch (error) { failure = failure ? new AggregateError([failure, error], 'Summary app cleanup failed', { cause: failure }) : error; }
        }
        if (failure) throw failure;
      });
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
