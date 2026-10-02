import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectTasks1792000000000 implements MigrationInterface {
  name = 'CreateProjectTasks1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_systems_project_id_id" ON "project_systems" ("project_id", "id")');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_areas_project_id_id" ON "project_areas" ("project_id", "id")');
    await queryRunner.query(`CREATE TYPE "task_status_enum" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED')`);
    await queryRunner.query(`
      CREATE TABLE "project_tasks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "system_id" uuid NOT NULL,
        "area_id" uuid,
        "assignee_id" uuid NOT NULL,
        "code" varchar NOT NULL,
        "title" varchar NOT NULL,
        "description" text,
        "status" "task_status_enum" NOT NULL DEFAULT 'ASSIGNED',
        "completion_note" text,
        "return_reason" text,
        "submitted_at" timestamptz,
        "reviewed_by_id" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CHK_project_tasks_code" CHECK ("code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
        CONSTRAINT "CHK_project_tasks_completion_note" CHECK ("status" NOT IN ('SUBMITTED', 'APPROVED') OR ("completion_note" IS NOT NULL AND length(btrim("completion_note")) > 0)),
        CONSTRAINT "CHK_project_tasks_return_reason" CHECK ("status" <> 'RETURNED' OR ("return_reason" IS NOT NULL AND length(btrim("return_reason")) > 0)),
        CONSTRAINT "FK_project_tasks_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_tasks_system_project" FOREIGN KEY ("project_id", "system_id") REFERENCES "project_systems"("project_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_tasks_area_project" FOREIGN KEY ("project_id", "area_id") REFERENCES "project_areas"("project_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_tasks_assignee" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_project_tasks_reviewer" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_project_tasks_project_code" ON "project_tasks" ("project_id", "code")');
    await queryRunner.query('CREATE INDEX "IDX_project_tasks_project_status" ON "project_tasks" ("project_id", "status")');
    await queryRunner.query('CREATE INDEX "IDX_project_tasks_assignee_status_updated" ON "project_tasks" ("assignee_id", "status", "updated_at")');
    await queryRunner.query('CREATE INDEX "IDX_project_tasks_project_system" ON "project_tasks" ("project_id", "system_id")');
    await queryRunner.query('CREATE INDEX "IDX_project_tasks_project_area" ON "project_tasks" ("project_id", "area_id")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "project_tasks"');
    await queryRunner.query('DROP TYPE "task_status_enum"');
    await queryRunner.query('DROP INDEX "UQ_project_areas_project_id_id"');
    await queryRunner.query('DROP INDEX "UQ_project_systems_project_id_id"');
  }
}
