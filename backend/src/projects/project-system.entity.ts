import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Project } from './project.entity';
import { SystemCategory } from './system-category.enum';

@Entity({ name: 'project_systems' })
@Index('UQ_project_systems_project_code', ['projectId', 'code'], { unique: true })
@Index('IDX_project_systems_project_category', ['projectId', 'category'])
export class ProjectSystem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.systems, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'enum', enum: SystemCategory, enumName: 'system_category_enum' })
  category!: SystemCategory;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
