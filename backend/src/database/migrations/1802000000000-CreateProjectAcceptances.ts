import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectAcceptances1802000000000 implements MigrationInterface {
  name = 'CreateProjectAcceptances1802000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE acceptance_status_enum AS ENUM ('DRAFT','CONFIRMED')`);
    await q.query(`ALTER TABLE evidence_attachments ADD CONSTRAINT "UQ_acceptance_evidence_project_id" UNIQUE(project_id,id)`);
    await q.query(`CREATE TABLE project_acceptances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      system_id uuid NOT NULL, code varchar(100) NOT NULL CHECK(code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
      title varchar(255) NOT NULL CHECK(length(btrim(title)) > 0), note text CHECK(note IS NULL OR length(note) <= 2000),
      status acceptance_status_enum NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, confirmed_at timestamptz,
      replaces_id uuid, replacement_reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_acceptances_project_code" UNIQUE(project_id,code),
      CONSTRAINT "UQ_acceptances_project_id" UNIQUE(project_id,id),
      CONSTRAINT "UQ_acceptances_project_system_id" UNIQUE(project_id,system_id,id),
      FOREIGN KEY(project_id,system_id) REFERENCES project_systems(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,system_id,replaces_id) REFERENCES project_acceptances(project_id,system_id,id) ON DELETE RESTRICT,
      CHECK(replaces_id IS NULL OR replaces_id <> id),
      CHECK((replaces_id IS NULL AND replacement_reason IS NULL) OR
        (replaces_id IS NOT NULL AND replacement_reason IS NOT NULL AND length(btrim(replacement_reason)) BETWEEN 1 AND 2000)),
      CHECK((status = 'DRAFT' AND confirmed_by_id IS NULL AND confirmed_at IS NULL) OR
        (status = 'CONFIRMED' AND confirmed_by_id IS NOT NULL AND confirmed_at IS NOT NULL))
    )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_acceptances_confirmed_replacement" ON project_acceptances(replaces_id) WHERE status = 'CONFIRMED' AND replaces_id IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_acceptances_project_system_status" ON project_acceptances(project_id,system_id,status,created_at)`);
    await q.query(`CREATE TABLE acceptance_inspections (
      project_id uuid NOT NULL, acceptance_id uuid NOT NULL, inspection_id uuid NOT NULL, PRIMARY KEY(acceptance_id,inspection_id),
      FOREIGN KEY(project_id,acceptance_id) REFERENCES project_acceptances(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,inspection_id) REFERENCES project_inspections(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE TABLE acceptance_evidence (
      project_id uuid NOT NULL, acceptance_id uuid NOT NULL, evidence_id uuid NOT NULL, pinned_storage_key varchar,
      PRIMARY KEY(acceptance_id,evidence_id),
      FOREIGN KEY(project_id,acceptance_id) REFERENCES project_acceptances(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,evidence_id) REFERENCES evidence_attachments(project_id,id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE INDEX "IDX_acceptance_evidence_source" ON acceptance_evidence(evidence_id)`);
    await q.query(`CREATE TABLE acceptance_snapshots (
      acceptance_id uuid PRIMARY KEY, project_id uuid NOT NULL, schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version = 1),
      source_fingerprint varchar(64) NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'), content jsonb NOT NULL CHECK(jsonb_typeof(content) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(project_id,acceptance_id) REFERENCES project_acceptances(project_id,id) ON DELETE RESTRICT
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['acceptance_snapshots', 'acceptance_evidence', 'acceptance_inspections', 'project_acceptances']) await q.query(`DROP TABLE ${table}`);
    await q.query(`ALTER TABLE evidence_attachments DROP CONSTRAINT "UQ_acceptance_evidence_project_id"`);
    await q.query('DROP TYPE acceptance_status_enum');
  }
}
