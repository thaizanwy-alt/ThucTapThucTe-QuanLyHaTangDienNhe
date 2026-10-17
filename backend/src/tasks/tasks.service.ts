import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { Project } from '../projects/project.entity';
import { UserRole } from '../users/user-role.enum';
import { User } from '../users/user.entity';
import { CreateProjectTaskDto, UpdateProjectTaskDto } from './dto/task.dto';
import { ProjectTask } from './project-task.entity';
import { TaskStatus } from './task-status.enum';

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { code?: string; driverError?: { code?: string } };
  return value.driverError?.code ?? value.code;
}

function requireRole(user: AuthenticatedUser, role: UserRole): void {
  if (user.role !== role) throw new ForbiddenException();
}

const editableFields = ['code', 'title', 'systemId', 'areaId', 'assigneeId', 'description'] as const;

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ProjectTask) private readonly tasks: Repository<ProjectTask>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectSystem) private readonly systems: Repository<ProjectSystem>,
    @InjectRepository(ProjectArea) private readonly areas: Repository<ProjectArea>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async listTasks(projectId: string, user: AuthenticatedUser): Promise<ProjectTask[]> {
    if (!await this.projects.findOneBy({ id: projectId })) throw new NotFoundException('Project not found');
    const where = user.role === UserRole.MANAGER
      ? { projectId }
      : { projectId, assigneeId: user.id };
    return this.tasks.find({ where, order: { createdAt: 'DESC', code: 'ASC' } });
  }

  async getTask(projectId: string, taskId: string, user: AuthenticatedUser): Promise<ProjectTask> {
    const where = user.role === UserRole.MANAGER
      ? { id: taskId, projectId }
      : { id: taskId, projectId, assigneeId: user.id };
    const task = await this.tasks.findOneBy(where);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async createTask(projectId: string, dto: CreateProjectTaskDto, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.MANAGER);
    try {
      return await this.tasks.manager.transaction(async m => {
        await this.requireActiveTechnician(m, dto.assigneeId);
        await this.requireProject(m, projectId);
        await this.requireSystem(m, projectId, dto.systemId);
        if (dto.areaId) await this.requireArea(m, projectId, dto.areaId);
        const task = m.create(ProjectTask, {
          projectId, systemId: dto.systemId, areaId: dto.areaId ?? null, assigneeId: dto.assigneeId,
          code: dto.code.trim().toUpperCase(), title: dto.title.trim(), description: dto.description ?? null,
          status: TaskStatus.ASSIGNED, completionNote: null, returnReason: null, submittedAt: null,
          reviewedById: null, reviewedAt: null,
        });
        return m.save(task);
      });
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  async updateTask(projectId: string, taskId: string, dto: UpdateProjectTaskDto, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.MANAGER);
    if (!editableFields.some((field) => dto[field] !== undefined)) {
      throw new BadRequestException('At least one field is required');
    }
    try {
      return await this.tasks.manager.transaction(async m => {
        // Global assignment lock order: User first, then Task. This serializes assignment with account deactivation.
        if (dto.assigneeId !== undefined) await this.requireActiveTechnician(m, dto.assigneeId);
        const current = await m.findOne(ProjectTask, { where: { id: taskId, projectId }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new NotFoundException('Task not found');
        if (current.status !== TaskStatus.ASSIGNED && current.status !== TaskStatus.RETURNED) {
          throw new ConflictException('Task cannot be edited in its current status');
        }
        if (dto.systemId !== undefined) await this.requireSystem(m, projectId, dto.systemId);
        if (dto.areaId) await this.requireArea(m, projectId, dto.areaId);
        const changes: Partial<ProjectTask> = {};
        if (dto.code !== undefined) changes.code = dto.code.trim().toUpperCase();
        if (dto.title !== undefined) changes.title = dto.title.trim();
        if (dto.systemId !== undefined) changes.systemId = dto.systemId;
        if (dto.areaId !== undefined) changes.areaId = dto.areaId;
        if (dto.assigneeId !== undefined) changes.assigneeId = dto.assigneeId;
        if (dto.description !== undefined) changes.description = dto.description;
        const result = await m.update(ProjectTask, { id: taskId, projectId, status: current.status }, changes);
        if (result.affected !== 1) throw new ConflictException('Task changed; reload and retry');
        return m.findOneByOrFail(ProjectTask, { id: taskId, projectId });
      });
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  async startTask(projectId: string, taskId: string, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.TECHNICIAN);
    const current = await this.getTask(projectId, taskId, user);
    if (current.status !== TaskStatus.ASSIGNED && current.status !== TaskStatus.RETURNED) {
      throw new ConflictException('Task cannot be started in its current status');
    }
    return this.transition(projectId, taskId, current.status, TaskStatus.IN_PROGRESS, {}, user);
  }

  async submitTask(projectId: string, taskId: string, completionNote: string, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.TECHNICIAN);
    if (typeof completionNote !== 'string' || !completionNote.trim()) {
      throw new BadRequestException('Completion note is required');
    }
    const current = await this.getTask(projectId, taskId, user);
    if (current.status !== TaskStatus.IN_PROGRESS) {
      throw new ConflictException('Task must be in progress before submission');
    }
    return this.transition(projectId, taskId, TaskStatus.IN_PROGRESS, TaskStatus.SUBMITTED, {
      completionNote: completionNote.trim(),
      submittedAt: new Date(),
      returnReason: null,
      reviewedById: null,
      reviewedAt: null,
    }, user);
  }

  async approveTask(projectId: string, taskId: string, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.MANAGER);
    const current = await this.getTask(projectId, taskId, user);
    if (current.status !== TaskStatus.SUBMITTED) throw new ConflictException('Task is not submitted');
    return this.transition(projectId, taskId, TaskStatus.SUBMITTED, TaskStatus.APPROVED, {
      reviewedById: user.id,
      reviewedAt: new Date(),
    }, user);
  }

  async returnTask(projectId: string, taskId: string, reason: string, user: AuthenticatedUser): Promise<ProjectTask> {
    requireRole(user, UserRole.MANAGER);
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('Return reason is required');
    }
    const current = await this.getTask(projectId, taskId, user);
    if (current.status !== TaskStatus.SUBMITTED) throw new ConflictException('Task is not submitted');
    return this.transition(projectId, taskId, TaskStatus.SUBMITTED, TaskStatus.RETURNED, {
      returnReason: reason.trim(),
      reviewedById: user.id,
      reviewedAt: new Date(),
    }, user);
  }

  private async transition(
    projectId: string,
    taskId: string,
    from: TaskStatus,
    to: TaskStatus,
    changes: Partial<ProjectTask>,
    user: AuthenticatedUser,
  ): Promise<ProjectTask> {
    const where = user.role === UserRole.TECHNICIAN
      ? { id: taskId, projectId, status: from, assigneeId: user.id }
      : { id: taskId, projectId, status: from };
    const result = await this.tasks.update(where, { ...changes, status: to });
    if (result.affected !== 1) throw new ConflictException('Task changed; reload and retry');
    return this.getTask(projectId, taskId, user);
  }

  private async requireProject(m: EntityManager, projectId: string): Promise<void> {
    if (!await m.findOneBy(Project, { id: projectId })) throw new NotFoundException('Project not found');
  }

  private async requireSystem(m: EntityManager, projectId: string, systemId: string): Promise<void> {
    if (!await m.findOneBy(ProjectSystem, { id: systemId, projectId })) throw new NotFoundException('System not found');
  }

  private async requireArea(m: EntityManager, projectId: string, areaId: string): Promise<void> {
    if (!await m.findOneBy(ProjectArea, { id: areaId, projectId })) throw new NotFoundException('Area not found');
  }

  private async requireActiveTechnician(m: EntityManager, assigneeId: string): Promise<void> {
    const assignee = await m.findOne(User, { where: { id: assigneeId }, lock: { mode: 'pessimistic_write' } });
    if (!assignee) throw new NotFoundException('Technician not found');
    if (assignee.role !== UserRole.TECHNICIAN || !assignee.isActive) {
      throw new ConflictException('Assignee must be an active technician');
    }
  }

  private rethrowWriteError(error: unknown): never {
    if (databaseCode(error) === '23505') throw new ConflictException('Task code already exists in this project');
    if (databaseCode(error) === '23503') throw new ConflictException('Related data changed; reload and retry');
    throw error;
  }
}
