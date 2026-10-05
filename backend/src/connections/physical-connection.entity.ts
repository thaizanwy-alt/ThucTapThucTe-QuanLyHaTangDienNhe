import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ConnectionKind } from './connection.enums';

@Entity({ name: 'physical_connections' })
@Index('UQ_physical_connections_project_id', ['projectId', 'id'], { unique: true })
@Check('CHK_physical_connections_version', '"version" >= 1')
export class PhysicalConnection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ type: 'enum', enum: ConnectionKind, enumName: 'connection_kind_enum' }) kind!: ConnectionKind;
  @Column({ type: 'varchar', nullable: true }) label!: string | null;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
