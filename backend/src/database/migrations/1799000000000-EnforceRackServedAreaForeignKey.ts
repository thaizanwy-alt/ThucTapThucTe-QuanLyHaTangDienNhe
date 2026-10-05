import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceRackServedAreaForeignKey1799000000000 implements MigrationInterface {
  name = 'EnforceRackServedAreaForeignKey1799000000000';

  async up(q: QueryRunner): Promise<void> {
    // Hold both write locks through preflight and constraint installation.
    await q.query('LOCK TABLE project_devices, rack_served_areas IN SHARE ROW EXCLUSIVE MODE');
    const invalid = await q.query(`SELECT count(*)::int AS count FROM rack_served_areas s
      LEFT JOIN project_devices d ON d.project_id = s.project_id AND d.id = s.rack_id
      WHERE d.id IS NULL OR d.type <> 'RACK'`);
    if (invalid[0].count > 0) {
      throw new Error(`Rack served-area migration stopped: ${invalid[0].count} links do not reference RACK devices`);
    }

    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "UQ_project_devices_project_id_type"
      UNIQUE (project_id, id, type)`);
    await q.query(`ALTER TABLE rack_served_areas ADD COLUMN rack_type device_type_enum NOT NULL DEFAULT 'RACK'`);
    await q.query(`ALTER TABLE rack_served_areas ADD CONSTRAINT "CHK_rack_served_areas_rack_type"
      CHECK (rack_type = 'RACK')`);
    await q.query(`ALTER TABLE rack_served_areas ADD CONSTRAINT "FK_rack_served_areas_rack_type"
      FOREIGN KEY (project_id, rack_id, rack_type)
      REFERENCES project_devices(project_id, id, type)
      ON DELETE RESTRICT ON UPDATE RESTRICT`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE rack_served_areas DROP CONSTRAINT "FK_rack_served_areas_rack_type"');
    await q.query('ALTER TABLE rack_served_areas DROP CONSTRAINT "CHK_rack_served_areas_rack_type"');
    await q.query('ALTER TABLE rack_served_areas DROP COLUMN rack_type');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "UQ_project_devices_project_id_type"');
  }
}
