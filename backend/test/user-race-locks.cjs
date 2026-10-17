// Only standalone connections owned by the account race harness belong here.
const assert = require('node:assert/strict');
const net = require('node:net');
const { Client } = require('pg');

const databasePattern = /^users_test_[0-9a-f]{32}$/;
const identitySql = `SELECT current_database() AS database,current_user AS actor,
  (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner`;

function deadline(work, ms, label) {
  let timer;
  return Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
  })]).finally(() => clearTimeout(timer));
}

function barrierClient(config) {
  const socket = new net.Socket();
  const client = new Client({ ...config, stream: socket, connectionTimeoutMillis: 3000,
    statement_timeout: 10000, lock_timeout: 8000, idle_in_transaction_session_timeout: 15000 });
  const handle = { client, socket, verified: false, started: false, socketClosed: false, clientEnded: false };
  handle.socketDone = new Promise(resolve => socket.once('close', () => { handle.socketClosed = true; resolve(); }));
  handle.clientDone = new Promise(resolve => client.once('end', () => { handle.clientEnded = true; resolve(); }));
  client.on('error', () => {}); // Expected on destruction of this harness-owned socket.
  handle.connect = async () => { handle.started = true; await client.connect(); };
  return handle;
}

async function verifyBarrier(handle, database, created, localDatabase) {
  assert.equal(created, true);
  assert.match(database, databasePattern);
  assert.notEqual(database, localDatabase);
  const row = (await handle.client.query(identitySql)).rows[0];
  assert.equal(row.database, database);
  assert.equal(row.owner, row.actor);
  handle.verified = true;
}

async function forceClosed(handle) {
  // pg@8.23.0 accepts an owned `stream` in Client config. Its Client.end()
  // also destroys this socket for an active non-pipelined query. Explicitly
  // destroying our socket covers a stalled graceful end without driver internals.
  handle.socket.destroy();
  await deadline(handle.started ? Promise.all([handle.socketDone, handle.clientDone]) : handle.socketDone, 3000, 'owned socket/client close');
  assert.equal(handle.socketClosed, true);
  if (handle.started) assert.equal(handle.clientEnded, true);
}

async function releaseBarrier(handle, sql, ms = 1500) {
  if (!handle || handle.socketClosed) return { forced: false };
  assert.equal(handle.verified, true, 'SQL cleanup requires the verified disposable connection');
  const query = handle.client.query(sql);
  void query.catch(() => {});
  try { await deadline(query, ms, 'barrier SQL cleanup'); return { forced: false }; }
  catch (error) {
    await forceClosed(handle);
    // Destruction must settle the actual driver query, not merely its timer.
    await deadline(Promise.allSettled([query]), 3000, 'terminated cleanup query');
    return { forced: true, cause: error };
  }
}

async function closeBarrier(handle, ms = 1500) {
  if (!handle) return { forced: false };
  if (handle.socketClosed) {
    await deadline(handle.started ? handle.clientDone : Promise.resolve(), 3000, 'client end acknowledgement');
    return { forced: false };
  }
  if (!handle.started) { await forceClosed(handle); return { forced: true }; }
  const ending = Promise.resolve().then(() => handle.client.end());
  void ending.catch(() => {});
  try {
    await deadline(Promise.all([ending, handle.socketDone, handle.clientDone]), ms, 'graceful barrier close');
    return { forced: false };
  } catch (error) {
    await forceClosed(handle);
    return { forced: true, cause: error };
  }
}

module.exports = { barrierClient, verifyBarrier, releaseBarrier, closeBarrier, deadline, databasePattern };
