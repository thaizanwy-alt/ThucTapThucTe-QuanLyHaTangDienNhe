import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectDevices1793000000000 implements MigrationInterface {
  name = 'CreateProjectDevices1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "device_type_enum" AS ENUM ('RACK', 'PATCH_PANEL', 'SWITCH', 'NETWORK_OUTLET', 'AP', 'CAMERA')`);
    await queryRunner.query(`
      CREATE TABLE "project_devices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "type" "device_type_enum" NOT NULL,
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "brand" varchar,
        "model" varchar,
        "serial_number" varchar,
        "description" text,
        "location_note" text,
        "area_id" uuid,
        "rack_id" uuid,
        "capacity_u" integer,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_project_devices_code" CHECK ("code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
        CONSTRAINT "CHK_project_devices_name" CHECK (length(btrim("name")) > 0),
        CONSTRAINT "CHK_project_devices_location" CHECK ("rack_id" IS NULL OR ("area_id" IS NULL AND "type" IN ('SWITCH', 'PATCH_PANEL') AND "rack_id" <> "id")),
        CONSTRAINT "CHK_project_devices_capacity" CHECK ("capacity_u" IS NULL OR ("type" = 'RACK' AND "capacity_u" >= 1)),
        CONSTRAINT "FK_project_devices_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_devices_area_project" FOREIGN KEY ("project_id", "area_id") REFERENCES "project_areas"("project_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_devices_project_code" ON "project_devices" ("project_id", "code")');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_devices_project_id_id" ON "project_devices" ("project_id", "id")');
    await queryRunner.query(`ALTER TABLE "project_devices" ADD CONSTRAINT "FK_project_devices_rack_project" FOREIGN KEY ("project_id", "rack_id") REFERENCES "project_devices"("project_id", "id") ON DELETE RESTRICT`);
    await queryRunner.query('CREATE INDEX "IDX_project_devices_project_type" ON "project_devices" ("project_id", "type")');
    await queryRunner.query('CREATE INDEX "IDX_project_devices_project_area" ON "project_devices" ("project_id", "area_id")');
    await queryRunner.query('CREATE INDEX "IDX_project_devices_project_rack" ON "project_devices" ("project_id", "rack_id")');
    await queryRunner.query(`
      CREATE TABLE "project_device_systems" (
        "project_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "system_id" uuid NOT NULL,
        PRIMARY KEY ("project_id", "device_id", "system_id"),
        CONSTRAINT "FK_project_device_systems_device_project" FOREIGN KEY ("project_id", "device_id") REFERENCES "project_devices"("project_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_device_systems_system_project" FOREIGN KEY ("project_id", "system_id") REFERENCES "project_systems"("project_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_project_device_systems_project_system" ON "project_device_systems" ("project_id", "system_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "project_device_systems"');
    await queryRunner.query('DROP TABLE "project_devices"');
    await queryRunner.query('DROP TYPE "device_type_enum"');
  }
}
