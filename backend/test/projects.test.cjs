const test = require('node:test');
const assert = require('node:assert/strict');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } = require('@nestjs/common');
const { ProjectsService } = require('../dist/projects/projects.service.js');
const { CreateProjectDto, UpdateProjectDto } = require('../dist/projects/dto/project.dto.js');
const { CreateAreaDto, UpdateAreaDto } = require('../dist/projects/dto/area.dto.js');
const { UpdateProjectSystemDto } = require('../dist/projects/dto/system.dto.js');
const { AreaType } = require('../dist/projects/area-type.enum.js');
const { SystemCategory } = require('../dist/projects/system-category.enum.js');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard.js');

class MemoryRepository {
  constructor(rows = []) {
    this.rows = rows;
    this.next = 1;
    this.failSaveCode = undefined;
    this.failDeleteCode = undefined;
  }
  create(value) { return { ...value }; }
  async save(value) {
    if (this.failSaveCode) {
      const code = this.failSaveCode; this.failSaveCode = undefined; throw { code };
    }
    const now = new Date();
    if (!value.id) Object.assign(value, { id: `id-${this.next++}`, createdAt: now });
    value.updatedAt = now;
    const index = this.rows.findIndex((row) => row.id === value.id);
    if (index >= 0) this.rows[index] = value; else this.rows.push(value);
    return value;
  }
  async findOneBy(where) {
    return this.rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  }
  async find(options = {}) {
    let result = this.rows.filter((row) => !options.where || Object.entries(options.where).every(([key, value]) => row[key] === value));
    for (const [key, direction] of Object.entries(options.order ?? {}).reverse()) {
      result = [...result].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'DESC' ? -1 : 1));
    }
    return result;
  }
  async countBy(where) {
    return this.rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)).length;
  }
  async delete(where) {
    if (this.failDeleteCode) {
      const code = this.failDeleteCode; this.failDeleteCode = undefined; throw { driverError: { code } };
    }
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !Object.entries(where).every(([key, value]) => row[key] === value));
    return { affected: before - this.rows.length };
  }
}

function fixture() {
  const projects = new MemoryRepository();
  const areas = new MemoryRepository();
  const systems = new MemoryRepository();
  return { projects, areas, systems, service: new ProjectsService(projects, areas, systems) };
}

async function rejectsStatus(promise, Type, status) {
  await assert.rejects(promise, (error) => error instanceof Type && error.getStatus() === status);
}

test('DTO normalizes code/name and rejects malformed code and negative sortOrder', async () => {
  const dto = plainToInstance(CreateProjectDto, { code: ' ct-01 ', name: ' Công trình A ' });
  assert.equal((await validate(dto)).length, 0);
  assert.equal(dto.code, 'CT-01');
  assert.equal(dto.name, 'Công trình A');
  assert.ok((await validate(plainToInstance(CreateProjectDto, { code: 'CT 01', name: 'A' }))).length > 0);
  assert.ok((await validate(plainToInstance(UpdateProjectDto, { code: null }))).length > 0);
  assert.ok((await validate(plainToInstance(UpdateProjectDto, { name: null }))).length > 0);
  assert.ok((await validate(plainToInstance(UpdateProjectDto, { status: null }))).length > 0);
  assert.ok((await validate(plainToInstance(UpdateAreaDto, { sortOrder: null }))).length > 0);
  assert.ok((await validate(plainToInstance(UpdateProjectSystemDto, { category: null }))).length > 0);
  assert.equal((await validate(plainToInstance(UpdateProjectDto, { address: null, description: null }))).length, 0);
  assert.equal((await validate(plainToInstance(UpdateAreaDto, { parentId: null }))).length, 0);
  assert.equal((await validate(plainToInstance(UpdateProjectSystemDto, { description: null }))).length, 0);
  assert.ok((await validate(plainToInstance(CreateAreaDto, {
    code: 'F-1', name: 'Tầng 1', type: AreaType.FLOOR, sortOrder: -1,
  }))).length > 0);
});

test('service performs main project, hierarchy and system CRUD with required ordering and normalization', async () => {
  const { service } = fixture();
  const project = await service.createProject({ code: ' ct-01 ', name: ' Công trình A ' });
  assert.equal(project.code, 'CT-01');
  assert.equal(project.name, 'Công trình A');
  const floor2 = await service.createArea(project.id, { code: 'f-02', name: ' Tầng 2 ', type: AreaType.FLOOR, sortOrder: 2 });
  const floor1 = await service.createArea(project.id, { code: 'f-01', name: 'Tầng 1', type: AreaType.FLOOR, sortOrder: 1 });
  const room = await service.createArea(project.id, { code: 'r-101', name: ' Phòng 101 ', type: AreaType.ROOM, parentId: floor1.id });
  assert.equal(room.parentId, floor1.id);
  assert.equal((await service.listAreas(project.id))[0].code, 'R-101');
  assert.equal((await service.updateArea(project.id, room.id, { parentId: floor2.id })).parentId, floor2.id);
  const wifi = await service.createSystem(project.id, { code: 'sys-wifi', name: ' WiFi ', category: SystemCategory.WIFI });
  const lan = await service.createSystem(project.id, { code: 'sys-lan', name: 'LAN', category: SystemCategory.LAN });
  assert.equal((await service.listSystems(project.id))[0].id, lan.id);
  assert.equal((await service.updateSystem(project.id, wifi.id, { name: ' WiFi chính ' })).name, 'WiFi chính');
  await service.deleteSystem(project.id, wifi.id);
  assert.equal((await service.listSystems(project.id)).length, 1);
});

test('service enforces hierarchy, cross-project 404 and non-empty PATCH', async () => {
  const { service } = fixture();
  const first = await service.createProject({ code: 'P-1', name: 'Một' });
  const second = await service.createProject({ code: 'P-2', name: 'Hai' });
  const floor = await service.createArea(first.id, { code: 'F-1', name: 'Tầng', type: AreaType.FLOOR });
  const room = await service.createArea(first.id, { code: 'R-1', name: 'Phòng', type: AreaType.ROOM, parentId: floor.id });
  await rejectsStatus(service.createArea(first.id, { code: 'R-2', name: 'Phòng', type: AreaType.ROOM }), BadRequestException, 400);
  await rejectsStatus(service.createArea(first.id, { code: 'R-2', name: 'Phòng', type: AreaType.ROOM, parentId: room.id }), BadRequestException, 400);
  await rejectsStatus(service.updateArea(first.id, room.id, { parentId: null }), BadRequestException, 400);
  await rejectsStatus(service.createArea(second.id, { code: 'R-2', name: 'Phòng', type: AreaType.ROOM, parentId: floor.id }), NotFoundException, 404);
  await rejectsStatus(service.updateArea(second.id, room.id, { name: 'Sai project' }), NotFoundException, 404);
  await rejectsStatus(service.updateProject(first.id, new UpdateProjectDto()), BadRequestException, 400);
  await rejectsStatus(service.updateArea(first.id, room.id, {}), BadRequestException, 400);
  const sys = await service.createSystem(first.id, { code: 'S-1', name: 'LAN', category: SystemCategory.LAN });
  await rejectsStatus(service.updateSystem(first.id, sys.id, {}), BadRequestException, 400);
});

test('service maps unique and dependent delete violations to 409', async () => {
  const { service, projects, areas, systems } = fixture();
  projects.failSaveCode = '23505';
  await rejectsStatus(service.createProject({ code: 'P-1', name: 'Một' }), ConflictException, 409);
  const project = await service.createProject({ code: 'P-2', name: 'Hai' });
  const floor = await service.createArea(project.id, { code: 'F-1', name: 'Tầng', type: AreaType.FLOOR });
  await service.createArea(project.id, { code: 'R-1', name: 'Phòng', type: AreaType.ROOM, parentId: floor.id });
  await rejectsStatus(service.deleteArea(project.id, floor.id), ConflictException, 409);
  const system = await service.createSystem(project.id, { code: 'LAN', name: 'LAN', category: SystemCategory.LAN });
  systems.failDeleteCode = '23503';
  await rejectsStatus(service.deleteSystem(project.id, system.id), ConflictException, 409);
  systems.failDeleteCode = '23001';
  await rejectsStatus(service.deleteSystem(project.id, system.id), ConflictException, 409);
  areas.failDeleteCode = '23001';
  await rejectsStatus(service.deleteArea(project.id, (await service.createArea(project.id, { code: 'F-2', name: 'Tầng 2', type: AreaType.FLOOR })).id), ConflictException, 409);
  areas.failSaveCode = '23505';
  await rejectsStatus(service.createArea(project.id, { code: 'F-2', name: 'Tầng', type: AreaType.FLOOR }), ConflictException, 409);
});

test('JwtAuthGuard returns 401 when the bearer token is missing', async () => {
  const guard = new JwtAuthGuard({ verifyAsync: async () => ({ sub: 'id' }) }, { findActiveUser: async () => null });
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});
