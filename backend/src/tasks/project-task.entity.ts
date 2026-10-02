import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TaskStatus } from './task-status.enum';

@Entity({ name: 'project_tasks' })
@Index('UQ_project_tasks_project_code', ['projectId', 'code'], { unique: true })
@Index('IDX_project_tasks_project_status', ['projectId', 'status'])
@Index('IDX_project_tasks_assignee_status_updated', ['assigneeId', 'status', 'updatedAt'])
@Index('IDX_project_tasks_project_system', ['projectId', 'systemId'])
@Index('IDX_project_tasks_project_area', ['projectId', 'areaId'])
@Check('CHK_project_tasks_code', '"code" ~ \'^[A-Z0-9]+(-[A-Z0-9]+)*$\'')
@Check('CHK_project_tasks_completion_note', '"status" NOT IN (\'SUBMITTED\', \'APPROVED\') OR ("completion_note" IS NOT NULL AND length(btrim("completion_note")) > 0)')
@Check('CHK_project_tasks_return_reason', '"status" <> \'RETURNED\' OR ("return_reason" IS NOT NULL AND length(btrim("return_reason")) > 0)')
export class ProjectTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId!: string | null;

  @Column({ name: 'assignee_id', type: 'uuid' })
  assigneeId!: string;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: TaskStatus, enumName: 'task_status_enum', default: TaskStatus.ASSIGNED })
  status!: TaskStatus;

  @Column({ name: 'completion_note', type: 'text', nullable: true })
  completionNote!: string | null;

  @Column({ name: 'return_reason', type: 'text', nullable: true })
  returnReason!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
