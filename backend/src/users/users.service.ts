import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Not, QueryFailedError } from 'typeorm';
import { ProjectTask } from '../tasks/project-task.entity';
import { TaskStatus } from '../tasks/task-status.enum';
import { RemediationIssue } from '../inspections/inspection.entities';
import { IssueStatus } from '../inspections/inspection.enums';
import { User } from './user.entity';
import { UserRole } from './user-role.enum';
import { CreateTechnicianDto, ResetTechnicianPasswordDto, UpdateTechnicianStatusDto } from './dto/user-management.dto';
import { validatePassword } from '../auth/password-policy';
import { hash } from 'bcryptjs';

const MAX_VERSION = 2147483647;

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function dbCode(error: unknown): string | undefined {
  const value = error as { code?: string; driverError?: { code?: string } };
  return value?.driverError?.code ?? value?.code;
}

function publicManagedUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    version: user.version,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DataSource) {}

  async listManagedTechnicians() {
    const users = await this.db.getRepository(User).find({
      select: { id: true, email: true, role: true, isActive: true, mustChangePassword: true, version: true },
      where: { role: UserRole.TECHNICIAN }, order: { email: 'ASC' },
    });
    return users.map(publicManagedUser);
  }

  async createTechnician(dto: CreateTechnicianDto) {
    validatePassword(dto.temporaryPassword);
    const email = dto.email.trim().toLowerCase();
    const user = this.db.getRepository(User).create({
      email, passwordHash: await hash(dto.temporaryPassword, 12), role: UserRole.TECHNICIAN,
      isActive: true, mustChangePassword: true, authVersion: 0, version: 1,
    });
    try {
      return publicManagedUser(await this.db.getRepository(User).save(user));
    } catch (error) {
      if (dbCode(error) === '23505') throw conflict('EMAIL_ALREADY_EXISTS', 'Email is already in use');
      throw error;
    }
  }

  async updateTechnicianStatus(id: string, dto: UpdateTechnicianStatusDto) {
    return this.db.transaction(async manager => {
      const user = await this.lockTechnician(manager, id);
      this.checkVersion(user, dto.expectedVersion);
      if (user.isActive === dto.isActive) return publicManagedUser(user);
      if (!dto.isActive) {
        const openWork = await this.openWork(manager, id);
        if (openWork.taskCount || openWork.issueCount) {
          throw new ConflictException({
            statusCode: 409,
            code: 'TECHNICIAN_HAS_OPEN_WORK',
            message: 'Reassign or finish outstanding work before deactivation',
            details: openWork,
          });
        }
      }
      this.checkIncrementable(user);
      user.isActive = dto.isActive;
      user.authVersion++;
      user.version++;
      await manager.save(user);
      return publicManagedUser(user);
    });
  }

  async resetTechnicianPassword(id: string, dto: ResetTechnicianPasswordDto) {
    validatePassword(dto.temporaryPassword);
    return this.db.transaction(async manager => {
      const user = await this.lockTechnician(manager, id);
      this.checkVersion(user, dto.expectedVersion);
      this.checkIncrementable(user);
      user.passwordHash = await hash(dto.temporaryPassword, 12);
      user.mustChangePassword = true;
      user.authVersion++;
      user.version++;
      await manager.save(user);
      return publicManagedUser(user);
    });
  }

  private async lockTechnician(manager: EntityManager, id: string): Promise<User> {
    const user = await manager.findOne(User, { where: { id, role: UserRole.TECHNICIAN }, lock: { mode: 'pessimistic_write' } });
    if (!user) throw new NotFoundException('Technician not found');
    return user;
  }

  private checkVersion(user: User, expected: number): void {
    if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('expectedVersion is required');
    if (user.version !== expected) throw conflict('ACCOUNT_VERSION_CONFLICT', 'Account changed; reload and retry');
  }

  private checkIncrementable(user: User): void {
    if (user.version >= MAX_VERSION || user.authVersion >= MAX_VERSION) throw conflict('ACCOUNT_VERSION_EXHAUSTED', 'Account version cannot be advanced');
  }

  private async openWork(manager: EntityManager, technicianId: string) {
    const tasks = await manager.find(ProjectTask, {
      select: { id: true, projectId: true, code: true, status: true },
      where: { assigneeId: technicianId, status: Not(TaskStatus.APPROVED) },
      order: { projectId: 'ASC', code: 'ASC' },
    });
    const issues = await manager.find(RemediationIssue, {
      select: { id: true, projectId: true, status: true },
      where: { assigneeId: technicianId, status: Not(IssueStatus.CLOSED) },
      order: { projectId: 'ASC', id: 'ASC' },
    });
    return {
      taskCount: tasks.length,
      issueCount: issues.length,
      tasks: tasks.map(({ id, projectId, code, status }) => ({ id, projectId, code, status })),
      issues: issues.map(({ id, projectId, status }) => ({ id, projectId, status })),
    };
  }
}
