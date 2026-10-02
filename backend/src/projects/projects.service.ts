import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AreaType } from './area-type.enum';
import { CreateAreaDto, UpdateAreaDto } from './dto/area.dto';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { CreateProjectSystemDto, UpdateProjectSystemDto } from './dto/system.dto';
import { ProjectArea } from './project-area.entity';
import { ProjectStatus } from './project-status.enum';
import { ProjectSystem } from './project-system.entity';
import { Project } from './project.entity';

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { code?: string; driverError?: { code?: string } };
  return value.driverError?.code ?? value.code;
}

function ensurePatch(dto: object): void {
  if (!Object.values(dto).some((value) => value !== undefined)) {
    throw new BadRequestException('At least one field is required');
  }
}

function normalizedCode(code: string): string {
  return code.trim().toUpperCase();
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectArea) private readonly areas: Repository<ProjectArea>,
    @InjectRepository(ProjectSystem) private readonly systems: Repository<ProjectSystem>,
  ) {}

  async listProjects(): Promise<Project[]> {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.projects.findOneBy({ id });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createProject(dto: CreateProjectDto): Promise<Project> {
    const project = this.projects.create({
      code: normalizedCode(dto.code),
      name: dto.name.trim(),
      address: dto.address ?? null,
      status: dto.status ?? ProjectStatus.PLANNING,
      description: dto.description ?? null,
    });
    return this.saveUnique(this.projects, project, 'Project code already exists');
  }

  async updateProject(id: string, dto: UpdateProjectDto): Promise<Project> {
    ensurePatch(dto);
    const project = await this.getProject(id);
    if (dto.code !== undefined) project.code = normalizedCode(dto.code);
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.address !== undefined) project.address = dto.address;
    if (dto.status !== undefined) project.status = dto.status;
    if (dto.description !== undefined) project.description = dto.description;
    return this.saveUnique(this.projects, project, 'Project code already exists');
  }

  async listAreas(projectId: string): Promise<ProjectArea[]> {
    await this.getProject(projectId);
    return this.areas.find({
      where: { projectId },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async createArea(projectId: string, dto: CreateAreaDto): Promise<ProjectArea> {
    await this.getProject(projectId);
    const parentId = dto.parentId ?? null;
    await this.validateAreaParent(projectId, dto.type, parentId);
    const area = this.areas.create({
      projectId,
      parentId,
      type: dto.type,
      code: normalizedCode(dto.code),
      name: dto.name.trim(),
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.saveUnique(this.areas, area, 'Area code already exists in this project');
  }

  async updateArea(projectId: string, areaId: string, dto: UpdateAreaDto): Promise<ProjectArea> {
    ensurePatch(dto);
    const area = await this.getArea(projectId, areaId);
    if (dto.parentId !== undefined) {
      await this.validateAreaParent(projectId, area.type, dto.parentId);
      area.parentId = dto.parentId;
    }
    if (dto.code !== undefined) area.code = normalizedCode(dto.code);
    if (dto.name !== undefined) area.name = dto.name.trim();
    if (dto.sortOrder !== undefined) area.sortOrder = dto.sortOrder;
    return this.saveUnique(this.areas, area, 'Area code already exists in this project');
  }

  async deleteArea(projectId: string, areaId: string): Promise<void> {
    const area = await this.getArea(projectId, areaId);
    if (area.type === AreaType.FLOOR && await this.areas.countBy({ parentId: area.id })) {
      throw new ConflictException('Area has dependent rooms');
    }
    try {
      await this.areas.delete({ id: areaId, projectId });
    } catch (error) {
      if (databaseCode(error) === '23503') throw new ConflictException('Area has dependent data');
      throw error;
    }
  }

  async listSystems(projectId: string): Promise<ProjectSystem[]> {
    await this.getProject(projectId);
    return this.systems.find({
      where: { projectId },
      order: { category: 'ASC', code: 'ASC' },
    });
  }

  async createSystem(projectId: string, dto: CreateProjectSystemDto): Promise<ProjectSystem> {
    await this.getProject(projectId);
    const system = this.systems.create({
      projectId,
      code: normalizedCode(dto.code),
      name: dto.name.trim(),
      category: dto.category,
      description: dto.description ?? null,
    });
    return this.saveUnique(this.systems, system, 'System code already exists in this project');
  }

  async updateSystem(projectId: string, systemId: string, dto: UpdateProjectSystemDto): Promise<ProjectSystem> {
    ensurePatch(dto);
    const system = await this.getSystem(projectId, systemId);
    if (dto.code !== undefined) system.code = normalizedCode(dto.code);
    if (dto.name !== undefined) system.name = dto.name.trim();
    if (dto.category !== undefined) system.category = dto.category;
    if (dto.description !== undefined) system.description = dto.description;
    return this.saveUnique(this.systems, system, 'System code already exists in this project');
  }

  async deleteSystem(projectId: string, systemId: string): Promise<void> {
    await this.getSystem(projectId, systemId);
    try {
      await this.systems.delete({ id: systemId, projectId });
    } catch (error) {
      if (databaseCode(error) === '23503') throw new ConflictException('System has dependent data');
      throw error;
    }
  }

  private async getArea(projectId: string, id: string): Promise<ProjectArea> {
    const area = await this.areas.findOneBy({ id, projectId });
    if (!area) throw new NotFoundException('Area not found');
    return area;
  }

  private async getSystem(projectId: string, id: string): Promise<ProjectSystem> {
    const system = await this.systems.findOneBy({ id, projectId });
    if (!system) throw new NotFoundException('System not found');
    return system;
  }

  private async validateAreaParent(projectId: string, type: AreaType, parentId: string | null): Promise<void> {
    if (type === AreaType.FLOOR) {
      if (parentId !== null) throw new BadRequestException('A floor cannot have a parent');
      return;
    }
    if (!parentId) throw new BadRequestException('A room must have a parent floor');
    const parent = await this.areas.findOneBy({ id: parentId, projectId });
    if (!parent) throw new NotFoundException('Parent floor not found');
    if (parent.type !== AreaType.FLOOR) throw new BadRequestException('A room parent must be a floor');
  }

  private async saveUnique<T extends object>(repository: Repository<T>, entity: T, message: string): Promise<T> {
    try {
      return await repository.save(entity);
    } catch (error) {
      if (databaseCode(error) === '23505') throw new ConflictException(message);
      throw error;
    }
  }
}
