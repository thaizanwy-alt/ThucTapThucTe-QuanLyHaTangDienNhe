import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserRole } from '../users/user-role.enum';
import { User } from '../users/user.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { InspectionItem, ProjectInspection, RemediationIssue } from '../inspections/inspection.entities';
import { EvidenceAttachment } from './evidence.entity';
import { EvidenceStorage, StagedEvidence, captionOf, idempotencyKeyOf } from './evidence.storage';
import { DeleteEvidenceDto, UpdateEvidenceDto } from './evidence.dto';

export interface EvidenceTarget { taskId?: string; inspectionItemId?: string; issueId?: string; inspectionId?: string }

@Injectable()
export class EvidenceService {
  constructor(private readonly db: DataSource, private readonly storage: EvidenceStorage) {}

  private async target(m: EntityManager, projectId: string, target: EvidenceTarget, user: AuthenticatedUser, write = false) {
    if ([target.taskId, target.inspectionItemId, target.issueId].filter(Boolean).length !== 1) throw new BadRequestException('Exactly one target required');
    if (target.taskId) {
      const task = await m.findOne(ProjectTask, { where: { id: target.taskId, projectId }, lock: { mode: 'pessimistic_write' } });
      if (!task || (user.role === UserRole.TECHNICIAN && task.assigneeId !== user.id)) throw new NotFoundException('Task not found');
      if (write && !['ASSIGNED','IN_PROGRESS','RETURNED'].includes(task.status)) throw new ConflictException('Task evidence is locked');
      return;
    }
    if (target.inspectionItemId && user.role !== UserRole.MANAGER) throw new ForbiddenException();
    const initialIssue = target.issueId ? await m.findOneBy(RemediationIssue, { id: target.issueId, projectId }) : null;
    if (target.issueId && !initialIssue) throw new NotFoundException('Issue not found');
    const initialItem = await m.findOneBy(InspectionItem, { id: initialIssue?.itemId ?? target.inspectionItemId, projectId });
    if (!initialItem || (target.inspectionId && initialItem.inspectionId !== target.inspectionId)) throw new NotFoundException('Item not found');
    // Same order as putResult/mutateIssue: inspection -> item -> issue/evidence.
    const sheet = await m.findOne(ProjectInspection, { where: { id: initialItem.inspectionId, projectId }, lock: { mode: 'pessimistic_write' } });
    if (!sheet) throw new NotFoundException('Inspection not found');
    const item = await m.findOneOrFail(InspectionItem, { where: { id: initialItem.id, projectId }, lock: { mode: 'pessimistic_write' } });
    if (target.issueId) {
      const issue = await m.findOneBy(RemediationIssue, { id: target.issueId, projectId });
      if (!issue || (user.role === UserRole.TECHNICIAN && issue.assigneeId !== user.id)) throw new NotFoundException('Issue not found');
      if (write && !['OPEN','IN_PROGRESS'].includes(issue.status)) throw new ConflictException('Issue evidence is locked');
    } else if (write && item.result === 'PASS') throw new ConflictException('Passed item evidence is locked');
  }

  private where(projectId: string, target: EvidenceTarget) {
    return { projectId, ...(target.taskId ? { taskId: target.taskId } : target.issueId ? { issueId: target.issueId } : { inspectionItemId: target.inspectionItemId! }) };
  }
  private targetOf(e: EvidenceAttachment): EvidenceTarget {
    return { taskId: e.taskId ?? undefined, inspectionItemId: e.inspectionItemId ?? undefined, issueId: e.issueId ?? undefined };
  }
  private async response(m: EntityManager, e: EvidenceAttachment) {
    const uploadedBy = await m.findOne(User, { where: { id: e.uploadedById }, select: { id: true, email: true } });
    return { id: e.id, projectId: e.projectId, taskId: e.taskId, inspectionItemId: e.inspectionItemId, issueId: e.issueId,
      originalName: e.originalName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, sha256: e.sha256,
      uploadedBy, createdAt: e.createdAt, caption: e.caption, version: e.version };
  }
  private async transaction<T>(work: (m: EntityManager) => Promise<T>, outcome?: { rollbackConfirmed: boolean }): Promise<T> {
    try {
      if (!outcome) return await this.db.transaction(work);
      const runner = this.db.createQueryRunner();
      let commitAttempted = false;
      try {
        await runner.connect(); await runner.startTransaction();
        const result = await work(runner.manager);
        commitAttempted = true;
        await runner.commitTransaction();
        return result;
      } catch (error) {
        if (runner.isTransactionActive) {
          try {
            await runner.rollbackTransaction();
            // A ROLLBACK acknowledgement after attempted COMMIT is not proof:
            // COMMIT may already have succeeded and ROLLBACK may be a no-op.
            outcome.rollbackConfirmed = !commitAttempted;
          } catch { /* Unknown outcome: retain the promoted file. */ }
        }
        throw error;
      } finally { await runner.release().catch(() => undefined); }
    }
    catch (error) {
      const e = error as { driverError?: { code?: string }; code?: string };
      if (['23505','23503','40001','40P01'].includes(e.driverError?.code ?? e.code ?? '')) throw new ConflictException('Evidence or related data changed; reload and retry');
      throw error;
    }
  }

  async authorize(projectId: string, target: EvidenceTarget, user: AuthenticatedUser) {
    return this.transaction(m => this.target(m, projectId, target, user));
  }
  async list(projectId: string, target: EvidenceTarget, user: AuthenticatedUser) {
    return this.transaction(async m => {
      await this.target(m, projectId, target, user);
      const rows = await m.find(EvidenceAttachment, { where: { ...this.where(projectId, target), deletedAt: IsNull() }, order: { createdAt: 'DESC', id: 'ASC' } });
      const result = [];
      for (const e of rows) result.push(await this.response(m, e));
      return result;
    });
  }

  async upload(projectId: string, target: EvidenceTarget, user: AuthenticatedUser, key: string, file: StagedEvidence) {
    let finalPath: string | undefined;
    const outcome = { rollbackConfirmed: false };
    try {
      key = idempotencyKeyOf(key); file.caption = captionOf(file.caption);
      const fingerprint = createHash('sha256').update(JSON.stringify({ projectId: projectId.toLowerCase(),
        taskId: target.taskId?.toLowerCase() ?? null, inspectionItemId: target.inspectionItemId?.toLowerCase() ?? null,
        issueId: target.issueId?.toLowerCase() ?? null, originalName: file.originalName, mimeType: file.mimeType,
        sizeBytes: file.sizeBytes, sha256: file.sha256, caption: file.caption })).digest('hex');
      return await this.transaction(async m => {
        await this.target(m, projectId, target, user);
        const existing = await m.findOneBy(EvidenceAttachment, { projectId, uploadedById: user.id, idempotencyKey: key });
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ConflictException('Idempotency-Key was used with different content');
          if (existing.deletedAt) throw new NotFoundException('Evidence not found');
          // Retry may return an immutable, already committed record, but never bypass current ownership.
          return this.response(m, existing);
        }
        await this.target(m, projectId, target, user, true);
        if (await m.count(EvidenceAttachment, { where: { ...this.where(projectId, target), deletedAt: IsNull() } }) >= 20) throw new ConflictException('Maximum 20 evidence files per target');
        finalPath = await this.storage.promote(file);
        const e = await m.save(EvidenceAttachment, m.create(EvidenceAttachment, {
          projectId, taskId: target.taskId ?? null, inspectionItemId: target.inspectionItemId ?? null, issueId: target.issueId ?? null,
          storageKey: file.key, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
          sha256: file.sha256, caption: file.caption, uploadedById: user.id, idempotencyKey: key, fingerprint,
          version: 1, deletedAt: null, deletedById: null, deleteReason: null,
        }));
        return this.response(m, e);
      }, outcome);
    } catch (error) {
      if (finalPath && outcome.rollbackConfirmed) await this.storage.discard(finalPath);
      throw error;
    } finally { await this.storage.discard(file.path); }
  }

  private async evidence(m: EntityManager, projectId: string, id: string, user: AuthenticatedUser, write = false) {
    const initial = await m.findOneBy(EvidenceAttachment, { id, projectId, deletedAt: IsNull() });
    if (!initial) throw new NotFoundException('Evidence not found');
    await this.target(m, projectId, this.targetOf(initial), user, write);
    const current = await m.findOne(EvidenceAttachment, { where: { id, projectId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!current) throw new NotFoundException('Evidence not found');
    if (write && user.role === UserRole.TECHNICIAN && current.uploadedById !== user.id) throw new ForbiddenException('Only your own evidence can be changed');
    return current;
  }
  private version(e: EvidenceAttachment, expected: number) {
    if (!Number.isInteger(expected) || expected < 1) throw new BadRequestException('expectedVersion required');
    if (e.version !== expected || e.version >= 2147483647) throw new ConflictException('Evidence version changed');
  }
  async update(projectId: string, id: string, dto: UpdateEvidenceDto, user: AuthenticatedUser) {
    if (dto.caption === undefined) throw new BadRequestException('caption required');
    return this.transaction(async m => {
      const e = await this.evidence(m, projectId, id, user, true); this.version(e, dto.expectedVersion);
      e.caption = captionOf(dto.caption); e.version++; await m.save(e); return this.response(m, e);
    });
  }
  async remove(projectId: string, id: string, dto: DeleteEvidenceDto, user: AuthenticatedUser) {
    if (typeof dto.reason !== 'string' || !dto.reason.trim() || dto.reason.trim().length > 1000) throw new BadRequestException('Deletion reason required');
    await this.transaction(async m => {
      const e = await this.evidence(m, projectId, id, user, true); this.version(e, dto.expectedVersion);
      e.deletedAt = new Date(); e.deletedById = user.id; e.deleteReason = dto.reason.trim(); e.version++; await m.save(e);
    });
  }
  async content(projectId: string, id: string, user: AuthenticatedUser, preview: boolean) {
    return this.transaction(async m => {
      const e = await this.evidence(m, projectId, id, user);
      if (preview && !e.mimeType.startsWith('image/')) throw new BadRequestException('Preview is only available for images');
      const handle = await this.storage.content(e.storageKey);
      return { handle, name: e.originalName, mimeType: e.mimeType, size: e.sizeBytes };
    });
  }
}
