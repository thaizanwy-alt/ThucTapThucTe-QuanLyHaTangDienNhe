import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1790000000000 implements MigrationInterface {
  name = 'CreateUsers1790000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(320) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "role" varchar(16) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('MANAGER', 'TECHNICIAN'))
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "users"');
  }
}
