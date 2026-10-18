// Guard/cleanup regression: all PostgreSQL and TypeORM operations below are mocks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

function harness(fault = {}) {
  const state = { events: [], owner: 'test-owner', oid: '42', marker: null, name: null, fault };
  const source = { options: { database: 'application_database_do_not_touch', synchronize: false, installExtensions: false } };
  const catalog = () => ({ name: state.name, owner: state.owner, oid: state.oid, marker: state.marker });
  class Client {
    constructor(options) { this.options = options; }
    async connect() { state.events.push('control.connect'); if (fault.connect) throw fault.connect; }
    async query(sql, parameters) {
      if (sql.startsWith('SELECT current_database()')) return { rows: [{ name: this.options.database, actor: 'test-owner' }] };
      if (sql.startsWith('CREATE DATABASE')) {
        if (fault.create) throw fault.create;
        state.name = sql.match(/"([^"]+)"/)[1]; state.events.push('create'); return { rows: [] };
      }
      if (sql.includes('FROM pg_database WHERE datname=$1')) {
        assert.deepEqual(parameters, [state.name]); state.events.push('catalog'); return { rows: [catalog()] };
      }
      if (sql.startsWith('COMMENT ON DATABASE')) {
        if (fault.marker) throw fault.marker;
        state.marker = sql.match(/IS '([^']+)'/)[1]; state.events.push('mark'); return { rows: [] };
      }
      if (sql.includes('AS alive')) return { rows: [{ alive: (state.sessions ?? 0) > 0 }] };
      if (sql.includes('FROM pg_stat_activity')) return { rows: [{ sessions: state.sessions ?? fault.sessions ?? 0 }] };
      if (sql.startsWith('DROP DATABASE')) { state.events.push('drop'); if (fault.drop) throw fault.drop; return { rows: [] }; }
      throw new Error('Unexpected control query');
    }
    async end() { state.events.push('control.end'); if (fault.end) throw fault.end; }
  }
  class DataSource {
    constructor(options) {
      this.options = options; this.isInitialized = false;
      this.driver = { master: undefined, disconnect: async () => {
        state.events.push('driver.disconnect'); this.driver.master = undefined;
        state.sessions = 0;
      } };
    }
    async initialize() {
      if (fault.bootstrap) {
        state.events.push('pool.created'); this.driver.master = {}; state.sessions = 1;
        throw fault.bootstrap;
      }
      state.events.push('initialize'); this.isInitialized = true;
      if (fault.initialize) throw fault.initialize;
    }
    async query() {
      state.events.push('verify');
      return [{ ...catalog(), actor: 'test-owner', ...fault.connection }];
    }
    async runMigrations() { state.events.push('migrate'); if (fault.migration) throw fault.migration; }
    async destroy() {
      state.events.push('destroy');
      if (fault.destroy) throw fault.destroy;
      this.isInitialized = false;
    }
  }
  const filename = path.join(__dirname, 'disposable-http-db.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = module.paths;
  loaded.require = name => name === 'pg' ? { Client } : name === 'typeorm' ? { DataSource }
    : name === '../dist/database/data-source.js' ? { dataSource: source } : require(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { ...loaded.exports, state, source };
}

test('partial initialization closes the owned pool before DROP even with isInitialized=false (mock)', async () => {
  const original = new Error('Injected bootstrap failure before initialized flag');
  const { withDisposableHttpDb, state } = harness({ bootstrap: original });
  await assert.rejects(withDisposableHttpDb('guard', async () => assert.fail('must not run')), e => e === original);
  assert.equal(state.sessions, 0);
  assert.equal(state.events.includes('destroy'), false);
  assert.ok(state.events.indexOf('driver.disconnect') < state.events.indexOf('drop'));
  assert.equal(state.events.at(-1), 'control.end');
});

for (const phase of ['connect', 'start', 'assertion']) {
  test(`runner ${phase} failure discards ended client after rollback failure and retains original error (mock)`, async () => {
    const { withDisposableHttpDb, cleanupTestRunner, state } = harness();
    const original = new Error(`Injected ${phase} failure`), rollback = new Error('Injected rollback failure');
    const events = [];
    const socket = new EventEmitter(); socket.closed = false;
    const client = new EventEmitter();
    client.connection = { stream: socket };
    client.end = async () => {
      events.push('client.end'); client._ended = true; state.sessions = 0;
      socket.closed = true; socket.emit('close'); client.emit('end');
    };
    const runner = {
      databaseConnection: client,
      isTransactionActive: false,
      async connect() { events.push('connect'); this.isTransactionActive = true; if (phase === 'connect') throw original; },
      async startTransaction() { events.push('start'); if (phase === 'start') throw original; },
      async rollbackTransaction() { events.push('rollback'); throw rollback; },
      async release() { assert.equal(client._ended, true); assert.equal(socket.closed, true); events.push('discard'); },
    };
    let failure;
    await assert.rejects(withDisposableHttpDb('guard', async db => {
      runner.connection = db; client.connectionParameters = { database: db.options.database };
      state.sessions = 1;
      try { await runner.connect(); await runner.startTransaction(); throw original; }
      catch (error) { failure = error; throw error; }
      finally { await cleanupTestRunner(runner, failure, {
        catch() {},
        then(resolve) {
          assert.equal(client._ended, true);
          assert.equal(socket.closed, true);
          assert.equal(state.sessions, 0);
          events.push('pending'); resolve();
        },
      }); }
    }), e => e instanceof AggregateError && e.cause === original && e.errors[0] === original && e.errors[1] === rollback);
    assert.deepEqual(events.slice(-4), ['rollback', 'client.end', 'discard', 'pending']);
    assert.equal(state.events.includes('drop'), true);
  });
}

test('rollback failure cannot close a connection outside an owned disposable DB (mock)', async () => {
  const { cleanupTestRunner } = harness();
  const original=new Error('Original assertion'), rollback=new Error('Rollback failed');
  const events=[];
  await assert.rejects(cleanupTestRunner({
    connection:{options:{database:'application_database_do_not_touch'}},
    databaseConnection:{end:async()=>events.push('end')},
    isTransactionActive:true,
    rollbackTransaction:async()=>{throw rollback;},
    release:async()=>events.push('release'),
  },original), error=>error.cause===original && error.errors.includes(rollback)
    && error.errors.some(e=>/owned disposable/.test(e.message)));
  assert.deepEqual(events,[]);
});

test('disposable guard marks before migration, verifies callback connection, restores env and drops only its database', async () => {
  const { withDisposableHttpDb, state } = harness();
  const previous = process.env.DB_NAME;
  const value = await withDisposableHttpDb('guard', async (db, verify) => {
    await verify(db);
    assert.equal(process.env.DB_NAME, state.name);
    state.events.push('fixture');
    return 7;
  });
  assert.equal(value, 7);
  assert.equal(process.env.DB_NAME, previous);
  assert.match(state.name, /^guard_test_[0-9a-f]{32}$/);
  assert.match(state.marker, /^elv-disposable:/);
  for (const [first, second] of [['mark', 'initialize'], ['verify', 'migrate'], ['migrate', 'fixture'], ['fixture', 'destroy'], ['destroy', 'drop'], ['drop', 'control.end']]) {
    assert.ok(state.events.indexOf(first) < state.events.indexOf(second), `${first} before ${second}`);
  }
  assert.equal(state.events.filter(event => event === 'drop').length, 1);
});

for (const [label, connection] of [
  ['application database', { name: 'application_database_do_not_touch' }],
  ['different owner', { owner: 'other-owner' }],
  ['different marker', { marker: 'another-run' }],
  ['replaced database OID', { oid: '999' }],
]) {
  test(`wrong target (${label}) is rejected before migrations or fixture writes; no fallback`, async () => {
    const { withDisposableHttpDb, state } = harness({ connection });
    await assert.rejects(withDisposableHttpDb('guard', async () => { state.events.push('fixture-write'); }));
    assert.equal(state.events.includes('migrate'), false);
    assert.equal(state.events.includes('fixture-write'), false);
    assert.equal(state.events.includes('drop'), true, 'only the database created by this mock run is cleaned');
    assert.equal(state.events.at(-1), 'control.end');
  });
}

test('callback QueryRunner is verified before custom DDL', async () => {
  const { withDisposableHttpDb, state } = harness();
  await assert.rejects(withDisposableHttpDb('guard', async (_db, verify) => {
    await verify({ query: async () => [{ name: 'application_database_do_not_touch' }] });
    state.events.push('custom-ddl');
  }), /connected database/);
  assert.equal(state.events.includes('custom-ddl'), false);
  assert.equal(state.events.includes('drop'), true);
});

for (const phase of ['initialize', 'migration', 'fixture']) {
  test(`${phase} failure closes resources, cleans its marked DB and preserves the original error`, async () => {
    const original = new Error(`Injected ${phase} failure`);
    const { withDisposableHttpDb, state } = harness({ [phase]: original });
    const previous = process.env.DB_NAME;
    await assert.rejects(withDisposableHttpDb('guard', async () => { throw original; }), error => error === original);
    assert.equal(process.env.DB_NAME, previous);
    assert.equal(state.events.includes('destroy'), true);
    assert.equal(state.events.includes('drop'), true);
    assert.equal(state.events.at(-1), 'control.end');
  });
}

for (const field of ['name', 'owner', 'marker', 'oid']) {
  test(`cleanup refuses changed ${field} and still closes control; original test error is retained`, async () => {
    const original = new Error('Injected fixture failure');
    const { withDisposableHttpDb, state } = harness();
    await assert.rejects(withDisposableHttpDb('guard', async () => {
      state[field] = 'changed';
      throw original;
    }), error => error instanceof AggregateError && error.cause === original && error.errors[0] === original);
    assert.equal(state.events.includes('drop'), false);
    assert.equal(state.events.at(-1), 'control.end');
  });
}

test('cleanup refuses DROP while sessions remain and reports cleanup as unconfirmed', async () => {
  const { withDisposableHttpDb, state } = harness({ sessions: 1 });
  await assert.rejects(withDisposableHttpDb('guard', async () => {}), /cleanup unconfirmed/);
  assert.equal(state.events.includes('drop'), false);
  assert.equal(state.events.at(-1), 'control.end');
});

test('automatic schema operations are rejected before connecting or creating a database', async () => {
  for (const flag of ['synchronize', 'dropSchema', 'migrationsRun', 'installExtensions']) {
    const { withDisposableHttpDb, state, source } = harness();
    source.options[flag] = true;
    await assert.rejects(withDisposableHttpDb('guard', async () => {}));
    assert.deepEqual(state.events, []);
  }
});

test('pool close failure prevents DROP, closes control and preserves both errors', async () => {
  const original = new Error('Injected fixture failure');
  const closeFailure = new Error('Injected pool close failure');
  const { withDisposableHttpDb, state } = harness({ destroy: closeFailure });
  await assert.rejects(withDisposableHttpDb('guard', async () => { throw original; }),
    error => error.cause === original && error.errors[0] === original && error.errors[1] === closeFailure);
  assert.equal(state.events.includes('drop'), false);
  assert.equal(state.events.at(-1), 'control.end');
});

for (const phase of ['connect', 'create']) {
  test(`${phase} setup failure still closes control without migration, callback or DROP`, async () => {
    const original = new Error(`Injected ${phase} error`);
    const { withDisposableHttpDb, state } = harness({ [phase]: original });
    await assert.rejects(withDisposableHttpDb('guard', async () => { state.events.push('fixture'); }), e => e === original);
    for (const forbidden of ['migrate', 'fixture', 'drop']) assert.equal(state.events.includes(forbidden), false);
    assert.equal(state.events.at(-1), 'control.end');
  });
}

test('marker setup failure retains unclaimed database, closes control and preserves setup error', async () => {
  const original = new Error('Injected marker failure');
  const { withDisposableHttpDb, state } = harness({ marker: original });
  await assert.rejects(withDisposableHttpDb('guard', async () => {}), e => e.cause === original);
  assert.equal(state.events.includes('migrate'), false);
  assert.equal(state.events.includes('drop'), false);
  assert.equal(state.events.at(-1), 'control.end');
});

for (const phase of ['drop', 'end']) {
  test(`${phase} cleanup error is reported with the original failure; control close is attempted`, async () => {
    const original = new Error('Injected test failure'), cleanup = new Error(`Injected ${phase} failure`);
    const { withDisposableHttpDb, state } = harness({ [phase]: cleanup });
    await assert.rejects(withDisposableHttpDb('guard', async () => { throw original; }),
      e => e.cause === original && e.errors.includes(cleanup));
    assert.equal(state.events.filter(e => e === 'drop').length, 1);
    assert.equal(state.events.at(-1), 'control.end');
  });
}
