import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { AddressMode } from './address-mode.enum';

@Entity({ name: 'device_network_profiles' })
@Index('IDX_device_network_profiles_project_ip', ['projectId', 'ipAddress'])
@Check('CHK_device_network_profiles_mode_ip', '"address_mode" IS NOT NULL OR "ip_address" IS NULL')
@Check('CHK_device_network_profiles_ipv4', '"ip_address" IS NULL OR (family("ip_address") = 4 AND masklen("ip_address") = 32)')
@Check('CHK_device_network_profiles_mac', '"mac_address" IS NULL OR "mac_address" ~ \'^[0-9A-F]{2}(:[0-9A-F]{2}){5}$\'')
export class DeviceNetworkProfile {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @PrimaryColumn({ name: 'device_id', type: 'uuid' }) deviceId!: string;
  @Column({ name: 'address_mode', type: 'enum', enum: AddressMode, enumName: 'address_mode_enum', nullable: true }) addressMode!: AddressMode | null;
  @Column({ name: 'ip_address', type: 'inet', nullable: true }) ipAddress!: string | null;
  @Column({ name: 'mac_address', type: 'varchar', length: 17, nullable: true }) macAddress!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
