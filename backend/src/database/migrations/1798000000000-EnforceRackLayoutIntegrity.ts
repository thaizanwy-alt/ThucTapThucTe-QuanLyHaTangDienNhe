import { MigrationInterface, QueryRunner } from 'typeorm';

const mountCheck = `("rack_id" IS NULL AND "mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR
  ("rack_id" IS NOT NULL AND (
    ("mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR
    ("mount_mode" = 'U' AND "height_u" IS NOT NULL AND "height_u" >= 1
      AND ("start_u" IS NULL OR "start_u" >= 1)) OR
    ("mount_mode" = 'ZERO_U' AND "type" = 'PDU' AND "start_u" IS NULL
      AND "height_u" IS NOT NULL AND "height_u" = 0)
  ))`;

const priorMountCheck = `("rack_id" IS NULL AND "mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR
  ("rack_id" IS NOT NULL AND (
    ("mount_mode" IS NULL AND "start_u" IS NULL AND "height_u" IS NULL) OR
    ("mount_mode" = 'U' AND "height_u" >= 1 AND ("start_u" IS NULL OR "start_u" >= 1)) OR
    ("mount_mode" = 'ZERO_U' AND "type" = 'PDU' AND "start_u" IS NULL AND "height_u" = 0)
  ))`;

export class EnforceRackLayoutIntegrity1798000000000 implements MigrationInterface {
  name = 'EnforceRackLayoutIntegrity1798000000000';

  async up(q: QueryRunner): Promise<void> {
    const invalidMount = await q.query(`SELECT count(*)::int AS count FROM project_devices
      WHERE (${mountCheck}) IS NOT TRUE`);
    if (invalidMount[0].count > 0) {
      throw new Error(`Rack layout migration stopped: ${invalidMount[0].count} invalid mount records`);
    }
    const invalidServed = await q.query(`SELECT count(*)::int AS count FROM rack_served_areas s
      JOIN project_devices d ON d.project_id = s.project_id AND d.id = s.rack_id
      WHERE d.type <> 'RACK'`);
    if (invalidServed[0].count > 0) {
      throw new Error(`Rack layout migration stopped: ${invalidServed[0].count} served areas reference non-racks`);
    }

    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_mount"');
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_mount" CHECK ((${mountCheck}) IS TRUE)`);
    await q.query(`CREATE FUNCTION assert_rack_served_area_type(project_uuid uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM rack_served_areas s
          JOIN project_devices d ON d.project_id = s.project_id AND d.id = s.rack_id
          WHERE s.project_id = project_uuid AND d.type <> 'RACK'
        ) THEN RAISE EXCEPTION 'Served area must reference a RACK device'
          USING ERRCODE = '23514'; END IF;
      END $$`);
    await q.query(`CREATE FUNCTION check_rack_served_area_type()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM assert_rack_served_area_type(OLD.project_id); END IF;
        IF TG_OP IN ('UPDATE','INSERT') THEN PERFORM assert_rack_served_area_type(NEW.project_id); END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_rack_served_area_type_links
      AFTER INSERT OR UPDATE OR DELETE ON rack_served_areas
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_rack_served_area_type()`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_rack_served_area_type_devices
      AFTER INSERT OR UPDATE OR DELETE ON project_devices
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_rack_served_area_type()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER check_rack_served_area_type_devices ON project_devices');
    await q.query('DROP TRIGGER check_rack_served_area_type_links ON rack_served_areas');
    await q.query('DROP FUNCTION check_rack_served_area_type()');
    await q.query('DROP FUNCTION assert_rack_served_area_type(uuid)');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_mount"');
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_mount" CHECK (${priorMountCheck})`);
  }
}
