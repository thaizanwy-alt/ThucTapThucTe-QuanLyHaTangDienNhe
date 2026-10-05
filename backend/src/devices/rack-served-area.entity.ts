import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { DeviceType } from './device-type.enum';

@Entity({ name: 'rack_served_areas' })
@Index('IDX_rack_served_areas_project_area', ['projectId', 'areaId'])
@Check('CHK_rack_served_areas_rack_type', `"rack_type" = 'RACK'`)
export class RackServedArea {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @PrimaryColumn({ name: 'rack_id', type: 'uuid' })
  rackId!: string;

  @PrimaryColumn({ name: 'area_id', type: 'uuid' })
  areaId!: string;

  @Column({ name: 'rack_type', type: 'enum', enum: DeviceType, enumName: 'device_type_enum', default: DeviceType.RACK })
  rackType!: DeviceType;
}
