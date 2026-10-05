import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeviceConnections1794000000000 implements MigrationInterface {
  name = 'CreateDeviceConnections1794000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE connection_kind_enum AS ENUM ('FIXED','PATCH')`);
    await q.query(`CREATE TYPE port_side_enum AS ENUM ('FRONT','REAR','SINGLE')`);
    await q.query(`CREATE TYPE endpoint_end_enum AS ENUM ('A','B')`);
    await q.query(`CREATE TABLE device_ports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, device_id uuid NOT NULL,
      code varchar NOT NULL, description text,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CHK_device_ports_code" CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
      CONSTRAINT "FK_device_ports_device_project" FOREIGN KEY (project_id,device_id) REFERENCES project_devices(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query('CREATE UNIQUE INDEX "UQ_device_ports_project_device_code" ON device_ports(project_id,device_id,code)');
    await q.query('CREATE UNIQUE INDEX "UQ_device_ports_project_id" ON device_ports(project_id,id)');
    await q.query(`CREATE TABLE physical_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, kind connection_kind_enum NOT NULL,
      label varchar, description text, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CHK_physical_connections_version" CHECK (version >= 1),
      CONSTRAINT "FK_physical_connections_project" FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
    )`);
    await q.query('CREATE UNIQUE INDEX "UQ_physical_connections_project_id" ON physical_connections(project_id,id)');
    await q.query(`CREATE TABLE connection_endpoints (
      project_id uuid NOT NULL, connection_id uuid NOT NULL, "end" endpoint_end_enum NOT NULL,
      port_id uuid NOT NULL, side port_side_enum NOT NULL,
      PRIMARY KEY(connection_id,"end"),
      CONSTRAINT "FK_connection_endpoints_connection_project" FOREIGN KEY(project_id,connection_id) REFERENCES physical_connections(project_id,id) ON DELETE RESTRICT,
      CONSTRAINT "FK_connection_endpoints_port_project" FOREIGN KEY(project_id,port_id) REFERENCES device_ports(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query('CREATE UNIQUE INDEX "UQ_connection_endpoints_face" ON connection_endpoints(project_id,port_id,side)');
    await q.query('CREATE UNIQUE INDEX "UQ_connection_endpoints_port" ON connection_endpoints(connection_id,port_id)');
    await q.query('CREATE INDEX "IDX_connection_endpoints_project_connection" ON connection_endpoints(project_id,connection_id)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE connection_endpoints');
    await q.query('DROP TABLE physical_connections');
    await q.query('DROP TABLE device_ports');
    await q.query('DROP TYPE endpoint_end_enum');
    await q.query('DROP TYPE port_side_enum');
    await q.query('DROP TYPE connection_kind_enum');
  }
}
