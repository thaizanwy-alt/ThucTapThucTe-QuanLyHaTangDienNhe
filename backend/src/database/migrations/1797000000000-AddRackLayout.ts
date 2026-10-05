import { MigrationInterface, QueryRunner } from 'typeorm';

const oldTypes = "'RACK','PATCH_PANEL','SWITCH','NETWORK_OUTLET','AP','CAMERA'";
const newTypes = oldTypes + ",'UPS','PDU','NVR','ROUTER','ODF','CABLE_MANAGER','SHELF'";
const rackable = "'SWITCH','PATCH_PANEL','UPS','PDU','NVR','ROUTER','ODF','CABLE_MANAGER','SHELF'";

export class AddRackLayout1797000000000 implements MigrationInterface {
  name = 'AddRackLayout1797000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_location"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_capacity"');
    await q.query('ALTER TYPE device_type_enum RENAME TO device_type_enum_old');
    await q.query(`CREATE TYPE device_type_enum AS ENUM (${newTypes})`);
    await q.query('ALTER TABLE project_devices ALTER COLUMN type TYPE device_type_enum USING type::text::device_type_enum');
    await q.query('DROP TYPE device_type_enum_old');
    await q.query("CREATE TYPE rack_role_enum AS ENUM ('MAIN','SUB')");
    await q.query("CREATE TYPE mount_mode_enum AS ENUM ('U','ZERO_U')");
    await q.query(`ALTER TABLE project_devices
      ADD COLUMN rack_role rack_role_enum,
      ADD COLUMN parent_rack_id uuid,
      ADD COLUMN mount_mode mount_mode_enum,
      ADD COLUMN start_u integer,
      ADD COLUMN height_u integer`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_location"
      CHECK (rack_id IS NULL OR (area_id IS NULL AND type IN (${rackable}) AND rack_id <> id))`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_capacity"
      CHECK (capacity_u IS NULL OR (type = 'RACK' AND capacity_u >= 1))`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_rack_role"
      CHECK ((type = 'RACK' AND (
        (rack_role IS NULL AND parent_rack_id IS NULL) OR
        (rack_role = 'MAIN' AND parent_rack_id IS NULL AND area_id IS NOT NULL AND capacity_u IS NOT NULL) OR
        (rack_role = 'SUB' AND parent_rack_id IS NOT NULL AND area_id IS NOT NULL AND capacity_u IS NOT NULL)
      )) OR (type <> 'RACK' AND rack_role IS NULL AND parent_rack_id IS NULL))`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_mount"
      CHECK ((rack_id IS NULL AND mount_mode IS NULL AND start_u IS NULL AND height_u IS NULL) OR
        (rack_id IS NOT NULL AND (
          (mount_mode IS NULL AND start_u IS NULL AND height_u IS NULL) OR
          (mount_mode = 'U' AND height_u >= 1 AND (start_u IS NULL OR start_u >= 1)) OR
          (mount_mode = 'ZERO_U' AND type = 'PDU' AND start_u IS NULL AND height_u = 0)
        )))`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "FK_project_devices_parent_rack_project"
      FOREIGN KEY (project_id,parent_rack_id) REFERENCES project_devices(project_id,id) ON DELETE RESTRICT`);
    await q.query('CREATE INDEX "IDX_project_devices_project_parent_rack" ON project_devices(project_id,parent_rack_id)');
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "EX_project_devices_rack_u_overlap"
      EXCLUDE USING gist (rack_id WITH =,
        int8range(start_u::bigint, start_u::bigint + height_u::bigint, '[)') WITH &&)
      WHERE (mount_mode = 'U' AND start_u IS NOT NULL)`);
    await q.query(`CREATE TABLE rack_served_areas (
      project_id uuid NOT NULL, rack_id uuid NOT NULL, area_id uuid NOT NULL,
      CONSTRAINT "PK_rack_served_areas" PRIMARY KEY (project_id,rack_id,area_id),
      CONSTRAINT "FK_rack_served_areas_rack_project" FOREIGN KEY (project_id,rack_id)
        REFERENCES project_devices(project_id,id) ON DELETE RESTRICT,
      CONSTRAINT "FK_rack_served_areas_area_project" FOREIGN KEY (project_id,area_id)
        REFERENCES project_areas(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query('CREATE INDEX "IDX_rack_served_areas_project_area" ON rack_served_areas(project_id,area_id)');
    await q.query(`CREATE FUNCTION assert_rack_layout_project(project_uuid uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM project_devices r WHERE r.project_id = project_uuid AND r.type = 'RACK'
            AND r.rack_role IS NOT NULL AND (
              r.area_id IS NULL OR r.capacity_u IS NULL OR
              NOT EXISTS (SELECT 1 FROM rack_served_areas s
                WHERE s.project_id = r.project_id AND s.rack_id = r.id) OR
              (r.rack_role = 'SUB' AND NOT EXISTS (
                SELECT 1 FROM project_devices p WHERE p.project_id = r.project_id
                  AND p.id = r.parent_rack_id AND p.type = 'RACK' AND p.rack_role = 'MAIN'
              ))
            )
        ) THEN RAISE EXCEPTION 'Configured rack requires placement, capacity, served area and valid MAIN parent'
          USING ERRCODE = '23514'; END IF;
        IF EXISTS (
          SELECT 1 FROM project_devices d JOIN project_devices r
            ON r.project_id = d.project_id AND r.id = d.rack_id
          WHERE d.project_id = project_uuid AND d.mount_mode = 'U' AND d.start_u IS NOT NULL
            AND (r.type <> 'RACK' OR r.capacity_u IS NULL OR
              d.start_u::bigint + d.height_u::bigint - 1 > r.capacity_u)
        ) THEN RAISE EXCEPTION 'Rack placement exceeds capacity' USING ERRCODE = '23514'; END IF;
      END $$`);
    await q.query(`CREATE FUNCTION check_rack_layout_project()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM assert_rack_layout_project(OLD.project_id); END IF;
        IF TG_OP IN ('UPDATE','INSERT') THEN PERFORM assert_rack_layout_project(NEW.project_id); END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_rack_layout_devices
      AFTER INSERT OR UPDATE OR DELETE ON project_devices
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_rack_layout_project()`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_rack_layout_served
      AFTER INSERT OR UPDATE OR DELETE ON rack_served_areas
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_rack_layout_project()`);
  }

  async down(q: QueryRunner): Promise<void> {
    const changed = await q.query(`SELECT 1 FROM project_devices
      WHERE type::text IN ('UPS','PDU','NVR','ROUTER','ODF','CABLE_MANAGER','SHELF')
        OR rack_role IS NOT NULL OR mount_mode IS NOT NULL OR parent_rack_id IS NOT NULL
        OR start_u IS NOT NULL OR height_u IS NOT NULL LIMIT 1`);
    const served = await q.query('SELECT 1 FROM rack_served_areas LIMIT 1');
    if (changed.length || served.length) throw new Error('Rack layout contains data; refusing destructive down migration');
    await q.query('DROP TRIGGER check_rack_layout_served ON rack_served_areas');
    await q.query('DROP TRIGGER check_rack_layout_devices ON project_devices');
    await q.query('DROP FUNCTION check_rack_layout_project()');
    await q.query('DROP FUNCTION assert_rack_layout_project(uuid)');
    await q.query('DROP TABLE rack_served_areas');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "EX_project_devices_rack_u_overlap"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "FK_project_devices_parent_rack_project"');
    await q.query('DROP INDEX "IDX_project_devices_project_parent_rack"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_mount"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_rack_role"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_location"');
    await q.query('ALTER TABLE project_devices DROP CONSTRAINT "CHK_project_devices_capacity"');
    await q.query('ALTER TABLE project_devices DROP COLUMN height_u, DROP COLUMN start_u, DROP COLUMN mount_mode, DROP COLUMN parent_rack_id, DROP COLUMN rack_role');
    await q.query('DROP TYPE mount_mode_enum');
    await q.query('DROP TYPE rack_role_enum');
    await q.query('ALTER TYPE device_type_enum RENAME TO device_type_enum_new');
    await q.query(`CREATE TYPE device_type_enum AS ENUM (${oldTypes})`);
    await q.query('ALTER TABLE project_devices ALTER COLUMN type TYPE device_type_enum USING type::text::device_type_enum');
    await q.query('DROP TYPE device_type_enum_new');
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_location"
      CHECK (rack_id IS NULL OR (area_id IS NULL AND type IN ('SWITCH','PATCH_PANEL') AND rack_id <> id))`);
    await q.query(`ALTER TABLE project_devices ADD CONSTRAINT "CHK_project_devices_capacity"
      CHECK (capacity_u IS NULL OR (type = 'RACK' AND capacity_u >= 1))`);
  }
}
