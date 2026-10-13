import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('evidence_attachments')
@Index('UQ_evidence_storage_key', ['storageKey'], { unique: true })
@Index('UQ_evidence_idempotency', ['projectId', 'uploadedById', 'idempotencyKey'], { unique: true })
export class EvidenceAttachment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'task_id', type: 'uuid', nullable: true }) taskId!: string | null;
  @Column({ name: 'inspection_item_id', type: 'uuid', nullable: true }) inspectionItemId!: string | null;
  @Column({ name: 'issue_id', type: 'uuid', nullable: true }) issueId!: string | null;
  @Column({ name: 'storage_key' }) storageKey!: string;
  @Column({ name: 'original_name', length: 255 }) originalName!: string;
  @Column({ name: 'mime_type' }) mimeType!: string;
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes!: number;
  @Column({ length: 64 }) sha256!: string;
  @Column({ name: 'uploaded_by_id', type: 'uuid' }) uploadedById!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'text', nullable: true }) caption!: string | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'idempotency_key', length: 128 }) idempotencyKey!: string;
  @Column({ length: 64 }) fingerprint!: string;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @Column({ name: 'deleted_by_id', type: 'uuid', nullable: true }) deletedById!: string | null;
  @Column({ name: 'delete_reason', type: 'text', nullable: true }) deleteReason!: string | null;
}
