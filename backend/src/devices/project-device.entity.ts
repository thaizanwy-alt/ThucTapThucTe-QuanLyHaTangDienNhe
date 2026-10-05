import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DeviceType } from './device-type.enum';
import { MountMode, RackRole } from './rack-layout.enums';

@Entity({ name: 'project_devices' })
@Index('UQ_project_devices_project_code', ['projectId', 'code'], { unique: true })
@Index('UQ_project_devices_project_id_id', ['projectId', 'id'], { unique: true })
@Index('UQ_project_devices_project_id_type', ['projectId', 'id', 'type'], { unique: true })
@Index('IDX_project_devices_project_type', ['projectId', 'type'])
@Index('IDX_project_devices_project_area', ['projectId', 'areaId'])
@Index('IDX_project_devices_project_rack', ['projectId', 'rackId'])
@Check('CHK_project_devices_code', '"code" ~ \'^[A-Z0-9]+(-[A-Z0-9]+)*$\'')
@Check('CHK_project_devices_name', 'length(btrim("name")) > 0')
@Check('CHK_project_devices_location', '"rack_id" IS NULL OR ("area_id" IS NULL AND "type" IN (\'SWITCH\', \'PATCH_PANEL\', \'UPS\', \'PDU\', \'NVR\', \'ROUTER\', \'ODF\', \'CABLE_MANAGER\', \'SHELF\') AND "rack_id" <> "id")')
@Check('CHK_project_devices_capacity', '"capacity_u" IS NULL OR ("type" = \'RACK\' AND "capacity_u" >= 1)')
@Check('CHK_project_devices_rack_role', `("type" = 'RACK' AND (("rack_role" IS NULL AND "parent_rack_id" IS NULL) OR ("rack_role" = 'MAIN' AND "parent_rack_id" IS NULL AND "area_id" IS NOT NULL AND "capacity_u" IS NOT NULL) OR ("rack_role" = 'SUB' AND "parent_rack_id" IS NOT NULL AND "area_id" IS NOT NULL AND "capacity_u" IS NOT NULL))) OR ("type" <> 'RACK' AND "rack_role" IS NULL AND "parent_rack_id" IS NULL)`)
@Check('CHK_project_devices_mount', `(("rack_id" IS NULL AND "mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR ("rack_id" IS NOT NULL AND (("mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR ("mount_mode" = 'U' AND "height_u" IS NOT NULL AND "height_u" >= 1 AND ("start_u" IS NULL OR "start_u" >= 1)) OR ("mount_mode" = 'ZERO_U' AND "type" = 'PDU' AND "start_u" IS NULL AND "height_u" IS NOT NULL AND "height_u" = 0)))) IS TRUE`)
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

  @Column({ name: 'rack_role', type: 'enum', enum: RackRole, enumName: 'rack_role_enum', nullable: true })
  rackRole!: RackRole | null;

  @Column({ name: 'parent_rack_id', type: 'uuid', nullable: true })
  parentRackId!: string | null;

  @Column({ name: 'mount_mode', type: 'enum', enum: MountMode, enumName: 'mount_mode_enum', nullable: true })
  mountMode!: MountMode | null;

  @Column({ name: 'start_u', type: 'integer', nullable: true })
  startU!: number | null;

  @Column({ name: 'height_u', type: 'integer', nullable: true })
  heightU!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type ProjectDeviceResponse = ProjectDevice & {
  systemIds: string[];
  effectiveAreaId: string | null;
};
