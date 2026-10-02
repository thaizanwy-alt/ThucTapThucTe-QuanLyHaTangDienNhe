import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectStructure1791000000000 implements MigrationInterface {
  name = 'CreateProjectStructure1791000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "project_status_enum" AS ENUM ('PLANNING', 'IN_PROGRESS', 'WAITING_ACCEPTANCE', 'COMPLETED')`);
    await queryRunner.query(`CREATE TYPE "area_type_enum" AS ENUM ('FLOOR', 'ROOM')`);
    await queryRunner.query(`CREATE TYPE "system_category_enum" AS ENUM ('LAN', 'WIFI', 'CAMERA')`);

    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "address" text,
        "status" "project_status_enum" NOT NULL DEFAULT 'PLANNING',
        "description" text,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_projects_code" ON "projects" ("code")');
    await queryRunner.query('CREATE INDEX "IDX_projects_status" ON "projects" ("status")');

    await queryRunner.query(`
      CREATE TABLE "project_areas" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "parent_id" uuid,
        "type" "area_type_enum" NOT NULL,
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_project_areas_sort_order" CHECK ("sort_order" >= 0),
        CONSTRAINT "FK_project_areas_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_areas_parent" FOREIGN KEY ("parent_id") REFERENCES "project_areas"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_areas_project_code" ON "project_areas" ("project_id", "code")');
    await queryRunner.query('CREATE INDEX "IDX_project_areas_tree_order" ON "project_areas" ("project_id", "parent_id", "sort_order")');

    await queryRunner.query(`
      CREATE TABLE "project_systems" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "category" "system_category_enum" NOT NULL,
        "description" text,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_project_systems_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_systems_project_code" ON "project_systems" ("project_id", "code")');
    await queryRunner.query('CREATE INDEX "IDX_project_systems_project_category" ON "project_systems" ("project_id", "category")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "project_systems"');
    await queryRunner.query('DROP TABLE "project_areas"');
    await queryRunner.query('DROP TABLE "projects"');
    await queryRunner.query('DROP TYPE "system_category_enum"');
    await queryRunner.query('DROP TYPE "area_type_enum"');
    await queryRunner.query('DROP TYPE "project_status_enum"');
  }
}
