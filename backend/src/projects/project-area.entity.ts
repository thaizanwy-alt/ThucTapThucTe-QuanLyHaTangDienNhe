import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AreaType } from './area-type.enum';
import { Project } from './project.entity';

@Entity({ name: 'project_areas' })
@Index('UQ_project_areas_project_code', ['projectId', 'code'], { unique: true })
@Index('UQ_project_areas_project_id_id', ['projectId', 'id'], { unique: true })
@Index('IDX_project_areas_tree_order', ['projectId', 'parentId', 'sortOrder'])
@Check('CHK_project_areas_sort_order', '"sort_order" >= 0')
export class ProjectArea {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.areas, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => ProjectArea, (area) => area.children, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent!: ProjectArea | null;

  @OneToMany(() => ProjectArea, (area) => area.parent)
  children!: ProjectArea[];

  @Column({ type: 'enum', enum: AreaType, enumName: 'area_type_enum' })
  type!: AreaType;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
