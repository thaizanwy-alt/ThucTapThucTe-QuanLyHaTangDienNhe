const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
const { TasksService } = require('../dist/tasks/tasks.service.js');
const { ProjectTask } = require('../dist/tasks/project-task.entity.js');
const { Project } = require('../dist/projects/project.entity.js');
const { ProjectSystem } = require('../dist/projects/project-system.entity.js');
const { ProjectArea } = require('../dist/projects/project-area.entity.js');
const { User } = require('../dist/users/user.entity.js');
const { UserRole } = require('../dist/users/user-role.enum.js');
const { TaskStatus } = require('../dist/tasks/task-status.enum.js');

async function expectDatabaseCode(runner, sql, parameters, code) {
  await runner.query('SAVEPOINT task_constraint_check');
  try {
    await assert.rejects(runner.query(sql, parameters), (error) => (error.driverError?.code ?? error.code) === code);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT task_constraint_check');
    await runner.query('RELEASE SAVEPOINT task_constraint_check');
  }
}

test('ProjectTask composite FK, RESTRICT and workflow use an owned disposable PostgreSQL database', { timeout: 180000 }, async () => {
  await withDisposableHttpDb('tasks', async (dataSource, verify) => {
  const runner = dataSource.createQueryRunner();
  let failure;
  try {
    await runner.connect();
    await verify(runner);
    await runner.startTransaction();
    const createUser = role => runner.query('INSERT INTO users (email,password_hash,role,is_active) VALUES ($1,$2,$3,true) RETURNING id',
      [`${role.toLowerCase()}-${randomUUID()}@example.invalid`, randomUUID(), role]);
    const technicians = await createUser(UserRole.TECHNICIAN);
    const managers = await createUser(UserRole.MANAGER);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
    const makeProject = async (tag) => (await runner.query(
      'INSERT INTO "projects" ("code", "name") VALUES ($1, $2) RETURNING "id"',
      [`DBTEST-${tag}-${suffix}`, `Transaction test ${tag}`],
    ))[0].id;
    const firstProjectId = await makeProject('A');
    const secondProjectId = await makeProject('B');
    const makeSystem = async (projectId, tag) => (await runner.query(
      'INSERT INTO "project_systems" ("project_id", "code", "name", "category") VALUES ($1, $2, $3, $4) RETURNING "id"',
      [projectId, `SYS-${tag}`, `System ${tag}`, 'LAN'],
    ))[0].id;
    const makeArea = async (projectId, tag) => (await runner.query(
      'INSERT INTO "project_areas" ("project_id", "type", "code", "name") VALUES ($1, $2, $3, $4) RETURNING "id"',
      [projectId, 'FLOOR', `FLOOR-${tag}`, `Floor ${tag}`],
    ))[0].id;
    const firstSystemId = await makeSystem(firstProjectId, 'A');
    const secondSystemId = await makeSystem(secondProjectId, 'B');
    const firstAreaId = await makeArea(firstProjectId, 'A');
    const secondAreaId = await makeArea(secondProjectId, 'B');
    const insertTask = 'INSERT INTO "project_tasks" ("project_id", "system_id", "area_id", "assignee_id", "code", "title") VALUES ($1, $2, $3, $4, $5, $6)';
    const parameters = [firstProjectId, firstSystemId, firstAreaId, technicians[0].id, `TASK-${suffix}`, 'Constraint test'];
    const inserted = await runner.query(`${insertTask} RETURNING "id"`, parameters);
    await expectDatabaseCode(runner, insertTask, [firstProjectId, secondSystemId, firstAreaId, technicians[0].id, `OTHER-S-${suffix}`, 'Wrong system'], '23503');
    await expectDatabaseCode(runner, insertTask, [firstProjectId, firstSystemId, secondAreaId, technicians[0].id, `OTHER-A-${suffix}`, 'Wrong area'], '23503');
    await expectDatabaseCode(runner, insertTask, parameters, '23505');
    await expectDatabaseCode(runner, 'DELETE FROM "project_systems" WHERE "id" = $1', [firstSystemId], '23001');
    await expectDatabaseCode(runner, 'DELETE FROM "project_areas" WHERE "id" = $1', [firstAreaId], '23001');
    await expectDatabaseCode(runner, 'UPDATE "project_tasks" SET "status" = $1 WHERE "id" = $2', ['SUBMITTED', inserted[0].id], '23514');
    await expectDatabaseCode(runner, 'UPDATE "project_tasks" SET "status" = $1 WHERE "id" = $2', ['RETURNED', inserted[0].id], '23514');

    const service = new TasksService(
      runner.manager.getRepository(ProjectTask),
      runner.manager.getRepository(Project),
      runner.manager.getRepository(ProjectSystem),
      runner.manager.getRepository(ProjectArea),
      runner.manager.getRepository(User),
    );
    const manager = { id: managers[0].id, role: UserRole.MANAGER, isActive: true, email: '' };
    const technician = { id: technicians[0].id, role: UserRole.TECHNICIAN, isActive: true, email: '' };
    assert.equal((await service.startTask(firstProjectId, inserted[0].id, technician)).status, TaskStatus.IN_PROGRESS);
    assert.equal((await service.submitTask(firstProjectId, inserted[0].id, 'Đã hoàn thành', technician)).status, TaskStatus.SUBMITTED);
    assert.equal((await service.returnTask(firstProjectId, inserted[0].id, 'Kiểm tra lại', manager)).status, TaskStatus.RETURNED);
    await service.startTask(firstProjectId, inserted[0].id, technician);
    await service.submitTask(firstProjectId, inserted[0].id, 'Đã sửa', technician);
    assert.equal((await service.approveTask(firstProjectId, inserted[0].id, manager)).status, TaskStatus.APPROVED);
  } catch (error) { failure = error; }
  finally {
    const errors = [];
    try { if (runner.isTransactionActive) await runner.rollbackTransaction(); } catch (error) { errors.push(error); }
    try { await runner.release(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Task fixture cleanup failed', { cause: failure ?? errors[0] });
  }
  if (failure) throw failure;
  });
});
