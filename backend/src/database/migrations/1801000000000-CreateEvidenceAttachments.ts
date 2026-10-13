import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvidenceAttachments1801000000000 implements MigrationInterface {
  name = 'CreateEvidenceAttachments1801000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE project_tasks ADD CONSTRAINT "UQ_evidence_tasks_project_id" UNIQUE(project_id,id)');
    await q.query('ALTER TABLE remediation_issues ADD CONSTRAINT "UQ_evidence_issues_project_id" UNIQUE(project_id,id)');
    await q.query(`CREATE TABLE evidence_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      task_id uuid, inspection_item_id uuid, issue_id uuid,
      storage_key varchar NOT NULL UNIQUE, original_name varchar(255) NOT NULL CHECK(length(btrim(original_name)) > 0),
      mime_type varchar NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
      size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
      sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
      uploaded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
      caption text CHECK(caption IS NULL OR length(caption) <= 1000), version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
      idempotency_key varchar(128) NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
      fingerprint varchar(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
      deleted_at timestamptz, deleted_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, delete_reason text,
      CHECK(num_nonnulls(task_id,inspection_item_id,issue_id) = 1),
      CHECK((deleted_at IS NULL AND deleted_by_id IS NULL AND delete_reason IS NULL) OR
        (deleted_at IS NOT NULL AND deleted_by_id IS NOT NULL AND delete_reason IS NOT NULL AND length(btrim(delete_reason)) BETWEEN 1 AND 1000)),
      CONSTRAINT "UQ_evidence_idempotency" UNIQUE(project_id,uploaded_by_id,idempotency_key),
      FOREIGN KEY(project_id,task_id) REFERENCES project_tasks(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,inspection_item_id) REFERENCES inspection_items(project_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(project_id,issue_id) REFERENCES remediation_issues(project_id,id) ON DELETE RESTRICT
    )`);
    for (const target of ['task_id','inspection_item_id','issue_id']) {
      await q.query(`CREATE INDEX "IDX_evidence_${target}" ON evidence_attachments(project_id,${target},created_at) WHERE deleted_at IS NULL`);
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE evidence_attachments');
    await q.query('ALTER TABLE remediation_issues DROP CONSTRAINT "UQ_evidence_issues_project_id"');
    await q.query('ALTER TABLE project_tasks DROP CONSTRAINT "UQ_evidence_tasks_project_id"');
  }
}
