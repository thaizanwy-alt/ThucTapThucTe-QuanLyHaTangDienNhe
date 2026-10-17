// Direct Node fixture. It never spawns another process or uses node:test.
const assert = require('node:assert/strict');
const { barrierClient, verifyBarrier, releaseBarrier, closeBarrier, deadline, databasePattern } = require('../user-race-locks.cjs');

async function main() {
  const database = process.env.USER_RACE_DATABASE;
  const mode = process.env.USER_RACE_MODE;
  assert.match(database, databasePattern);
  assert.notEqual(database, process.env.USER_RACE_CONTROL_DATABASE);
  assert.ok(['normal', 'advisory', 'row-lock', 'rollback-timeout', 'close-timeout', 'process-timeout'].includes(mode));
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database };
  const holder = barrierClient(config), waiter = barrierClient(config);
  const rowLock = ['row-lock', 'rollback-timeout', 'process-timeout'].includes(mode);
  let primary, waiting, forced = false, cleaned = false, waiterFinished = false;
  try {
    await holder.connect();
    await verifyBarrier(holder, database, true, process.env.USER_RACE_CONTROL_DATABASE);
    const marker = (await holder.client.query(`SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`)).rows[0].marker;
    assert.equal(marker, process.env.USER_RACE_MARKER, 'only the supervisor-created DB may receive fixture DDL');
    const settings = (await holder.client.query(`SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock`)).rows[0];
    assert.deepEqual(settings, { statement: '10s', lock: '8s' });
    await waiter.connect();
    await verifyBarrier(waiter, database, true, process.env.USER_RACE_CONTROL_DATABASE);
    const waiterPid = (await waiter.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if (rowLock) {
      assert.equal(holder.verified, true);
      await holder.client.query('CREATE TABLE user_race_barrier(id integer PRIMARY KEY)');
      await holder.client.query('INSERT INTO user_race_barrier VALUES(1)');
      await holder.client.query('BEGIN');
      await holder.client.query('SELECT id FROM user_race_barrier FOR UPDATE');
      waiting = waiter.client.query('SELECT id FROM user_race_barrier FOR UPDATE');
    } else {
      await holder.client.query('SELECT pg_advisory_lock(180318,55)');
      waiting = waiter.client.query('SELECT pg_advisory_xact_lock(180318,55)');
    }
    void waiting.catch(() => {});
    let observed = false;
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const row = (await holder.client.query('SELECT wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [waiterPid])).rows[0];
      if (row?.wait_event_type === 'Lock' && row.blockers.length) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(observed, true, 'a real PostgreSQL waiter must reach the held lock');
    process.stdout.write(JSON.stringify({ stage: 'held', mode }) + '\n');
    if (mode === 'process-timeout') {
      // Supervisor intentionally terminates this single process while it owns a
      // transaction and a blocked query; no cleanup is claimed by this branch.
      await new Promise(() => { setInterval(() => {}, 1000); });
    }
    if (['advisory', 'row-lock'].includes(mode)) throw new Error(`injected ${mode}`);
  } catch (error) { primary = error; }
  finally {
    try {
      if (mode === 'close-timeout') {
        // Stall the graceful close without sending Terminate. The helper must
        // destroy its own socket and observe actual client-end/socket-close.
        holder.client.end = () => holder.clientDone;
        forced = (await closeBarrier(holder, 80)).forced;
      } else {
        if (holder.verified && !holder.socketClosed) {
          if (mode === 'rollback-timeout') {
            const query = holder.client.query.bind(holder.client);
            holder.client.query = (sql, ...args) => sql === 'ROLLBACK' ? query('SELECT pg_sleep(3)') : query(sql, ...args);
          }
          forced = (await releaseBarrier(holder, rowLock ? 'ROLLBACK' : 'SELECT pg_advisory_unlock_all()', mode === 'rollback-timeout' ? 80 : 1500)).forced;
        }
        await closeBarrier(holder);
      }
      if (waiting) { await deadline(waiting, 3000, 'waiter after holder close'); waiterFinished = true; }
      await closeBarrier(waiter);
      assert.equal(holder.socketClosed && holder.clientEnded && waiter.socketClosed && waiter.clientEnded, true);
      cleaned = true;
    } catch (error) {
      if (primary) primary.cleanupFailure = error.message; else primary = error;
    }
  }
  process.stdout.write(JSON.stringify({ cleaned, forced, waiterFinished, socketClosed: holder.socketClosed,
    clientEnded: holder.clientEnded, error: primary?.message, cleanupFailure: primary?.cleanupFailure }) + '\n');
  process.exitCode = primary ? 1 : 0;
}

main().catch(() => { process.stderr.write('Fixture setup/cleanup unconfirmed\n'); process.exitCode = 2; });
