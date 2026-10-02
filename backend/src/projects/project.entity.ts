import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ProjectArea } from './project-area.entity';
import { ProjectStatus } from './project-status.enum';
import { ProjectSystem } from './project-system.entity';

@Entity({ name: 'projects' })
@Index('UQ_projects_code', ['code'], { unique: true })
@Index('IDX_projects_status', ['status'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'enum', enum: ProjectStatus, enumName: 'project_status_enum', default: ProjectStatus.PLANNING })
  status!: ProjectStatus;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ProjectArea, (area) => area.project)
  areas!: ProjectArea[];

  @OneToMany(() => ProjectSystem, (system) => system.project)
  systems!: ProjectSystem[];
}
