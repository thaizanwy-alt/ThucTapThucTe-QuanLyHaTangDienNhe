import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceNetworkProfileAndPortMetadata1796000000000 implements MigrationInterface {
  name = 'AddDeviceNetworkProfileAndPortMetadata1796000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE address_mode_enum AS ENUM ('STATIC','DHCP')`);
    await q.query(`CREATE TABLE device_network_profiles (
      project_id uuid NOT NULL, device_id uuid NOT NULL,
      address_mode address_mode_enum, ip_address inet, mac_address varchar(17),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_device_network_profiles" PRIMARY KEY (project_id,device_id),
      CONSTRAINT "FK_device_network_profiles_device_project" FOREIGN KEY (project_id,device_id)
        REFERENCES project_devices(project_id,id) ON DELETE RESTRICT,
      CONSTRAINT "CHK_device_network_profiles_mode_ip" CHECK (address_mode IS NOT NULL OR ip_address IS NULL),
      CONSTRAINT "CHK_device_network_profiles_ipv4" CHECK (ip_address IS NULL OR (family(ip_address) = 4 AND masklen(ip_address) = 32)),
      CONSTRAINT "CHK_device_network_profiles_mac" CHECK (mac_address IS NULL OR mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$')
    )`);
    // Intentionally non-unique: duplicate IPs within a project are warnings, not write conflicts.
    await q.query('CREATE INDEX "IDX_device_network_profiles_project_ip" ON device_network_profiles(project_id,ip_address)');
    await q.query('ALTER TABLE device_ports ADD COLUMN access_vlan_id integer, ADD COLUMN poe_enabled boolean');
    await q.query('ALTER TABLE device_ports ADD CONSTRAINT "CHK_device_ports_access_vlan" CHECK (access_vlan_id IS NULL OR access_vlan_id BETWEEN 1 AND 4094)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE device_ports DROP CONSTRAINT "CHK_device_ports_access_vlan"');
    await q.query('ALTER TABLE device_ports DROP COLUMN poe_enabled, DROP COLUMN access_vlan_id');
    await q.query('DROP TABLE device_network_profiles');
    await q.query('DROP TYPE address_mode_enum');
  }
}
