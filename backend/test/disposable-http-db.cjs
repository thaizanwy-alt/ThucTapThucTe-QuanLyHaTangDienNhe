const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource } = require('../dist/database/data-source.js');
const ownedDatabases = new Map();

async function cleanupDeadline(work, ms, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Cleanup unconfirmed: ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}

// TypeORM 0.3.31 sets isInitialized only AFTER PostgresDriver.connect().
// disconnect() also releases bootstrap runners and awaits pg Pool.end().
// Call only for DataSources created/owned by the test, never the shared source.
async function closeOwnedDataSource(database) {
  assert.notEqual(database, dataSource, 'cannot close the application DataSource');
  if (database.isInitialized) await database.destroy();
  else if (database.driver?.master) await database.driver.disconnect();
}

async function cleanupTestRunner(runner, failure, pending) {
  const errors = [];
  let rollbackFailure, rollbackWork, closed = true;
  // Observe rejection even if closing the lock holder fails before we await it.
  if (pending) void pending.catch(() => {});
  try { if (runner.isTransactionActive) {
    rollbackWork = Promise.resolve().then(() => runner.rollbackTransaction());
    await cleanupDeadline(rollbackWork, 3000, 'rollback acknowledgement');
  } }
  catch (error) { rollbackFailure = error; errors.push(error); }
  if (rollbackFailure && runner.databaseConnection) {
    closed = false;
    try {
      const name = runner.connection?.options.database;
      const ownership = ownedDatabases.get(name);
      assert.ok(ownership, 'discard requires an owned disposable database');
      assert.notEqual(runner.connection, dataSource);
      await ownership.verify();
      const client = runner.databaseConnection;
      assert.equal(client.connectionParameters.database, name);
      // Public pg.Client.end() first, then public QueryRunner.release(). In pg
      // 8.23.0 the ended/_ending client is removed, never returned as idle.
      // Observe socket AND Client lifecycle before releasing the waiter.
      const socket = client.connection.stream;
      const ended = client._ended ? Promise.resolve() : new Promise(resolve => client.once('end', resolve));
      const socketClosed = socket.closed ? Promise.resolve() : new Promise(resolve => socket.once('close', resolve));
      const ending = Promise.resolve().then(() => client.end());
      try { await cleanupDeadline(Promise.all([ending, ended, socketClosed]), 3000, 'owned pg client close'); }
      catch (error) {
        socket.destroy(); // Only this verified harness-owned socket, no PID signaling.
        await cleanupDeadline(Promise.all([ending, ended, socketClosed]), 3000, 'forced owned pg client close');
        errors.push(error);
      }
      await runner.release();
      await ownership.sessionGone(client.processID);
      // A SQL rollback timed out above must also settle after socket closure.
      if (rollbackWork) await cleanupDeadline(Promise.allSettled([rollbackWork]), 3000, 'rollback query settlement');
      closed = true;
    } catch (error) { errors.push(error); }
  } else {
    try { await runner.release(); } catch (error) { errors.push(error); closed = false; }
  }
  // A timeout is reported as unconfirmed cleanup, never as a settled request.
  if (pending && closed) {
    try { await cleanupDeadline(pending, 15000, 'pending request settlement'); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors,
    'Test runner cleanup failed', { cause: failure ?? errors[0] });
}

async function withDisposableHttpDb(prefix, action) {
  assert.match(prefix, /^[a-z]+$/);
  const name = `${prefix}_test_${randomUUID().replaceAll('-', '')}`;
  const options = dataSource.options;
  assert.notEqual(name, options.database);
  assert.equal(options.synchronize, false);
  assert.ok(!options.dropSchema && !options.migrationsRun, 'initialization must not perform DDL before verification');
  assert.equal(options.installExtensions, false, 'extension DDL must wait for verified migrations');
  const config = { host: options.host, port: options.port, user: options.username, password: options.password };
  const control = new Client({ ...config, database: options.database, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, lock_timeout: 5000 });
  const database = new DataSource({ ...options, database: name });
  const previous = process.env.DB_NAME;
  const marker = `elv-disposable:${randomUUID()}`;
  let created = false, marked = false, owner, oid, result, failure;
  const assertTarget = () => {
    assert.equal(created, true, 'test must create the database before DDL');
    assert.match(name, /^[a-z]+_test_[0-9a-f]{32}$/);
    assert.notEqual(name, options.database);
  };
  const catalog = async () => (await control.query(`SELECT datname AS name, oid::text AS oid,
    pg_get_userbyid(datdba) AS owner, shobj_description(oid, 'pg_database') AS marker
    FROM pg_database WHERE datname=$1`, [name])).rows[0];
  const verifyCatalog = async () => {
    assertTarget();
    assert.equal(marked, true, `Ownership marker not established; retaining ${name}`);
    const row = await catalog();
    assert.equal(row?.name, name);
    assert.equal(row?.oid, oid, 'database was replaced');
    assert.equal(row?.owner, owner);
    assert.equal(row?.marker, marker);
  };
  const verify = async (connection = database) => {
    assertTarget();
    assert.equal(marked, true);
    assert.equal(database.options.database, name);
    const rows = await connection.query(`SELECT current_database() AS name, current_user AS actor,
      oid::text AS oid, pg_get_userbyid(datdba) AS owner,
      shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname=current_database()`);
    assert.equal(rows[0]?.name, name, 'connected database is not the owned disposable database');
    assert.equal(rows[0]?.actor, owner);
    assert.equal(rows[0]?.owner, owner);
    assert.equal(rows[0]?.oid, oid);
    assert.equal(rows[0]?.marker, marker);
  };
  try {
    await control.connect();
    const identity = (await control.query('SELECT current_database() AS name, current_user AS actor')).rows[0];
    assert.equal(identity.name, options.database);
    owner = identity.actor;
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    created = true;
    const initial = await catalog();
    assert.equal(initial?.name, name);
    assert.equal(initial?.owner, owner);
    assert.equal(initial?.marker, null);
    oid = initial.oid;
    await control.query(`COMMENT ON DATABASE "${name}" IS '${marker}'`);
    marked = true;
    await verifyCatalog();
    ownedDatabases.set(name, { verify: verifyCatalog, sessionGone: async pid => {
      const end = Date.now() + 3000;
      do {
        const row = (await control.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datid=$1 AND pid=$2) AS alive', [oid, pid])).rows[0];
        if (!row.alive) return;
        await new Promise(resolve => setImmediate(resolve));
      } while (Date.now() < end);
      throw new Error('Cleanup unconfirmed: owned lock-holder session remains');
    } });
    await database.initialize();
    await verify();
    await database.runMigrations();
    await verify();
    process.env.DB_NAME = name;
    result = await action(database, verify);
  } catch (error) {
    failure = error;
  } finally {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
    const cleanupErrors = [];
    try {
      await closeOwnedDataSource(database);
      if (created) {
        await verifyCatalog();
        const active = (await control.query('SELECT count(*)::integer AS sessions FROM pg_stat_activity WHERE datid=$1', [oid])).rows[0];
        assert.equal(active.sessions, 0, `Sessions remain; retaining ${name}`);
        await control.query(`DROP DATABASE "${name}"`);
      }
    } catch (error) { cleanupErrors.push(error); }
    finally {
      try { await control.end(); } catch (error) { cleanupErrors.push(error); }
      ownedDatabases.delete(name);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors,
        `Disposable database cleanup unconfirmed: ${name}`, { cause: failure ?? cleanupErrors[0] });
    }
  }
  if (failure) throw failure;
  return result;
}

module.exports = { withDisposableHttpDb, closeOwnedDataSource, cleanupTestRunner };
