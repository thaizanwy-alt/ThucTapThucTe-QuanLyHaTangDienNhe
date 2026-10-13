import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum AcceptanceStatus { DRAFT = 'DRAFT', CONFIRMED = 'CONFIRMED' }

@Entity('project_acceptances')
@Index('UQ_acceptances_project_code', ['projectId', 'code'], { unique: true })
@Index('UQ_acceptances_project_id', ['projectId', 'id'], { unique: true })
@Index('UQ_acceptances_project_system_id', ['projectId', 'systemId', 'id'], { unique: true })
@Index('UQ_acceptances_confirmed_replacement', ['replacesId'], { unique: true, where: "status = 'CONFIRMED' AND replaces_id IS NOT NULL" })
export class ProjectAcceptance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'system_id', type: 'uuid' }) systemId!: string;
  @Column() code!: string;
  @Column() title!: string;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @Column({ type: 'enum', enum: AcceptanceStatus, enumName: 'acceptance_status_enum', default: AcceptanceStatus.DRAFT }) status!: AcceptanceStatus;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @Column({ name: 'confirmed_by_id', type: 'uuid', nullable: true }) confirmedById!: string | null;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'replaces_id', type: 'uuid', nullable: true }) replacesId!: string | null;
  @Column({ name: 'replacement_reason', type: 'text', nullable: true }) replacementReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('acceptance_inspections')
export class AcceptanceInspection {
  @Column({ name: 'acceptance_id', type: 'uuid', primary: true }) acceptanceId!: string;
  @Column({ name: 'inspection_id', type: 'uuid', primary: true }) inspectionId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
}

@Entity('acceptance_evidence')
export class AcceptanceEvidence {
  @Column({ name: 'acceptance_id', type: 'uuid', primary: true }) acceptanceId!: string;
  @Column({ name: 'evidence_id', type: 'uuid', primary: true }) evidenceId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  // Internal pin: never serialized; metadata lives in the immutable snapshot.
  @Column({ name: 'pinned_storage_key', type: 'varchar', nullable: true }) pinnedStorageKey!: string | null;
}

@Entity('acceptance_snapshots')
export class AcceptanceSnapshot {
  @Column({ name: 'acceptance_id', type: 'uuid', primary: true }) acceptanceId!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'schema_version', type: 'integer', default: 1 }) schemaVersion!: number;
  @Column({ name: 'source_fingerprint', length: 64 }) sourceFingerprint!: string;
  @Column({ type: 'jsonb' }) content!: Record<string, any>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
