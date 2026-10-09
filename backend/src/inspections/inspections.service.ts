import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { SystemCategory } from '../projects/system-category.enum';
import { ProjectDevice } from '../devices/project-device.entity';
import { ProjectDeviceSystem } from '../devices/project-device-system.entity';
import { ChecklistTemplate, ChecklistTemplateItem, InspectionItem, ProjectInspection, RemediationIssue } from './inspection.entities';
import { InspectionResult as Result, IssueStatus as Status } from './inspection.enums';
import { AssignIssueDto, CreateInspectionDto, PutInspectionResultDto, RecheckIssueDto, ResolveIssueDto, VersionDto } from './dto/inspection.dto';

function role(user: AuthenticatedUser, required: UserRole): void {
  if (user.role !== required) throw new ForbiddenException();
}
function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}
function version(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('Version is required');
  if (actual !== expected || actual >= 2147483647) throw new ConflictException('Data changed; reload and retry');
}

@Injectable()
export class InspectionsService {
  constructor(private readonly db: DataSource) {}

  private async write<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(work); } catch (error) {
      const e = error as { code?: string; driverError?: { code?: string } };
      const code = e?.driverError?.code ?? e?.code;
      if (code === '23505') throw new ConflictException('Code or open issue already exists');
      if (['23503', '23001', '40001', '40P01'].includes(code ?? '')) throw new ConflictException('Related data changed; reload and retry');
      throw error;
    }
  }

  async listTemplates(category: SystemCategory | undefined, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    if (category !== undefined && !Object.values(SystemCategory).includes(category)) throw new BadRequestException('Invalid category');
    return this.db.transaction('REPEATABLE READ', async m => {
      const templates = await m.find(ChecklistTemplate, { where: { isActive: true, ...(category ? { category } : {}) }, order: { category: 'ASC', code: 'ASC', revision: 'DESC' } });
      const result = [];
      for (const template of templates) result.push({ ...template,
        items: await m.find(ChecklistTemplateItem, { where: { templateId: template.id }, order: { sortOrder: 'ASC', code: 'ASC' } }),
      });
      return result;
    });
  }

  async createInspection(projectId: string, dto: CreateInspectionDto, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.write(async m => {
      const project = await m.findOne(Project, { where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!project) throw new NotFoundException('Project not found');
      if (dto.areaId != null && dto.deviceId != null) throw new BadRequestException('Choose Area or Device, not both');
      const system = await m.findOne(ProjectSystem, { where: { id: dto.systemId, projectId }, lock: { mode: 'pessimistic_read' } });
      if (!system) throw new NotFoundException('System not found');
      if (dto.areaId && !await m.findOneBy(ProjectArea, { id: dto.areaId, projectId })) throw new NotFoundException('Area not found');
      if (dto.deviceId) {
        if (!await m.findOneBy(ProjectDevice, { id: dto.deviceId, projectId })) throw new NotFoundException('Device not found');
        if (!await m.findOneBy(ProjectDeviceSystem, { projectId, deviceId: dto.deviceId, systemId: dto.systemId })) {
          throw new BadRequestException('Device must belong to selected System');
        }
      }
      const template = await m.findOne(ChecklistTemplate, { where: { id: dto.templateId }, lock: { mode: 'pessimistic_read' } });
      if (!template) throw new NotFoundException('Template not found');
      if (!template.isActive || template.category !== system.category) throw new ConflictException('Template is inactive or category does not match');
      const items = await m.find(ChecklistTemplateItem, { where: { templateId: template.id }, order: { sortOrder: 'ASC', code: 'ASC' } });
      if (!items.length) throw new ConflictException('Template must contain items');
      const code = requiredText(dto.code, 'Code').toUpperCase();
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) throw new BadRequestException('Invalid code');
      const inspection = await m.save(ProjectInspection, m.create(ProjectInspection, {
        projectId, code, title: requiredText(dto.title, 'Title'), systemId: system.id,
        areaId: dto.areaId ?? null, deviceId: dto.deviceId ?? null,
        templateId: template.id, templateRevision: template.revision, createdById: user.id,
      }));
      await m.save(InspectionItem, items.map(item => m.create(InspectionItem, {
        projectId, inspectionId: inspection.id, code: item.code, title: item.title,
        instruction: item.instruction, sortOrder: item.sortOrder,
        result: Result.NOT_CHECKED, note: null, checkedById: null, checkedAt: null, version: 1,
      })));
      return this.detail(m, inspection);
    });
  }

  async listInspections(projectId: string, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.db.transaction('REPEATABLE READ', async m => {
      if (!await m.findOneBy(Project, { id: projectId })) throw new NotFoundException('Project not found');
      const inspections = await m.find(ProjectInspection, { where: { projectId }, order: { createdAt: 'DESC', code: 'ASC' } });
      const result = [];
      for (const inspection of inspections) result.push(await this.detail(m, inspection));
      return result;
    });
  }

  async getInspection(projectId: string, inspectionId: string, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.db.transaction('REPEATABLE READ', async m => this.detail(m, await this.inspection(m, projectId, inspectionId)));
  }

  private async inspection(m: EntityManager, projectId: string, inspectionId: string, lock = false) {
    const inspection = await m.findOne(ProjectInspection, {
      where: { projectId, id: inspectionId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  private async detail(m: EntityManager, inspection: ProjectInspection) {
    const items = await m.find(InspectionItem, { where: { projectId: inspection.projectId, inspectionId: inspection.id }, order: { sortOrder: 'ASC', code: 'ASC' } });
    const enriched = [];
    for (const item of items) {
      const issues = await m.find(RemediationIssue, { where: { projectId: inspection.projectId, itemId: item.id }, order: { createdAt: 'ASC', id: 'ASC' } });
      enriched.push({ ...item, activeIssue: issues.find(issue => issue.status !== Status.CLOSED) ?? null, issues });
    }
    const summary = {
      total: items.length, notChecked: items.filter(i => i.result === Result.NOT_CHECKED).length,
      pass: items.filter(i => i.result === Result.PASS).length, fail: items.filter(i => i.result === Result.FAIL).length,
      openIssues: enriched.reduce((sum, item) => sum + item.issues.filter(issue => issue.status !== Status.CLOSED).length, 0),
    };
    return { ...inspection, items: enriched, summary, passed: summary.total > 0 && summary.pass === summary.total && summary.openIssues === 0 };
  }

  private async activeTechnician(m: EntityManager, id: string) {
    const user = await m.findOne(User, { where: { id }, lock: { mode: 'pessimistic_read' } });
    if (!user) throw new NotFoundException('Technician not found');
    if (user.role !== UserRole.TECHNICIAN || !user.isActive) throw new ConflictException('Assignee must be an active technician');
  }

  async putResult(projectId: string, inspectionId: string, itemId: string, dto: PutInspectionResultDto, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.write(async m => {
      const inspection = await this.inspection(m, projectId, inspectionId, true);
      const item = await m.findOne(InspectionItem, { where: { id: itemId, projectId, inspectionId }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('Item not found');
      version(item.version, dto.expectedVersion);
      if (!Object.values(Result).includes(dto.result)) throw new BadRequestException('Invalid result');
      const issues = await m.find(RemediationIssue, { where: { projectId, itemId } });
      const active = issues.find(issue => issue.status !== Status.CLOSED);
      if (active && dto.result !== Result.FAIL) throw new ConflictException('Recheck the open issue before changing result');
      if (dto.result !== Result.FAIL && dto.issue != null) throw new BadRequestException('Issue is only allowed with FAIL');
      if (active && dto.issue != null) throw new ConflictException('Item already has an open issue');
      if (dto.result === Result.FAIL && !active) {
        if (!dto.issue) throw new BadRequestException('FAIL requires an issue');
        const description = requiredText(dto.issue.description, 'Description');
        await this.activeTechnician(m, dto.issue.assigneeId);
        await m.save(RemediationIssue, m.create(RemediationIssue, {
          projectId, itemId: item.id, description, assigneeId: dto.issue.assigneeId, status: Status.OPEN,
          resolutionNote: null, resolvedAt: null, returnReason: null, reviewedById: null, reviewedAt: null, version: 1,
        }));
      }
      item.result = dto.result; item.note = dto.note ?? null;
      item.checkedById = user.id; item.checkedAt = new Date(); item.version++;
      await m.save(item);
      inspection.updatedAt = new Date(); await m.save(inspection);
      const detail = await this.detail(m, inspection);
      return detail.items.find(i => i.id === item.id)!;
    });
  }

  private async visibleIssue(m: EntityManager, projectId: string, issueId: string, user: AuthenticatedUser) {
    const issue = await m.findOneBy(RemediationIssue, {
      id: issueId, projectId, ...(user.role === UserRole.TECHNICIAN ? { assigneeId: user.id } : {}),
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  private async issueResponse(m: EntityManager, issue: RemediationIssue) {
    const item = await m.findOneByOrFail(InspectionItem, { projectId: issue.projectId, id: issue.itemId });
    const inspection = await this.inspection(m, issue.projectId, item.inspectionId);
    const assignee = await m.findOne(User, { where: { id: issue.assigneeId }, select: { id: true, email: true } });
    return { ...issue, assignee, item, inspectionId: inspection.id, inspectionCode: inspection.code,
      systemId: inspection.systemId, areaId: inspection.areaId, deviceId: inspection.deviceId };
  }

  async listIssues(projectId: string, user: AuthenticatedUser) {
    return this.db.transaction('REPEATABLE READ', async m => {
      if (!await m.findOneBy(Project, { id: projectId })) throw new NotFoundException('Project not found');
      const issues = await m.find(RemediationIssue, { where: { projectId, ...(user.role === UserRole.TECHNICIAN ? { assigneeId: user.id } : {}) }, order: { createdAt: 'DESC', id: 'ASC' } });
      const result = [];
      for (const issue of issues) result.push(await this.issueResponse(m, issue));
      return result;
    });
  }

  async getIssue(projectId: string, issueId: string, user: AuthenticatedUser) {
    return this.db.transaction('REPEATABLE READ', async m => this.issueResponse(m, await this.visibleIssue(m, projectId, issueId, user)));
  }

  private async mutateIssue(projectId: string, issueId: string, expected: number, user: AuthenticatedUser,
    work: (m: EntityManager, issue: RemediationIssue, item: InspectionItem) => Promise<void>) {
    return this.write(async m => {
      const initial = await this.visibleIssue(m, projectId, issueId, user);
      const initialItem = await m.findOneByOrFail(InspectionItem, { projectId, id: initial.itemId });
      const inspection = await this.inspection(m, projectId, initialItem.inspectionId, true);
      // Re-read ownership/version after waiting for the shared inspection lock.
      const issue = await this.visibleIssue(m, projectId, issueId, user);
      version(issue.version, expected);
      if (issue.status === Status.CLOSED) throw new ConflictException('Closed issue is immutable');
      const item = await m.findOne(InspectionItem, { where: { projectId, id: issue.itemId }, lock: { mode: 'pessimistic_write' } });
      if (!item) throw new NotFoundException('Item not found');
      await work(m, issue, item);
      issue.version++; await m.save(issue);
      inspection.updatedAt = new Date(); await m.save(inspection);
      return this.issueResponse(m, issue);
    });
  }

  startIssue(projectId: string, issueId: string, dto: VersionDto, user: AuthenticatedUser) {
    role(user, UserRole.TECHNICIAN);
    return this.mutateIssue(projectId, issueId, dto.expectedVersion, user, async (_m, issue) => {
      if (issue.status !== Status.OPEN) throw new ConflictException('Issue must be OPEN');
      issue.status = Status.IN_PROGRESS;
    });
  }

  resolveIssue(projectId: string, issueId: string, dto: ResolveIssueDto, user: AuthenticatedUser) {
    role(user, UserRole.TECHNICIAN);
    return this.mutateIssue(projectId, issueId, dto.expectedVersion, user, async (_m, issue) => {
      if (issue.status !== Status.IN_PROGRESS) throw new ConflictException('Issue must be IN_PROGRESS');
      issue.resolutionNote = requiredText(dto.resolutionNote, 'Resolution note');
      issue.resolvedAt = new Date(); issue.status = Status.RESOLVED;
    });
  }

  assignIssue(projectId: string, issueId: string, dto: AssignIssueDto, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.mutateIssue(projectId, issueId, dto.expectedVersion, user, async (m, issue) => {
      if (issue.status !== Status.OPEN) throw new ConflictException('Only OPEN issues can be reassigned');
      await this.activeTechnician(m, dto.assigneeId); issue.assigneeId = dto.assigneeId;
    });
  }

  recheckIssue(projectId: string, issueId: string, dto: RecheckIssueDto, user: AuthenticatedUser) {
    role(user, UserRole.MANAGER);
    return this.mutateIssue(projectId, issueId, dto.expectedVersion, user, async (m, issue, item) => {
      version(item.version, dto.expectedItemVersion);
      if (issue.status !== Status.RESOLVED) throw new ConflictException('Issue must be RESOLVED');
      if (![Result.PASS, Result.FAIL].includes(dto.result)) throw new BadRequestException('Recheck must be PASS or FAIL');
      item.note = requiredText(dto.note, 'Recheck note');
      if (dto.result === Result.FAIL) {
        issue.returnReason = requiredText(dto.reason, 'Return reason');
        issue.status = Status.OPEN; issue.resolutionNote = null; issue.resolvedAt = null;
        issue.reviewedById = null; issue.reviewedAt = null;
      } else {
        issue.status = Status.CLOSED; issue.reviewedById = user.id; issue.reviewedAt = new Date(); issue.returnReason = null;
      }
      item.result = dto.result; item.checkedById = user.id; item.checkedAt = new Date(); item.version++;
      await m.save(item);
    });
  }
}
