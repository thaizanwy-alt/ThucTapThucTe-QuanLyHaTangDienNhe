import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserRole } from '../users/user-role.enum';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectDevice } from '../devices/project-device.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { ProjectInspection, InspectionItem, RemediationIssue } from '../inspections/inspection.entities';
import { EvidenceAttachment } from '../evidence/evidence.entity';
import { EvidenceService } from '../evidence/evidence.service';
import { EvidenceStorage } from '../evidence/evidence.storage';
import { AcceptanceEvidence, AcceptanceInspection, AcceptanceSnapshot, AcceptanceStatus, ProjectAcceptance } from './acceptance.entities';
import { ConfirmAcceptanceDto, CreateAcceptanceDto, ListAcceptancesDto, ReplacementAcceptanceDto, UpdateAcceptanceDto } from './acceptance.dto';

const lower = (id: string) => id.toLowerCase();
function ids(values: string[]): string[] {
  const result = values.map(lower).sort();
  if (new Set(result).size !== result.length) throw new BadRequestException('Duplicate resource IDs');
  return result;
}
// Object keys, dates and all selection arrays have a deterministic representation.
export function canonical(value: any): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function manager(user: AuthenticatedUser) { if (user.role !== UserRole.MANAGER) throw new ForbiddenException(); }
function version(a: ProjectAcceptance, expected: number) {
  if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('expectedVersion required');
  if (expected !== a.version || a.version >= 2147483647) throw new ConflictException('Acceptance version changed');
}

@Injectable()
export class AcceptancesService {
  constructor(private readonly db: DataSource, private readonly storage: EvidenceStorage, private readonly evidence: EvidenceService) {}

  private async write<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(work); }
    catch (error) {
      const e = error as { code?: string; driverError?: { code?: string } };
      if (['23505', '23503', '40001', '40P01'].includes(e.driverError?.code ?? e.code ?? '')) throw new ConflictException('Acceptance or related data changed; reload and retry');
      throw error;
    }
  }
  private async find(m: EntityManager, projectId: string, id: string, lock = false) {
    const a = await m.findOne(ProjectAcceptance, { where: { projectId, id }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!a) throw new NotFoundException('Acceptance not found');
    return a;
  }
  private async editable(m: EntityManager, p: string, id: string) {
    const initial = await this.find(m, p, id);
    // All candidate mutations lock the predecessor before the candidate.
    if (initial.replacesId) await this.find(m, p, initial.replacesId, true);
    const a = await this.find(m, p, id, true);
    if (a.status !== AcceptanceStatus.DRAFT) throw new ConflictException('Confirmed acceptance is immutable');
    return a;
  }
  private async selections(m: EntityManager, a: ProjectAcceptance) {
    return {
      inspectionIds: (await m.find(AcceptanceInspection, { where: { acceptanceId: a.id, projectId: a.projectId } })).map(r => r.inspectionId).sort(),
      evidenceIds: (await m.find(AcceptanceEvidence, { where: { acceptanceId: a.id, projectId: a.projectId } })).map(r => r.evidenceId).sort(),
    };
  }
  private async validateSelection(m: EntityManager, p: string, systemId: string, inspections: string[], evidence: string[]) {
    const sheets = inspections.length ? await m.find(ProjectInspection, { where: { projectId: p, id: In(inspections) } }) : [];
    if (sheets.length !== inspections.length) throw new NotFoundException('Inspection not found');
    if (sheets.some(s => s.systemId !== lower(systemId))) throw new BadRequestException('Inspection must belong to acceptance System');
    const files = evidence.length ? await m.find(EvidenceAttachment, { where: { projectId: p, id: In(evidence) } }) : [];
    if (files.length !== evidence.length) throw new NotFoundException('Evidence not found');
    for (const f of files) {
      if (f.deletedAt) throw new ConflictException('Selected evidence was deleted');
      if (f.taskId) {
        const task = await m.findOneBy(ProjectTask, { projectId: p, id: f.taskId });
        if (!task) throw new NotFoundException('Evidence Task not found');
        if (task.systemId !== lower(systemId)) throw new BadRequestException('Evidence Task must belong to acceptance System');
      } else {
        const issue = f.issueId ? await m.findOneBy(RemediationIssue, { projectId: p, id: f.issueId }) : null;
        const item = await m.findOneBy(InspectionItem, { projectId: p, id: issue?.itemId ?? f.inspectionItemId! });
        if (!item || !inspections.includes(item.inspectionId)) throw new BadRequestException('Evidence must belong to a selected inspection');
      }
    }
    return files;
  }
  private async replaceSelection(m: EntityManager, a: ProjectAcceptance, inspectionIds: string[], evidenceIds: string[]) {
    await this.validateSelection(m, a.projectId, a.systemId, inspectionIds, evidenceIds);
    await m.delete(AcceptanceInspection, { acceptanceId: a.id });
    await m.delete(AcceptanceEvidence, { acceptanceId: a.id });
    if (inspectionIds.length) await m.insert(AcceptanceInspection, inspectionIds.map(inspectionId => ({ projectId: a.projectId, acceptanceId: a.id, inspectionId })));
    if (evidenceIds.length) await m.insert(AcceptanceEvidence, evidenceIds.map(evidenceId => ({ projectId: a.projectId, acceptanceId: a.id, evidenceId, pinnedStorageKey: null })));
  }
  private async latest(m: EntityManager, a: ProjectAcceptance) {
    if (a.status !== AcceptanceStatus.CONFIRMED) throw new ConflictException('Replacement requires a confirmed acceptance');
    if (await m.existsBy(ProjectAcceptance, { replacesId: a.id, status: AcceptanceStatus.CONFIRMED })) throw new ConflictException('Replace the latest confirmed acceptance instead');
  }

  async create(p: string, dto: CreateAcceptanceDto, user: AuthenticatedUser) {
    manager(user);
    return this.write(async m => {
      if (!await m.existsBy(ProjectSystem, { projectId: p, id: dto.systemId })) throw new NotFoundException('System not found');
      const a = await m.save(ProjectAcceptance, m.create(ProjectAcceptance, { projectId: p, systemId: lower(dto.systemId), code: dto.code.trim().toUpperCase(), title: dto.title.trim(), note: dto.note?.trim() || null,
        status: AcceptanceStatus.DRAFT, version: 1, createdById: user.id, confirmedById: null, confirmedAt: null, replacesId: null, replacementReason: null }));
      await this.replaceSelection(m, a, ids(dto.inspectionIds), ids(dto.evidenceIds));
      return this.response(m, a, user);
    });
  }
  async update(p: string, id: string, dto: UpdateAcceptanceDto, user: AuthenticatedUser) {
    manager(user);
    if (!['code', 'title', 'note', 'inspectionIds', 'evidenceIds'].some(k => (dto as any)[k] !== undefined)) throw new BadRequestException('Empty PATCH');
    return this.write(async m => {
      const a = await this.editable(m, p, id); version(a, dto.expectedVersion);
      const selected = await this.selections(m, a);
      if (dto.code !== undefined) a.code = dto.code.trim().toUpperCase();
      if (dto.title !== undefined) a.title = dto.title.trim();
      if (dto.note !== undefined) a.note = dto.note?.trim() || null;
      await this.replaceSelection(m, a, dto.inspectionIds === undefined ? selected.inspectionIds : ids(dto.inspectionIds), dto.evidenceIds === undefined ? selected.evidenceIds : ids(dto.evidenceIds));
      a.version++; await m.save(a); return this.response(m, a, user);
    });
  }
  async replacement(p: string, id: string, dto: ReplacementAcceptanceDto, user: AuthenticatedUser) {
    manager(user);
    return this.write(async m => {
      const old = await this.find(m, p, id, true); await this.latest(m, old);
      const a = await m.save(ProjectAcceptance, m.create(ProjectAcceptance, { projectId: old.projectId, systemId: old.systemId, code: dto.code.trim().toUpperCase(), title: dto.title.trim(), note: old.note,
        status: AcceptanceStatus.DRAFT, version: 1, createdById: user.id, replacesId: old.id, replacementReason: dto.reason.trim(), confirmedById: null, confirmedAt: null }));
      // Explicit fresh selections never change the predecessor's snapshot or pins.
      await this.replaceSelection(m, a, ids(dto.inspectionIds), ids(dto.evidenceIds));
      return this.response(m, a, user);
    });
  }

  private async response(m: EntityManager, a: ProjectAcceptance, user: AuthenticatedUser) {
    const replacement = await m.findOneBy(ProjectAcceptance, { replacesId: a.id, status: AcceptanceStatus.CONFIRMED });
    if (user.role === UserRole.TECHNICIAN) {
      if (a.status !== AcceptanceStatus.CONFIRMED) throw new NotFoundException('Acceptance not found');
      const s = await m.findOneByOrFail(AcceptanceSnapshot, { acceptanceId: a.id });
      // Explicit whitelist: never spread an entity or snapshot for a technician.
      return { id: a.id, projectId: a.projectId, systemId: a.systemId, code: a.code, title: a.title, status: a.status,
        version: a.version, confirmedAt: a.confirmedAt, replacesId: a.replacesId, replacedById: replacement?.id ?? null,
        project: { id: s.content.project.id, code: s.content.project.code, name: s.content.project.name },
        system: { id: s.content.system.id, code: s.content.system.code, name: s.content.system.name, category: s.content.system.category },
        summary: s.content.summary };
    }
    const selected = await this.selections(m, a);
    const s = a.status === AcceptanceStatus.CONFIRMED ? await m.findOneByOrFail(AcceptanceSnapshot, { acceptanceId: a.id }) : null;
    return { ...a, ...selected, replacedById: replacement?.id ?? null,
      snapshot: s ? { schemaVersion: s.schemaVersion, sourceFingerprint: s.sourceFingerprint, content: s.content, createdAt: s.createdAt } : null };
  }
  async get(p: string, id: string, user: AuthenticatedUser) {
    return this.db.transaction('REPEATABLE READ', async m => this.response(m, await this.find(m, p, id), user));
  }
  async list(p: string, query: ListAcceptancesDto, user: AuthenticatedUser) {
    return this.db.transaction('REPEATABLE READ', async m => {
      if (!await m.existsBy(Project, { id: p })) throw new NotFoundException('Project not found');
      if (user.role === UserRole.TECHNICIAN && query.status === AcceptanceStatus.DRAFT) return [];
      const rows = await m.find(ProjectAcceptance, { where: { projectId: p, ...(query.systemId ? { systemId: query.systemId } : {}),
        ...(user.role === UserRole.TECHNICIAN ? { status: AcceptanceStatus.CONFIRMED } : query.status ? { status: query.status } : {}) }, order: { createdAt: 'DESC', id: 'ASC' } });
      const result = []; for (const a of rows) result.push(await this.response(m, a, user)); return result;
    });
  }

  private async sources(m: EntityManager, a: ProjectAcceptance, project: Project, confirmingUser: AuthenticatedUser) {
    const selection = await this.selections(m, a);
    const system = await m.findOne(ProjectSystem, { where: { projectId: a.projectId, id: a.systemId }, lock: { mode: 'pessimistic_read' } });
    if (!system) throw new NotFoundException('System not found');
    // Discovery only. Every mutable source is reread after acquiring the same
    // parent locks as its mutation API: sorted Tasks, then sorted inspections,
    // then Items, Issues and evidence. Never lock evidence before its target.
    const initial = selection.evidenceIds.length ? await m.find(EvidenceAttachment, { where: { projectId: a.projectId, id: In(selection.evidenceIds) } }) : [];
    await this.validateSelection(m, a.projectId, a.systemId, selection.inspectionIds, selection.evidenceIds);
    const taskIds = [...new Set(initial.map(f => f.taskId).filter((v): v is string => !!v))].sort();
    const tasks = [];
    for (const id of taskIds) {
      const t = await m.findOne(ProjectTask, { where: { projectId: a.projectId, id }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('Task not found'); tasks.push(t);
    }
    const sheets = [];
    for (const id of selection.inspectionIds) {
      const s = await m.findOne(ProjectInspection, { where: { projectId: a.projectId, id }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw new NotFoundException('Inspection not found'); sheets.push(s);
    }
    const inspections = [];
    const blockers: string[] = [];
    if (!sheets.length) blockers.push('NO_INSPECTIONS');
    for (const sheet of sheets) {
      const items = await m.find(InspectionItem, { where: { projectId: a.projectId, inspectionId: sheet.id }, order: { sortOrder: 'ASC', code: 'ASC', id: 'ASC' } });
      if (!items.length) blockers.push(`EMPTY_INSPECTION:${sheet.id}`);
      for (const item of items) {
        await m.findOne(InspectionItem, { where: { id: item.id }, lock: { mode: 'pessimistic_write' } });
        if (item.result !== 'PASS') blockers.push(`ITEM_NOT_PASS:${item.id}`);
      }
      const issues = items.length ? await m.find(RemediationIssue, { where: { projectId: a.projectId, itemId: In(items.map(i => i.id)) }, order: { id: 'ASC' } }) : [];
      for (const issue of issues) {
        await m.findOne(RemediationIssue, { where: { id: issue.id }, lock: { mode: 'pessimistic_write' } });
        if (issue.status !== 'CLOSED') blockers.push(`ISSUE_NOT_CLOSED:${issue.id}`);
      }
      const area = sheet.areaId ? await m.findOne(ProjectArea, { where: { projectId: a.projectId, id: sheet.areaId }, lock: { mode: 'pessimistic_read' } }) : null;
      const device = sheet.deviceId ? await m.findOne(ProjectDevice, { where: { projectId: a.projectId, id: sheet.deviceId }, lock: { mode: 'pessimistic_read' } }) : null;
      // A device's current System links do not invalidate a historical inspection.
      inspections.push({ ...sheet, area, device, items, issues });
    }
    const files: EvidenceAttachment[] = [];
    for (const id of selection.evidenceIds) {
      const f = await m.findOne(EvidenceAttachment, { where: { projectId: a.projectId, id }, lock: { mode: 'pessimistic_write' } });
      if (!f) throw new NotFoundException('Evidence not found'); files.push(f);
    }
    await this.validateSelection(m, a.projectId, a.systemId, selection.inspectionIds, selection.evidenceIds);
    const actorIds = [...new Set([confirmingUser.id, a.createdById, ...sheets.map(s => s.createdById), ...files.map(f => f.uploadedById), ...tasks.flatMap(t => [t.assigneeId, t.reviewedById]),
      ...inspections.flatMap(s => [...s.items.map(i => i.checkedById), ...s.issues.flatMap(i => [i.assigneeId, i.reviewedById])])].filter((v): v is string => !!v))].sort();
    const actors = [];
    for (const id of actorIds) {
      const actor = await m.findOne(User, { where: { id }, select: { id: true, email: true, role: true }, lock: { mode: 'pessimistic_read' } });
      if (!actor) throw new ConflictException('Snapshot actor unavailable'); actors.push(actor);
    }
    const content = { acceptance: { id: a.id, code: a.code, title: a.title, note: a.note, replacesId: a.replacesId, replacementReason: a.replacementReason, createdById: a.createdById },
      project, system, inspections, tasks, actors, confirmedBy: actors.find(actor => actor.id === lower(confirmingUser.id)),
      evidence: files.map(f => ({ id: f.id, taskId: f.taskId, inspectionItemId: f.inspectionItemId, issueId: f.issueId, originalName: f.originalName, mimeType: f.mimeType,
        sizeBytes: f.sizeBytes, sha256: f.sha256, caption: f.caption, uploadedById: f.uploadedById, createdAt: f.createdAt, version: f.version })),
      summary: { inspectionCount: inspections.length, itemCount: inspections.reduce((n, s) => n + s.items.length, 0), evidenceCount: files.length } };
    return { content: JSON.parse(canonical(content)), files, blockers: blockers.sort(), fingerprint: createHash('sha256').update(canonical(content)).digest('hex') };
  }
  private async lockedProject(m: EntityManager, p: string) {
    const project = await m.findOne(Project, { where: { id: p }, lock: { mode: 'pessimistic_write' } });
    if (!project) throw new NotFoundException('Project not found'); return project;
  }
  async readiness(p: string, id: string, user: AuthenticatedUser) {
    manager(user);
    return this.write(async m => {
      const project = await this.lockedProject(m, p); const a = await this.editable(m, p, id);
      const source = await this.sources(m, a, project, user);
      return { eligible: source.blockers.length === 0, blockers: source.blockers, sourceFingerprint: source.fingerprint, version: a.version };
    });
  }
  private async verifyFile(f: EvidenceAttachment) {
    const handle = await this.storage.content(f.storageKey);
    try {
      const hash = createHash('sha256'); let size = 0;
      for await (const bytes of handle.createReadStream({ autoClose: false })) { size += bytes.length; hash.update(bytes); }
      if (size !== f.sizeBytes || hash.digest('hex') !== f.sha256) throw new ConflictException('Selected evidence file integrity check failed');
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      throw new ServiceUnavailableException('Cannot read selected evidence');
    } finally { await handle.close(); }
  }
  async confirm(p: string, id: string, dto: ConfirmAcceptanceDto, user: AuthenticatedUser) {
    manager(user);
    return this.write(async m => {
      const project = await this.lockedProject(m, p); const a = await this.editable(m, p, id); version(a, dto.expectedVersion);
      if (a.replacesId) await this.latest(m, await this.find(m, p, a.replacesId));
      const source = await this.sources(m, a, project, user);
      if (source.fingerprint !== dto.expectedSourceFingerprint) throw new ConflictException('Acceptance sources changed; reload readiness');
      if (source.blockers.length) throw new ConflictException({ message: 'Selected inspections are not ready', blockers: source.blockers });
      for (const file of source.files) await this.verifyFile(file);
      await m.insert(AcceptanceSnapshot, { acceptanceId: a.id, projectId: a.projectId, schemaVersion: 1, sourceFingerprint: source.fingerprint, content: source.content });
      for (const file of source.files) await m.update(AcceptanceEvidence, { acceptanceId: a.id, evidenceId: file.id }, { pinnedStorageKey: file.storageKey });
      a.status = AcceptanceStatus.CONFIRMED; a.version++; a.confirmedById = user.id; a.confirmedAt = new Date();
      await m.save(a); return this.response(m, a, user);
    });
  }
  async file(p: string, id: string, evidenceId: string, user: AuthenticatedUser, preview: boolean) {
    manager(user);
    const selected = await this.db.transaction('REPEATABLE READ', async m => {
      const a = await this.find(m, p, id);
      const link = await m.findOneBy(AcceptanceEvidence, { projectId: p, acceptanceId: a.id, evidenceId });
      if (!link) throw new NotFoundException('Acceptance file not found');
      if (a.status === AcceptanceStatus.DRAFT) return null;
      const snapshot = await m.findOneByOrFail(AcceptanceSnapshot, { acceptanceId: a.id });
      const file = snapshot.content.evidence.find((f: any) => f.id === lower(evidenceId));
      if (!file || !link.pinnedStorageKey) throw new ServiceUnavailableException('Acceptance file unavailable');
      return { file, key: link.pinnedStorageKey };
    });
    // Draft delegates to source authorization, including current soft deletion.
    if (!selected) return this.evidence.content(p, evidenceId, user, preview);
    if (preview && !selected.file.mimeType.startsWith('image/')) throw new BadRequestException('Preview is only available for images');
    return { handle: await this.storage.content(selected.key), name: selected.file.originalName, mimeType: selected.file.mimeType, size: selected.file.sizeBytes };
  }
}
