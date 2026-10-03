import { Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'project_device_systems' })
@Index('IDX_project_device_systems_project_system', ['projectId', 'systemId'])
export class ProjectDeviceSystem {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @PrimaryColumn({ name: 'device_id', type: 'uuid' })
  deviceId!: string;

  @PrimaryColumn({ name: 'system_id', type: 'uuid' })
  systemId!: string;
}
