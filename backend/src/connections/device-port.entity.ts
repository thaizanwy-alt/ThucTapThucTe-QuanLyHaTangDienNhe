import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'device_ports' })
@Index('UQ_device_ports_project_device_code', ['projectId', 'deviceId', 'code'], { unique: true })
@Index('UQ_device_ports_project_id', ['projectId', 'id'], { unique: true })
@Check('CHK_device_ports_code', '"code" ~ \'^[A-Z0-9]+(-[A-Z0-9]+)*$\'')
export class DevicePort {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'device_id', type: 'uuid' }) deviceId!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'access_vlan_id', type: 'integer', nullable: true }) accessVlanId!: number | null;
  @Column({ name: 'poe_enabled', type: 'boolean', nullable: true }) poeEnabled!: boolean | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
