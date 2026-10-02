const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { dataSource } = require('../dist/database/data-source.js');
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

test('ProjectTask composite FK and RESTRICT constraints are enforced by PostgreSQL without changing stored data', async (t) => {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    const technicians = await runner.query(`SELECT "id" FROM "users" WHERE "role" = 'TECHNICIAN' AND "is_active" = true LIMIT 1`);
    const managers = await runner.query(`SELECT "id" FROM "users" WHERE "role" = 'MANAGER' AND "is_active" = true LIMIT 1`);
    if (technicians.length === 0 || managers.length === 0) {
      t.skip('No active demo manager and technician exist in the local database');
      return;
    }
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
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
});
