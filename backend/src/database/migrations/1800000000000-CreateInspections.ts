import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInspections1800000000000 implements MigrationInterface {
  name = 'CreateInspections1800000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE inspection_result_enum AS ENUM ('NOT_CHECKED','PASS','FAIL')`);
    await q.query(`CREATE TYPE issue_status_enum AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')`);
    await q.query(`CREATE TABLE checklist_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar NOT NULL, name varchar NOT NULL,
      category system_category_enum NOT NULL, revision integer NOT NULL CHECK(revision >= 1),
      is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_checklist_templates_code_revision" UNIQUE(code,revision),
      UNIQUE(id,revision), CHECK(code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'), CHECK(length(btrim(name)) > 0)
    )`);
    await q.query(`CREATE TABLE checklist_template_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE RESTRICT,
      code varchar NOT NULL CHECK(code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'), title varchar NOT NULL CHECK(length(btrim(title)) > 0),
      instruction text, sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
      CONSTRAINT "UQ_checklist_template_items_code" UNIQUE(template_id,code)
    )`);
    await q.query(`CREATE TABLE project_inspections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      system_id uuid NOT NULL, area_id uuid, device_id uuid,
      code varchar NOT NULL CHECK(code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'), title varchar NOT NULL CHECK(length(btrim(title)) > 0),
      template_id uuid NOT NULL, template_revision integer NOT NULL CHECK(template_revision >= 1),
      created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_project_inspections_project_code" UNIQUE(project_id,code),
      CONSTRAINT "UQ_project_inspections_project_id" UNIQUE(project_id,id),
      CHECK(area_id IS NULL OR device_id IS NULL),
      FOREIGN KEY(project_id,system_id) REFERENCES project_systems(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,area_id) REFERENCES project_areas(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,device_id) REFERENCES project_devices(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(template_id,template_revision) REFERENCES checklist_templates(id,revision) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE INDEX "IDX_project_inspections_system_created" ON project_inspections(project_id,system_id,created_at)`);
    await q.query(`CREATE TABLE inspection_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, inspection_id uuid NOT NULL,
      code varchar NOT NULL CHECK(code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'), title varchar NOT NULL CHECK(length(btrim(title)) > 0), instruction text,
      sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order >= 0), result inspection_result_enum NOT NULL DEFAULT 'NOT_CHECKED',
      note text, checked_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, checked_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
      CONSTRAINT "UQ_inspection_items_code" UNIQUE(inspection_id,code),
      CONSTRAINT "UQ_inspection_items_project_id" UNIQUE(project_id,id),
      CHECK((checked_by_id IS NULL) = (checked_at IS NULL)),
      FOREIGN KEY(project_id,inspection_id) REFERENCES project_inspections(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE TABLE remediation_issues (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, item_id uuid NOT NULL,
      description text NOT NULL CHECK(length(btrim(description)) > 0), assignee_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status issue_status_enum NOT NULL DEFAULT 'OPEN', resolution_note text, resolved_at timestamptz, return_reason text,
      reviewed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, reviewed_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(status NOT IN ('RESOLVED','CLOSED') OR (resolution_note IS NOT NULL AND length(btrim(resolution_note)) > 0 AND resolved_at IS NOT NULL)),
      CHECK(status <> 'CLOSED' OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL)),
      CHECK((reviewed_by_id IS NULL) = (reviewed_at IS NULL)),
      FOREIGN KEY(project_id,item_id) REFERENCES inspection_items(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_remediation_issues_open_item" ON remediation_issues(item_id) WHERE status <> 'CLOSED'`);
    await q.query(`CREATE INDEX "IDX_remediation_issues_project_status" ON remediation_issues(project_id,status)`);
    await q.query(`CREATE INDEX "IDX_remediation_issues_assignee_status" ON remediation_issues(assignee_id,status)`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of ['remediation_issues', 'inspection_items', 'project_inspections', 'checklist_template_items', 'checklist_templates']) {
      await q.query(`DROP TABLE ${table}`);
    }
    await q.query('DROP TYPE issue_status_enum');
    await q.query('DROP TYPE inspection_result_enum');
  }
}
