// Controlled local backup drill. No migration, seed or source application writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { Client } = require('pg');
if (require.main === module) require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const repo = path.resolve(__dirname, '../..');
const expected = { systemId: '7628257575938021648', database: 'electrical_infrastructure', port: 55432,
  directory: 'd:/postgresqldowload/data' };
const sourceConfig = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  application_name: 'elv-backup-restore-check', connectionTimeoutMillis: 5000,
  statement_timeout: 30000, lock_timeout: 3000 };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const outside = (parent, child, platform = process.platform) => {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const key = value => platform === 'win32' ? api.resolve(value).toLowerCase() : api.resolve(value);
  const rel = api.relative(key(parent), key(child));
  return rel === '..' || rel.startsWith('..' + api.sep) || api.isAbsolute(rel);
};
// Resolve an existing ancestor before creating a not-yet-existing directory.
// A dangling link is not a safe missing ancestor: fail rather than follow it.
async function canonicalFuture(input) {
  let candidate = path.resolve(input); const missing = [];
  for (;;) {
    try { return path.resolve(await fs.realpath(candidate), ...missing.slice().reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const entry = await fs.lstat(candidate).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      assert.ok(!entry, 'Unresolved existing path or link is not a safe backup root');
      const parent = path.dirname(candidate); assert.notEqual(parent, candidate);
      missing.push(path.basename(candidate)); candidate = parent;
    }
  }
}
async function backupRoot(base, repository, storage) {
  const realRepo = await fs.realpath(repository), realStorage = await fs.realpath(storage);
  const guard = target => assert.ok(outside(realRepo, target) && outside(realStorage, target) && outside(target, realStorage),
    'Backup root overlaps repository or source storage');
  const canonical = await canonicalFuture(base); guard(canonical);
  await fs.mkdir(canonical, { recursive: true });
  const actual = await fs.realpath(canonical); guard(actual);
  assert.ok(!outside(canonical, actual) && !outside(actual, canonical), 'Backup root changed while being created');
  return actual;
}
const safeCodes = new Set(['ERR_ASSERTION', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'ETIMEDOUT',
  'ECONNREFUSED', 'ECONNRESET', '23505', '42501', '42P04', '55006', '57014']);
function safeError(error, phase) {
  const kinds = new Set(['Error', 'TypeError', 'AssertionError', 'AggregateError']);
  return { phase, kind: kinds.has(error?.name) ? error.name : 'Error',
    code: safeCodes.has(error?.code) ? error.code : 'UNCLASSIFIED' };
}
function failed(phase, error) {
  const info = safeError(error, phase);
  const result = new Error(`Backup/restore check failed at ${phase} (${info.code})`, { cause: error });
  result.phase = phase; return result;
}
async function finishReport(report, backup, failure, errors, write = fs.writeFile, log = console.log) {
  report.cleanup.errors = errors.map(error => safeError(error.cause || error, error.phase || 'cleanup'));
  if (backup) try {
    await write(path.join(backup, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    errors.push(failed('verification-report-write', error));
    report.cleanup.errors.push(safeError(error, 'verification-report-write'));
  }
  log(JSON.stringify({ backup, checks: report.checks, failure: report.failure, restore: report.restore,
    retainedRuntime: report.cleanup.runtimeRetained, counts: report.tables, storage: report.storage,
    dump: report.dump, cleanup: report.cleanup }, null, 2));
  return errors.length ? new AggregateError(failure ? [failure, ...errors] : errors,
    'Backup/restore cleanup/report failed', { cause: failure || errors[0] }) : failure;
}
async function createRestoreDatabase(admin, name, marker, owner, report, afterCreate) {
  assert.match(name, /^restore_test_[0-9a-f]{32}$/); assert.notEqual(name, sourceConfig.database);
  assert.match(marker, /^elv-restore:[0-9a-f-]{36}$/);
  report.restore = { name, phase: 'create-requested', createdConfirmed: false, ownershipConfirmed: false };
  await admin.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  report.restore.createdConfirmed = true; report.restore.phase = 'created-awaiting-ownership';
  await afterCreate?.(); // Controlled test injection; never configured by environment/CLI.
  const row = (await admin.query(`SELECT datname, oid::text, pg_get_userbyid(datdba) AS owner,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`, [name])).rows[0];
  assert.equal(row?.datname, name); assert.equal(row?.owner, owner); assert.equal(row?.marker, null);
  await admin.query(`COMMENT ON DATABASE ${quote(name)} IS '${marker}'`);
  const ownership = { ...row, marker };
  // Do not call ownership confirmed until the catalog has verified the marker.
  await verifyDatabase(admin, ownership);
  report.restore.ownershipConfirmed = true; report.restore.phase = 'ownership-confirmed';
  return ownership;
}
async function verifyDatabase(admin, ownership) {
  assert.ok(ownership); assert.match(ownership.datname, /^restore_test_[0-9a-f]{32}$/);
  assert.notEqual(ownership.datname, sourceConfig.database);
  assert.match(ownership.marker, /^elv-restore:[0-9a-f-]{36}$/);
  assert.match(ownership.oid, /^\d+$/); assert.ok(ownership.owner);
  const row = (await admin.query(`SELECT datname, oid::text, pg_get_userbyid(datdba) AS owner,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`, [ownership.datname])).rows[0];
  same(row, ownership, 'Restore database name/owner/marker/OID changed; retaining it');
}
async function cleanupRestoreDatabase(admin, ownership, report) {
  if (!ownership) {
    if (report.restore) report.cleanup.databaseRetained = {
      name: report.restore.name, phase: report.restore.phase, createdConfirmed: report.restore.createdConfirmed,
      reason: 'Ownership unconfirmed; database may exist and was not dropped',
    };
    return;
  }
  await verifyDatabase(admin, ownership);
  const sessions = (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datid=$1', [ownership.oid])).rows[0].n;
  assert.equal(sessions, 0);
  await admin.query(`DROP DATABASE ${quote(ownership.datname)}`); report.cleanup.databaseDropped = true;
}
async function checkZipPdf(entries, runtime, projectCode, acceptanceCode, inspect) {
  const bytes = entries.get('acceptance/acceptance.pdf'); assert.ok(bytes, 'Missing PDF inside ZIP');
  const target = path.join(runtime, 'zip-acceptance.pdf'); await fs.writeFile(target, bytes);
  const text = (await inspect(target)).pages.join('\n');
  assert.ok(text.includes(projectCode) && text.includes(acceptanceCode), 'ZIP PDF belongs to the wrong project/acceptance');
}
async function digest(file) {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest('hex') };
}
async function inventory(root) {
  const files = [], directories = [];
  async function walk(dir) {
    for (const name of (await fs.readdir(dir)).sort()) {
      const target = path.join(dir, name), info = await fs.lstat(target);
      assert.ok(!info.isSymbolicLink(), 'Storage symlinks are not supported by this drill');
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (info.isDirectory()) { directories.push(relative); await walk(target); }
      else { assert.ok(info.isFile(), 'Storage contains a non-regular file'); files.push({ path: relative, ...await digest(target) }); }
    }
  }
  await walk(root); return { directories: directories.sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
async function copyStorage(from, to, listing) {
  await fs.mkdir(to);
  for (const dir of listing.directories) await fs.mkdir(path.join(to, dir), { recursive: true });
  for (const entry of listing.files) await pipeline(createReadStream(path.join(from, entry.path)),
    createWriteStream(path.join(to, entry.path), { flags: 'wx', mode: 0o600 }));
  assert.deepEqual(await inventory(to), listing, 'Storage copy must match every source byte');
}
async function tables(client) {
  return (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
}
async function fingerprints(client, names) {
  const result = {};
  for (const name of names) {
    // Includes password hashes internally, but only an aggregate digest leaves
    // this function. Never print rows or embed them in an assertion/error.
    const rows = (await client.query(`SELECT to_jsonb(t)::text AS row FROM public.${quote(name)} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows;
    const hash = createHash('sha256');
    for (const row of rows) hash.update(row.row + '\n');
    result[name] = { count: rows.length, sha256: hash.digest('hex') };
  }
  return result;
}
async function sequenceState(client) {
  const names = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  const result = {};
  for (const row of names) result[row.sequencename] = (await client.query(`SELECT last_value::text, is_called FROM public.${quote(row.sequencename)}`)).rows[0];
  return result;
}
function same(a, b, message) { assert.ok(JSON.stringify(a) === JSON.stringify(b), message); }
async function command(name, args, database) {
  assert.ok(process.env.PG_BIN_DIR, 'Set PG_BIN_DIR to the matching PostgreSQL bin directory');
  const tool = path.join(process.env.PG_BIN_DIR, name + (process.platform === 'win32' ? '.exe' : ''));
  // Password is process environment only, never argv/log. Do not forward JWT or
  // all application variables to database utilities.
  return exec(tool, args, { timeout: 300000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: {
    SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: os.tmpdir(), TMP: os.tmpdir(),
    PGHOST: sourceConfig.host, PGPORT: String(sourceConfig.port), PGUSER: sourceConfig.user,
    PGPASSWORD: sourceConfig.password, PGDATABASE: database, PGAPPNAME: 'elv-backup-tool',
  } });
}
async function open(config) {
  const c = new Client(config);
  try { await c.connect(); return c; } catch (error) { await c.end().catch(() => {}); throw error; }
}
async function preflight(c) {
  assert.ok(['127.0.0.1', 'localhost'].includes(sourceConfig.host));
  assert.equal(sourceConfig.database, expected.database); assert.equal(sourceConfig.port, expected.port);
  const identity = (await c.query(`SELECT current_database() AS database, inet_server_port() AS port,
    current_setting('data_directory') AS directory, current_setting('server_encoding') AS encoding,
    (SELECT system_identifier::text FROM pg_control_system()) AS system_id`)).rows[0];
  assert.equal(identity.system_id, expected.systemId); assert.equal(identity.database, expected.database);
  assert.equal(identity.port, expected.port); assert.equal(identity.encoding, 'UTF8');
  assert.equal(identity.directory.replaceAll('\\', '/').toLowerCase(), expected.directory);
  const peers = (await c.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rows[0].n;
  assert.equal(peers, 0, 'Other source sessions exist: stop writers first; this script never stops them');
  for (const port of [3000, 5173]) {
    const listening = await new Promise(resolve => {
      const socket = require('node:net').connect({ host: '127.0.0.1', port });
      const done = value => { socket.destroy(); resolve(value); };
      socket.once('connect', () => done(true)); socket.once('error', () => done(false));
      socket.setTimeout(1000, () => done(true)); // Uncertain reachability fails closed.
    });
    assert.equal(listening, false, 'Local application port is active/uncertain; stop writers yourself first');
  }
  const storage = await fs.realpath(process.env.EVIDENCE_STORAGE_DIR || '');
  assert.ok(process.env.EVIDENCE_STORAGE_DIR && path.isAbsolute(process.env.EVIDENCE_STORAGE_DIR));
  assert.ok(outside(await fs.realpath(repo), storage), 'Source storage must be outside repository');
  const migrations = (await c.query('SELECT timestamp::text, name FROM migrations ORDER BY timestamp')).rows;
  assert.equal(migrations.length, 14);
  console.log(JSON.stringify({ stage: 'preflight', identity, storage, migrationCount: migrations.length, otherSourceSessions: peers }));
  return { identity, storage, migrations };
}
async function unzip(filename) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const entries = new Map();
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', () => resolve(entries));
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return fail(error);
      assert.ok(!entries.has(entry.fileName));
      const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', fail);
      stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
    })); zip.readEntry();
  }));
}

async function main() {
  let stage = 'connect', source, admin, restore, restoredSource, app, adapter, locked = false;
  let backup, runtime, ownership, failure;
  const marker = 'elv-restore:' + randomUUID();
  const restoreName = 'restore_test_' + randomUUID().replaceAll('-', '');
  const previous = { DB_NAME: process.env.DB_NAME, EVIDENCE_STORAGE_DIR: process.env.EVIDENCE_STORAGE_DIR };
  const report = { startedAt: new Date().toISOString(), checks: [], cleanup: {} };
  function pass(name) { report.checks.push(name); console.log('PASS ' + name); }
  async function verifyRestore(connection = admin) {
    assert.ok(ownership, 'No verified restore database ownership');
    assert.match(restoreName, /^restore_test_[0-9a-f]{32}$/); assert.notEqual(restoreName, sourceConfig.database);
    const queryRows = async (sql, parameters) => {
      const result = await connection.query(sql, parameters);
      return Array.isArray(result) ? result : result.rows; // TypeORM manager vs pg.Client.
    };
    const row = (await queryRows(`SELECT datname, oid::text, pg_get_userbyid(datdba) AS owner,
      shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`, [restoreName]))[0];
    same(row, ownership, 'Restore database name/owner/marker/OID changed; retaining it');
    if (connection !== admin) assert.equal((await queryRows('SELECT current_database() AS name'))[0].name, restoreName);
  }
  async function verifyRuntime() {
    assert.ok(runtime && path.basename(runtime).startsWith('elv-restore-check-'));
    assert.equal(await fs.realpath(path.dirname(runtime)), await fs.realpath(os.tmpdir()));
    assert.equal(await fs.realpath(runtime), runtime);
    const proof = JSON.parse(await fs.readFile(path.join(runtime, 'owner.json'), 'utf8'));
    assert.equal(proof.marker, marker); assert.equal(proof.database, restoreName);
    assert.ok(outside(repo, runtime)); assert.ok(outside(runtime, previous.EVIDENCE_STORAGE_DIR));
  }
  try {
    source = await open(sourceConfig);
    const info = await preflight(source);
    if (!process.argv.includes('--execute')) return;
    for (const tool of ['pg_dump', 'pg_restore']) {
      const version = (await command(tool, ['--version'], sourceConfig.database)).stdout.trim();
      assert.match(version, /\(PostgreSQL\) 18\./, 'Use PostgreSQL 18 backup/restore utilities');
      report[tool] = version;
    }
    // All local applications must remain off. SHARE locks prevent table DML/DDL
    // while files are copied; no source rows, schema or sequences are modified.
    stage = 'lock and source fingerprint';
    const names = await tables(source);
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); locked = true;
    await source.query(`LOCK TABLE ${names.map(n => 'public.' + quote(n)).join(',')} IN SHARE MODE NOWAIT`);
    const before = await fingerprints(source, names), sequences = await sequenceState(source);
    const storageBefore = await inventory(info.storage);
    const snap = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const evidence = (await source.query('SELECT storage_key, size_bytes, sha256, deleted_at FROM evidence_attachments')).rows;
    const pinKeys = (await source.query('SELECT pinned_storage_key AS key FROM acceptance_evidence WHERE pinned_storage_key IS NOT NULL')).rows;
    const references = new Set([...evidence.map(e => 'files/' + e.storage_key), ...pinKeys.map(p => 'files/' + p.key)]);
    const orphanFiles = storageBefore.files.filter(f => f.path.startsWith('files/') && !references.has(f.path));
    for (const file of evidence) {
      const stored = storageBefore.files.find(f => f.path === 'files/' + file.storage_key);
      assert.ok(stored && stored.size === file.size_bytes && stored.sha256 === file.sha256, 'Source evidence integrity mismatch; no restore was attempted');
    }
    const base = await backupRoot(process.env.ELV_BACKUP_ROOT || path.join(os.homedir(), '.codex', 'backups'), repo, info.storage);
    backup = await fs.mkdtemp(path.join(base, 'elv-' + new Date().toISOString().replaceAll(':', '-') + '-'));
    stage = 'backup database and storage';
    const dump = path.join(backup, 'database.dump');
    await command('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--snapshot=' + snap, '--file=' + dump, '--dbname=' + sourceConfig.database], sourceConfig.database);
    const toc = await command('pg_restore', ['--list', dump], sourceConfig.database);
    assert.ok(toc.stdout.includes('TABLE DATA public users'));
    await fs.writeFile(path.join(backup, 'database.toc.txt'), toc.stdout, { mode: 0o600 });
    await copyStorage(info.storage, path.join(backup, 'storage'), storageBefore);
    const dumpDigest = await digest(dump);
    const backupManifest = { schemaVersion: 1, startedAt: report.startedAt, backupAt: new Date().toISOString(),
      source: { ...info.identity, storage: info.storage }, migrations: info.migrations,
      dump: { path: 'database.dump', ...dumpDigest, format: 'custom', ownerAclExcluded: true },
      tables: before, sequences, storage: storageBefore, orphanFiles,
      counts: { evidence: evidence.length, activeEvidence: evidence.filter(e => !e.deleted_at).length,
        softDeletedEvidence: evidence.filter(e => e.deleted_at).length, orphanFiles: orphanFiles.length } };
    await fs.writeFile(path.join(backup, 'manifest.json'), JSON.stringify(backupManifest, null, 2) + '\n', { mode: 0o600 });
    await fs.writeFile(path.join(backup, 'manifest.sha256'), (await digest(path.join(backup, 'manifest.json'))).sha256 + '  manifest.json\n');
    pass('new database/storage backup and readable dump');
    stage = 'create owned restore database';
    runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-restore-check-'));
    await fs.writeFile(path.join(runtime, 'owner.json'), JSON.stringify({ marker, database: restoreName }));
    await verifyRuntime();
    const owner = (await source.query('SELECT current_user AS name')).rows[0].name;
    // CREATE DATABASE cannot run inside the source snapshot transaction.
    admin = await open(sourceConfig);
    ownership = await createRestoreDatabase(admin, restoreName, marker, owner, report);
    await verifyRestore();
    stage = 'restore';
    await command('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname=' + restoreName, dump], restoreName);
    await verifyRestore();
    restore = await open({ ...sourceConfig, database: restoreName }); await verifyRestore(restore);
    await verifyRuntime();
    await copyStorage(path.join(backup, 'storage'), path.join(runtime, 'storage'), storageBefore);
    same(await tables(restore), names, 'Restored table set differs');
    same(await fingerprints(restore, names), before, 'Restored table counts/fingerprints differ');
    same(await sequenceState(restore), sequences, 'Restored sequences differ');
    pass('restore counts/fingerprints/sequences and every file hash');
    stage = 'restore API boot';
    process.env.DB_NAME = restoreName; process.env.EVIDENCE_STORAGE_DIR = path.join(runtime, 'storage');
    const { DataSource } = require('typeorm'); const { dataSource } = require('../dist/database/data-source');
    const { closeOwnedDataSource } = require('../test/disposable-http-db.cjs');
    restoredSource = new DataSource({ ...dataSource.options, database: restoreName });
    assert.ok(!restoredSource.options.synchronize && !restoredSource.options.migrationsRun && !restoredSource.options.dropSchema);
    await verifyRestore(); await restoredSource.initialize(); await verifyRestore(restoredSource);
    const { Module, ValidationPipe } = require('@nestjs/common'); const { TypeOrmModule } = require('@nestjs/typeorm');
    const { NestFactory } = require('@nestjs/core'); const { ExpressAdapter } = require('@nestjs/platform-express');
    const { AppModule } = require('../dist/app.module');
    class RestoreModule {}
    const imports = Reflect.getMetadata('imports', AppModule);
    assert.equal(imports.filter(m => m.module === TypeOrmModule).length, 1);
    Module({ imports: imports.map(m => m.module === TypeOrmModule ? TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...restoredSource.options, manualInitialization: true, retryAttempts: 1 }),
      dataSourceFactory: async () => { await verifyRestore(restoredSource); return restoredSource; },
    }) : m), controllers: Reflect.getMetadata('controllers', AppModule) })(RestoreModule);
    adapter = new ExpressAdapter();
    app = await NestFactory.create(RestoreModule, adapter, { logger: false, abortOnError: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1'); await verifyRestore(app.get(DataSource));
    assert.equal(await app.get(require('../dist/evidence/evidence.storage').EvidenceStorage).root(), await fs.realpath(path.join(runtime, 'storage')));
    const origin = await app.getUrl(); assert.notEqual(new URL(origin).port, '3000'); report.restoreApiPort = Number(new URL(origin).port);
    async function api(method, endpoint, token, body, expectedStatus = 200, binary = false) {
      await verifyRestore(app.get(DataSource)); await verifyRuntime();
      const response = await fetch(origin + endpoint, { method, signal: AbortSignal.timeout(150000),
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, expectedStatus, 'Unexpected restored API status: ' + endpoint);
      return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
    }
    assert.equal((await api('GET', '/health')).database, 'connected');
    const tokens = {};
    for (const [key, role] of [['MANAGER', 'MANAGER'], ['TECHNICIAN', 'TECHNICIAN']]) {
      const password = process.env['DEMO_' + key + '_PASSWORD']; assert.ok(password, 'Missing local credentials; never reset accounts');
      const email = process.env['DEMO_' + key + '_EMAIL'] || key.toLowerCase() + '.demo@example.local';
      tokens[key] = (await api('POST', '/auth/login', null, { email, password }, 201)).accessToken;
      const me = await api('GET', '/auth/me', tokens[key]); assert.equal(me.role, role);
      assert.equal(me.mustChangePassword, false); assert.equal(me.isActive, true);
    }
    pass('health and both existing role logins on restored API');
    const project = (await api('GET', '/projects', tokens.MANAGER)).find(p => p.code === 'CT-DEMO-ELV-01'); assert.ok(project);
    report.demoCode = project.code;
    const acceptances = await api('GET', `/projects/${project.id}/acceptances`, tokens.MANAGER);
    const pins = (await restore.query(`SELECT a.id, a.code, e.evidence_id, e.pinned_storage_key, f.deleted_at, f.sha256
      FROM project_acceptances a JOIN acceptance_evidence e ON e.acceptance_id=a.id
      JOIN evidence_attachments f ON f.id=e.evidence_id
      WHERE a.project_id=$1 AND a.status='CONFIRMED' AND f.deleted_at IS NOT NULL AND e.pinned_storage_key IS NOT NULL
      ORDER BY a.code`, [project.id])).rows;
    assert.ok(pins.length, 'No demo CONFIRMED pin with a soft-deleted source; do not mutate fixture');
    const selected = pins[0]; report.acceptanceCode = selected.code;
    assert.ok(acceptances.some(a => a.id === selected.id));
    const detail = await api('GET', `/projects/${project.id}/acceptances/${selected.id}`, tokens.MANAGER);
    assert.equal(detail.status, 'CONFIRMED'); assert.ok(detail.snapshot);
    const summary = await api('GET', `/projects/${project.id}/acceptances/${selected.id}`, tokens.TECHNICIAN);
    assert.ok(!('snapshot' in summary));
    const fileUrl = `/projects/${project.id}/acceptances/${selected.id}/files/${selected.evidence_id}/content`;
    const pinned = await api('GET', fileUrl, tokens.MANAGER, null, 200, true);
    assert.equal(createHash('sha256').update(pinned).digest('hex'), selected.sha256);
    await api('GET', fileUrl, tokens.TECHNICIAN, null, 403);
    pass('demo acceptance snapshot, technician summary and soft-deleted pinned download');
    stage = 'restored PDF and ZIP';
    const pdf = await api('GET', `/projects/${project.id}/acceptances/${selected.id}/export.pdf`, tokens.MANAGER, null, 200, true);
    const zip = await api('GET', `/projects/${project.id}/acceptances/${selected.id}/handover-package.zip`, tokens.MANAGER, null, 200, true);
    const pdfPath = path.join(runtime, 'acceptance.pdf'), zipPath = path.join(runtime, 'handover.zip');
    await fs.writeFile(pdfPath, pdf); await fs.writeFile(zipPath, zip);
    const python = process.env.EXPORT_PYTHON_BIN || 'python';
    const inspect = async file => JSON.parse((await exec(python, [path.join(__dirname, '../test/read-export-pdf.py'), file],
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout);
    const text = (await inspect(pdfPath)).pages.join('\n'); assert.ok(text.includes(project.code) && text.includes(selected.code));
    const entries = await unzip(zipPath), manifest = JSON.parse(entries.get('manifest.json'));
    await checkZipPdf(entries, runtime, project.code, selected.code, inspect);
    assert.equal(manifest.project.code, project.code); assert.equal(manifest.acceptance.code, selected.code);
    for (const file of manifest.files) {
      const bytes = entries.get(file.path); assert.ok(bytes, 'Missing ZIP artifact');
      assert.equal(bytes.length, file.sizeBytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    const readWorkbook = require('../test/read-xlsx.cjs');
    for (const [name, sheetNames] of [['devices', ['Thông tin', 'Thiết bị', 'Tủ']], ['connections', ['Thông tin', 'Cổng', 'Dây', 'Tra cứu']]]) {
      const target = path.join(runtime, name + '.xlsx'); await fs.writeFile(target, entries.get('current/' + name + '.xlsx'));
      const book = await readWorkbook(target); same(book.worksheets.map(s => s.name), sheetNames, 'Wrong workbook sheets');
      assert.ok(String(book.getWorksheet('Thông tin').getRow(2).getCell(2).value).includes(project.code));
    }
    assert.ok(manifest.files.some(f => f.kind === 'pinned-evidence'));
    pass('PDF text, ZIP artifacts, XLSX content and manifest SHA-256');
    stage = 'source unchanged verification';
    // Same locked source transaction plus a fresh post-rollback read below.
    same(await fingerprints(source, names), before, 'Locked source fingerprints changed');
    same(await inventory(info.storage), storageBefore, 'Source storage changed');
    await source.query('ROLLBACK'); locked = false;
    same(await fingerprints(source, names), before, 'Fresh source fingerprints changed');
    same(await sequenceState(source), sequences, 'Source sequences changed');
    same(await inventory(info.storage), storageBefore, 'Fresh source storage changed');
    same(await fingerprints(restore, names), before, 'Restored API unexpectedly changed business data');
    pass('fresh source/restored business fingerprints and source files unchanged');
    report.tables = Object.fromEntries(Object.entries(before).map(([name, entry]) => [name, entry.count]));
    report.storage = { files: storageBefore.files.length, bytes: storageBefore.files.reduce((n, f) => n + f.size, 0), orphanFiles: orphanFiles.length,
      softDeletedEvidence: evidence.filter(e => e.deleted_at).length };
    report.backup = backup; report.dump = dumpDigest; report.finishedAt = new Date().toISOString();
    // Explicit close here also exercises cleanup after all API streams finish.
    await app.close(); app = undefined; await closeOwnedDataSource(restoredSource); restoredSource = undefined;
  } catch (error) {
    failure = failed(stage, error);
    report.failedStage = stage;
    report.failure = safeError(error, stage);
  } finally {
    const errors = [];
    for (const close of [() => app?.close(), () => adapter?.close(),
      async () => { if (restoredSource) await require('../test/disposable-http-db.cjs').closeOwnedDataSource(restoredSource); },
      () => restore?.end()]) { try { await close(); } catch (error) { errors.push(failed('restore-connection-server-cleanup', error)); } }
    if (source && locked) try { await source.query('ROLLBACK'); locked = false; }
    catch (error) { errors.push(failed('source-lock-release', error)); }
    if (admin) try { await cleanupRestoreDatabase(admin, ownership, report); }
    catch (error) {
      report.cleanup.databaseRetained = { name: restoreName, phase: 'cleanup', reason: 'Ownership/session cleanup unconfirmed' };
      errors.push(failed('restore-database-cleanup', error));
    }
    if (runtime) try { await verifyRuntime(); await fs.rm(runtime, { recursive: true }); report.cleanup.runtimeRemoved = true; }
    catch (error) { report.cleanup.runtimeRetained = runtime; errors.push(failed('restore-runtime-cleanup', error)); }
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    for (const c of [admin, source]) try { await c?.end(); } catch (error) { errors.push(failed('control-connection-close', error)); }
    failure = await finishReport(report, backup, failure, errors);
  }
  if (failure) throw failure;
}
module.exports = { outside, canonicalFuture, backupRoot, createRestoreDatabase, cleanupRestoreDatabase,
  verifyDatabase, failed, safeError, finishReport, checkZipPdf, unzip };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
