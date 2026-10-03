import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DeviceType } from './device-type.enum';

@Entity({ name: 'project_devices' })
@Index('UQ_project_devices_project_code', ['projectId', 'code'], { unique: true })
@Index('UQ_project_devices_project_id_id', ['projectId', 'id'], { unique: true })
@Index('IDX_project_devices_project_type', ['projectId', 'type'])
@Index('IDX_project_devices_project_area', ['projectId', 'areaId'])
@Index('IDX_project_devices_project_rack', ['projectId', 'rackId'])
@Check('CHK_project_devices_code', '"code" ~ \'^[A-Z0-9]+(-[A-Z0-9]+)*$\'')
@Check('CHK_project_devices_name', 'length(btrim("name")) > 0')
@Check('CHK_project_devices_location', '"rack_id" IS NULL OR ("area_id" IS NULL AND "type" IN (\'SWITCH\', \'PATCH_PANEL\') AND "rack_id" <> "id")')
@Check('CHK_project_devices_capacity', '"capacity_u" IS NULL OR ("type" = \'RACK\' AND "capacity_u" >= 1)')
export class ProjectDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ type: 'enum', enum: DeviceType, enumName: 'device_type_enum' })
  type!: DeviceType;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  brand!: string | null;

  @Column({ type: 'varchar', nullable: true })
  model!: string | null;

  @Column({ name: 'serial_number', type: 'varchar', nullable: true })
  serialNumber!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'location_note', type: 'text', nullable: true })
  locationNote!: string | null;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId!: string | null;

  @Column({ name: 'rack_id', type: 'uuid', nullable: true })
  rackId!: string | null;

  @Column({ name: 'capacity_u', type: 'integer', nullable: true })
  capacityU!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type ProjectDeviceResponse = ProjectDevice & {
  systemIds: string[];
  effectiveAreaId: string | null;
};
