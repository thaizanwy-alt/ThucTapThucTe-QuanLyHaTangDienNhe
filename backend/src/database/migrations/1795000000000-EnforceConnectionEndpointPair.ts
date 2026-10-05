import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceConnectionEndpointPair1795000000000 implements MigrationInterface {
  name = 'EnforceConnectionEndpointPair1795000000000';

  async up(q: QueryRunner): Promise<void> {
    // Do not repair or discard existing data: a pre-existing incomplete connection blocks the migration.
    // Hold off concurrent writes between the audit and trigger installation.
    await q.query('LOCK TABLE physical_connections, connection_endpoints IN SHARE ROW EXCLUSIVE MODE');
    const invalid = await q.query(`
      SELECT c.id FROM physical_connections c
      LEFT JOIN connection_endpoints e ON e.connection_id = c.id
      GROUP BY c.id HAVING count(e.port_id) <> 2 LIMIT 1
    `);
    if (invalid.length) throw new Error('Cannot enforce endpoint pair: an existing connection does not have exactly two endpoints');

    await q.query(`CREATE FUNCTION assert_physical_connection_endpoint_pair(connection_uuid uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE endpoint_count integer;
      BEGIN
        -- Serialize checks of the same connection, including concurrent direct SQL writes.
        PERFORM 1 FROM physical_connections WHERE id = connection_uuid FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT count(*) INTO endpoint_count FROM connection_endpoints WHERE connection_id = connection_uuid;
        IF endpoint_count <> 2 THEN
          RAISE EXCEPTION 'A physical connection must have endpoints A and B' USING ERRCODE = '23514';
        END IF;
      END $$`);
    await q.query(`CREATE FUNCTION check_physical_connection_endpoint_pair()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'physical_connections' THEN
          IF TG_OP = 'UPDATE' AND OLD.id <> NEW.id THEN
            PERFORM assert_physical_connection_endpoint_pair(OLD.id);
          END IF;
          PERFORM assert_physical_connection_endpoint_pair(NEW.id);
        ELSE
          IF TG_OP IN ('UPDATE', 'DELETE') THEN
            PERFORM assert_physical_connection_endpoint_pair(OLD.connection_id);
          END IF;
          IF TG_OP = 'INSERT' THEN
            PERFORM assert_physical_connection_endpoint_pair(NEW.connection_id);
          ELSIF TG_OP = 'UPDATE' AND OLD.connection_id <> NEW.connection_id THEN
            PERFORM assert_physical_connection_endpoint_pair(NEW.connection_id);
          END IF;
        END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_physical_connection_endpoint_pair_parent
      AFTER INSERT OR UPDATE ON physical_connections
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION check_physical_connection_endpoint_pair()`);
    await q.query(`CREATE CONSTRAINT TRIGGER check_physical_connection_endpoint_pair_child
      AFTER INSERT OR UPDATE OR DELETE ON connection_endpoints
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION check_physical_connection_endpoint_pair()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER check_physical_connection_endpoint_pair_child ON connection_endpoints');
    await q.query('DROP TRIGGER check_physical_connection_endpoint_pair_parent ON physical_connections');
    await q.query('DROP FUNCTION check_physical_connection_endpoint_pair()');
    await q.query('DROP FUNCTION assert_physical_connection_endpoint_pair(uuid)');
  }
}
