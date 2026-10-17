const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource } = require('../dist/database/data-source.js');

async function withDisposableHttpDb(prefix, action) {
  assert.match(prefix, /^[a-z]+$/);
  const name = `${prefix}_test_${randomUUID().replaceAll('-', '')}`;
  const options = dataSource.options;
  assert.notEqual(name, options.database);
  const config = { host: options.host, port: options.port, user: options.username, password: options.password };
  const control = new Client({ ...config, database: options.database });
  const database = new DataSource({ ...options, database: name });
  const previous = process.env.DB_NAME;
  let created = false;
  const verify = async () => {
    assert.equal(created, true, 'test must create the database before DDL');
    assert.match(name, /^[a-z]+_test_[0-9a-f]{32}$/);
    assert.notEqual(name, options.database);
    const rows = await database.query(`SELECT current_database() AS name, current_user AS actor,
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner`);
    assert.equal(rows[0].name, name);
    assert.equal(rows[0].actor, rows[0].owner);
    assert.equal(database.options.database, name);
  };
  try {
    await control.connect();
    const identity = (await control.query('SELECT current_database() AS name')).rows[0];
    assert.equal(identity.name, options.database);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    created = true;
    await database.initialize();
    await verify();
    assert.equal(database.options.synchronize, false);
    await database.runMigrations();
    await verify();
    process.env.DB_NAME = name;
    return await action(database);
  } finally {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
    if (database.isInitialized) await database.destroy();
    if (created) {
      assert.match(name, /^[a-z]+_test_[0-9a-f]{32}$/);
      assert.notEqual(name, options.database);
      const record = (await control.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [name])).rows[0];
      assert.equal(record?.owner, (await control.query('SELECT current_user AS actor')).rows[0].actor);
      await control.query(`DROP DATABASE "${name}"`);
    }
    await control.end();
  }
}

module.exports = { withDisposableHttpDb };
