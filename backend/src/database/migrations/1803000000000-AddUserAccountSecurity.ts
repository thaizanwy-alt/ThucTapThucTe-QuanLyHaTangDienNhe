import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAccountSecurity1803000000000 implements MigrationInterface {
  name = 'AddUserAccountSecurity1803000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "users" GROUP BY lower("email") HAVING count(*) > 1
        ) THEN
          RAISE EXCEPTION 'Cannot add case-insensitive email uniqueness: duplicate accounts exist'
            USING ERRCODE = '23505';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false,
        ADD COLUMN "auth_version" integer NOT NULL DEFAULT 0,
        ADD COLUMN "version" integer NOT NULL DEFAULT 1,
        ADD CONSTRAINT "CHK_users_auth_version" CHECK ("auth_version" >= 0),
        ADD CONSTRAINT "CHK_users_version" CHECK ("version" >= 1)
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_users_email_lower" ON "users" (lower("email"))');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_users_email_lower"');
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "CHK_users_version",
        DROP CONSTRAINT "CHK_users_auth_version",
        DROP COLUMN "version",
        DROP COLUMN "auth_version",
        DROP COLUMN "must_change_password"
    `);
  }
}
