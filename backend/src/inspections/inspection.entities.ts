import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SystemCategory } from '../projects/system-category.enum';
import { InspectionResult, IssueStatus } from './inspection.enums';

@Entity('checklist_templates')
@Index('UQ_checklist_templates_code_revision', ['code', 'revision'], { unique: true })
export class ChecklistTemplate {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() code!: string;
  @Column() name!: string;
  @Column({ type: 'enum', enum: SystemCategory, enumName: 'system_category_enum' }) category!: SystemCategory;
  @Column({ type: 'integer' }) revision!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('checklist_template_items')
@Index('UQ_checklist_template_items_code', ['templateId', 'code'], { unique: true })
export class ChecklistTemplateItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'template_id', type: 'uuid' }) templateId!: string;
  @Column() code!: string;
  @Column() title!: string;
  @Column({ type: 'text', nullable: true }) instruction!: string | null;
  @Column({ name: 'sort_order', type: 'integer' }) sortOrder!: number;
}

@Entity('project_inspections')
@Index('UQ_project_inspections_project_code', ['projectId', 'code'], { unique: true })
@Index('UQ_project_inspections_project_id', ['projectId', 'id'], { unique: true })
@Index('IDX_project_inspections_system_created', ['projectId', 'systemId', 'createdAt'])
export class ProjectInspection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'system_id', type: 'uuid' }) systemId!: string;
  @Column({ name: 'area_id', type: 'uuid', nullable: true }) areaId!: string | null;
  @Column({ name: 'device_id', type: 'uuid', nullable: true }) deviceId!: string | null;
  @Column() code!: string;
  @Column() title!: string;
  @Column({ name: 'template_id', type: 'uuid' }) templateId!: string;
  @Column({ name: 'template_revision', type: 'integer' }) templateRevision!: number;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity('inspection_items')
@Index('UQ_inspection_items_code', ['inspectionId', 'code'], { unique: true })
@Index('UQ_inspection_items_project_id', ['projectId', 'id'], { unique: true })
export class InspectionItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'inspection_id', type: 'uuid' }) inspectionId!: string;
  @Column() code!: string;
  @Column() title!: string;
  @Column({ type: 'text', nullable: true }) instruction!: string | null;
  @Column({ name: 'sort_order', type: 'integer' }) sortOrder!: number;
  @Column({ type: 'enum', enum: InspectionResult, enumName: 'inspection_result_enum', default: InspectionResult.NOT_CHECKED }) result!: InspectionResult;
  @Column({ type: 'text', nullable: true }) note!: string | null;
  @Column({ name: 'checked_by_id', type: 'uuid', nullable: true }) checkedById!: string | null;
  @Column({ name: 'checked_at', type: 'timestamptz', nullable: true }) checkedAt!: Date | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
}

@Entity('remediation_issues')
@Index('UQ_remediation_issues_open_item', ['itemId'], { unique: true, where: "status <> 'CLOSED'" })
@Index('IDX_remediation_issues_project_status', ['projectId', 'status'])
@Index('IDX_remediation_issues_assignee_status', ['assigneeId', 'status'])
export class RemediationIssue {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ name: 'assignee_id', type: 'uuid' }) assigneeId!: string;
  @Column({ type: 'enum', enum: IssueStatus, enumName: 'issue_status_enum', default: IssueStatus.OPEN }) status!: IssueStatus;
  @Column({ name: 'resolution_note', type: 'text', nullable: true }) resolutionNote!: string | null;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
  @Column({ name: 'return_reason', type: 'text', nullable: true }) returnReason!: string | null;
  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true }) reviewedById!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
