const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } = require('@nestjs/common');
const { ROLES_KEY } = require('../dist/auth/roles.decorator.js');
const { UserRole } = require('../dist/users/user-role.enum.js');
const { UsersController } = require('../dist/users/users.controller.js');
const { TasksController } = require('../dist/tasks/tasks.controller.js');
const { TasksService } = require('../dist/tasks/tasks.service.js');
const { TaskStatus } = require('../dist/tasks/task-status.enum.js');
const { CreateProjectTaskDto, UpdateProjectTaskDto, SubmitProjectTaskDto, ReturnProjectTaskDto } = require('../dist/tasks/dto/task.dto.js');

class MemoryRepository {
  constructor(rows = []) { this.rows = rows; this.failSaveCode = undefined; this.failUpdateCode = undefined; this.staleNextUpdate = false; }
  create(value) { return { ...value }; }
  async save(value) {
    if (this.failSaveCode) { const code = this.failSaveCode; this.failSaveCode = undefined; throw { driverError: { code } }; }
    const row = { ...value, id: value.id ?? randomUUID(), createdAt: new Date(), updatedAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async findOneBy(where) { return this.rows.find((row) => matches(row, where)) ?? null; }
  async find(options) {
    const result = this.rows.filter((row) => matches(row, options.where));
    return result.sort((a, b) => b.createdAt - a.createdAt || a.code.localeCompare(b.code));
  }
  async update(where, changes) {
    if (this.failUpdateCode) { const code = this.failUpdateCode; this.failUpdateCode = undefined; throw { driverError: { code } }; }
    if (this.staleNextUpdate) { this.staleNextUpdate = false; return { affected: 0 }; }
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (!row) return { affected: 0 };
    Object.assign(row, changes, { updatedAt: new Date() });
    return { affected: 1 };
  }
}

function matches(row, where) {
  return Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
}

const manager = { id: randomUUID(), email: 'manager@example.local', role: UserRole.MANAGER, isActive: true };
const technician = { id: randomUUID(), email: 'tech@example.local', role: UserRole.TECHNICIAN, isActive: true };
const otherTechnician = { id: randomUUID(), email: 'other@example.local', role: UserRole.TECHNICIAN, isActive: true };
const projectId = randomUUID();
const otherProjectId = randomUUID();
const systemId = randomUUID();
const areaId = randomUUID();

function fixture() {
  const tasks = new MemoryRepository();
  const projects = new MemoryRepository([{ id: projectId }, { id: otherProjectId }]);
  const systems = new MemoryRepository([{ id: systemId, projectId }, { id: randomUUID(), projectId: otherProjectId }]);
  const areas = new MemoryRepository([{ id: areaId, projectId }, { id: randomUUID(), projectId: otherProjectId }]);
  const users = new MemoryRepository([manager, technician, otherTechnician].map((user) => ({ ...user })));
  return { tasks, projects, systems, areas, users, service: new TasksService(tasks, projects, systems, areas, users) };
}

function input(overrides = {}) {
  return { code: ' tk-01 ', title: ' Kéo dây mạng ', systemId, areaId, assigneeId: technician.id, ...overrides };
}

async function rejectsStatus(promise, Type, status) {
  await assert.rejects(promise, (error) => error instanceof Type && error.getStatus() === status);
}

test('task DTO validates normalization, null, empty PATCH and required notes', async () => {
  const dto = plainToInstance(CreateProjectTaskDto, input());
  assert.equal((await validate(dto)).length, 0);
  assert.equal(dto.code, 'TK-01');
  assert.equal(dto.title, 'Kéo dây mạng');
  for (const field of ['code', 'title', 'systemId', 'assigneeId']) {
    assert.ok((await validate(plainToInstance(UpdateProjectTaskDto, { [field]: null }))).length > 0, field);
  }
  assert.equal((await validate(plainToInstance(UpdateProjectTaskDto, { areaId: null, description: null }))).length, 0);
  assert.ok((await validate(plainToInstance(CreateProjectTaskDto, input({ code: 'bad code' })))).length > 0);
  assert.ok((await validate(plainToInstance(SubmitProjectTaskDto, { completionNote: '   ' }))).length > 0);
  assert.ok((await validate(plainToInstance(ReturnProjectTaskDto, { reason: null }))).length > 0);
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const stripped = await pipe.transform({ status: 'APPROVED' }, { type: 'body', metatype: UpdateProjectTaskDto });
  assert.ok(Object.values(stripped).every((value) => value === undefined));
  await rejectsStatus(fixture().service.updateTask(projectId, randomUUID(), stripped, manager), BadRequestException, 400);
});

test('manager creates and edits, technician sees only assigned tasks', async () => {
  const { service } = fixture();
  const created = await service.createTask(projectId, input(), manager);
  assert.equal(created.status, TaskStatus.ASSIGNED);
  assert.equal(created.code, 'TK-01');
  assert.equal(created.title, 'Kéo dây mạng');
  assert.equal((await service.listTasks(projectId, manager)).length, 1);
  assert.equal((await service.listTasks(projectId, technician)).length, 1);
  assert.equal((await service.listTasks(projectId, otherTechnician)).length, 0);
  await rejectsStatus(service.getTask(projectId, created.id, otherTechnician), NotFoundException, 404);
  await rejectsStatus(service.getTask(otherProjectId, created.id, manager), NotFoundException, 404);
  const edited = await service.updateTask(projectId, created.id, { title: ' Lắp ổ mạng ', areaId: null }, manager);
  assert.equal(edited.title, 'Lắp ổ mạng');
  assert.equal(edited.areaId, null);
  await service.updateTask(projectId, created.id, { assigneeId: otherTechnician.id }, manager);
  assert.equal((await service.listTasks(projectId, technician)).length, 0);
  assert.equal((await service.listTasks(projectId, otherTechnician)).length, 1);
});

test('role restrictions and technician ownership are enforced in service and controller metadata', async () => {
  const { service } = fixture();
  const created = await service.createTask(projectId, input(), manager);
  await rejectsStatus(service.createTask(projectId, input(), technician), ForbiddenException, 403);
  await rejectsStatus(service.updateTask(projectId, created.id, { title: 'No' }, technician), ForbiddenException, 403);
  await rejectsStatus(service.startTask(projectId, created.id, manager), ForbiddenException, 403);
  await rejectsStatus(service.startTask(projectId, created.id, otherTechnician), NotFoundException, 404);
  const roles = (method) => Reflect.getMetadata(ROLES_KEY, TasksController.prototype[method]);
  assert.deepEqual(roles('createTask'), [UserRole.MANAGER]);
  assert.deepEqual(roles('updateTask'), [UserRole.MANAGER]);
  assert.deepEqual(roles('startTask'), [UserRole.TECHNICIAN]);
  assert.deepEqual(roles('submitTask'), [UserRole.TECHNICIAN]);
  assert.deepEqual(roles('approveTask'), [UserRole.MANAGER]);
  assert.deepEqual(roles('returnTask'), [UserRole.MANAGER]);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, UsersController), [UserRole.MANAGER]);
});

test('project links and active technician are validated', async () => {
  const { service, systems, areas, users } = fixture();
  await rejectsStatus(service.createTask(randomUUID(), input(), manager), NotFoundException, 404);
  await rejectsStatus(service.createTask(projectId, input({ systemId: systems.rows[1].id }), manager), NotFoundException, 404);
  await rejectsStatus(service.createTask(projectId, input({ areaId: areas.rows[1].id }), manager), NotFoundException, 404);
  await rejectsStatus(service.createTask(projectId, input({ assigneeId: randomUUID() }), manager), NotFoundException, 404);
  await rejectsStatus(service.createTask(projectId, input({ assigneeId: manager.id }), manager), ConflictException, 409);
  users.rows.find((row) => row.id === technician.id).isActive = false;
  await rejectsStatus(service.createTask(projectId, input(), manager), ConflictException, 409);
});

test('status flow supports return and resubmit, but approval is terminal', async () => {
  const { service } = fixture();
  const task = await service.createTask(projectId, input(), manager);
  await rejectsStatus(service.submitTask(projectId, task.id, 'x', technician), ConflictException, 409);
  assert.equal((await service.startTask(projectId, task.id, technician)).status, TaskStatus.IN_PROGRESS);
  await rejectsStatus(service.submitTask(projectId, task.id, ' ', technician), BadRequestException, 400);
  assert.equal((await service.submitTask(projectId, task.id, ' Đã lắp xong ', technician)).status, TaskStatus.SUBMITTED);
  await rejectsStatus(service.updateTask(projectId, task.id, { title: 'Không' }, manager), ConflictException, 409);
  await rejectsStatus(service.returnTask(projectId, task.id, ' ', manager), BadRequestException, 400);
  const returned = await service.returnTask(projectId, task.id, ' Cần kiểm tra lại ', manager);
  assert.equal(returned.status, TaskStatus.RETURNED);
  assert.equal(returned.reviewedById, manager.id);
  assert.equal(returned.returnReason, 'Cần kiểm tra lại');
  assert.equal((await service.startTask(projectId, task.id, technician)).status, TaskStatus.IN_PROGRESS);
  await service.submitTask(projectId, task.id, 'Đã sửa', technician);
  const approved = await service.approveTask(projectId, task.id, manager);
  assert.equal(approved.status, TaskStatus.APPROVED);
  assert.equal(approved.returnReason, null);
  await rejectsStatus(service.startTask(projectId, task.id, technician), ConflictException, 409);
  await rejectsStatus(service.approveTask(projectId, task.id, manager), ConflictException, 409);
  await rejectsStatus(service.updateTask(projectId, task.id, { assigneeId: otherTechnician.id }, manager), ConflictException, 409);
});

test('conditional updates reject stale transitions and edits', async () => {
  const { service, tasks } = fixture();
  const task = await service.createTask(projectId, input(), manager);
  tasks.staleNextUpdate = true;
  await rejectsStatus(service.startTask(projectId, task.id, technician), ConflictException, 409);
  assert.equal(task.status, TaskStatus.ASSIGNED);
  tasks.staleNextUpdate = true;
  await rejectsStatus(service.updateTask(projectId, task.id, { title: 'Mới' }, manager), ConflictException, 409);
  assert.equal(task.title, 'Kéo dây mạng');
});

test('database unique/FK errors are scoped to writes and mapped to 409', async () => {
  const { service, tasks } = fixture();
  tasks.failSaveCode = '23505';
  await rejectsStatus(service.createTask(projectId, input(), manager), ConflictException, 409);
  const task = await service.createTask(projectId, input(), manager);
  tasks.failUpdateCode = '23505';
  await rejectsStatus(service.updateTask(projectId, task.id, { code: 'DUPLICATE' }, manager), ConflictException, 409);
  tasks.failUpdateCode = '23503';
  await rejectsStatus(service.updateTask(projectId, task.id, { systemId }, manager), ConflictException, 409);
});

test('technician list requests only safe active accounts', async () => {
  let options;
  const controller = new UsersController({ find: async (value) => { options = value; return [{ id: technician.id, email: technician.email }]; } });
  const result = await controller.listTechnicians();
  assert.deepEqual(Object.keys(result[0]).sort(), ['email', 'id']);
  assert.deepEqual(options.select, { id: true, email: true });
  assert.deepEqual(options.where, { role: UserRole.TECHNICIAN, isActive: true });
});
