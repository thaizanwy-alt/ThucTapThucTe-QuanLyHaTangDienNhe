const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { Client } = require('pg');
const { outside, backupRoot, createRestoreDatabase, cleanupRestoreDatabase, verifyDatabase,
  failed, safeError, finishReport, checkZipPdf, unzip } = require('../scripts/backup-restore-check.cjs');

async function temporary(action) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-backup-regression-'));
  try { await action(root); } finally {
    assert.ok(path.basename(root).startsWith('elv-backup-regression-'));
    assert.equal(await fs.realpath(path.dirname(root)), await fs.realpath(os.tmpdir()));
    await fs.rm(root, { recursive: true });
  }
}
test('canonical guard rejects real storage/repository aliases before creating backup directories', async () => {
  await temporary(async root => {
    const repository = path.join(root, 'repository'), storage = path.join(root, 'SourceStorage');
    await fs.mkdir(repository); await fs.mkdir(storage); await fs.writeFile(path.join(storage, 'sentinel'), 'unchanged');
    const alias = path.join(root, 'storage-alias'), repoAlias = path.join(root, 'repo-alias');
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(storage, alias, type); await fs.symlink(repository, repoAlias, type);
    for (const candidate of [alias, path.join(alias, 'new', 'nested'), root, path.join(repoAlias, 'new')]) {
      await assert.rejects(backupRoot(candidate, repository, storage), /overlaps/);
    }
    if (process.platform === 'win32') {
      await assert.rejects(backupRoot(alias.toUpperCase().replaceAll('\\', '/'), repository, storage), /overlaps/);
    }
    assert.deepEqual(await fs.readdir(storage), ['sentinel']);
    assert.deepEqual(await fs.readdir(repository), []);
    assert.equal(await fs.readFile(path.join(storage, 'sentinel'), 'utf8'), 'unchanged');
    const safe = await backupRoot(path.join(root, 'separate', 'backups'), repository, storage);
    assert.equal(safe, await fs.realpath(path.join(root, 'separate', 'backups')));
    assert.ok(outside(storage, safe) && outside(safe, storage));
  });
});

test('Windows path relationship uses case-insensitive normalized separators', () => {
  assert.equal(outside('D:\\Storage', 'd:/storage/BACKUP', 'win32'), false);
  assert.equal(outside('D:\\Storage', 'd:/STORAGE', 'win32'), false);
  assert.equal(outside('D:\\Storage', 'd:/StorageOther', 'win32'), true);
});

test('failure after CREATE is reported and retained until independently proven ownership', { timeout: 90000 }, async () => {
  const { withDisposableHttpDb } = require('./disposable-http-db.cjs');
  await withDisposableHttpDb('backup', async (db, verify) => {
    await verify();
    const o = db.options;
    const client = new Client({ host: o.host, port: o.port, user: o.username, password: o.password,
      database: o.database, connectionTimeoutMillis: 5000, statement_timeout: 15000, lock_timeout: 3000 });
    const name = 'restore_test_' + randomUUID().replaceAll('-', ''), marker = 'elv-restore:' + randomUUID();
    const canary = randomUUID(), injected = new Error(canary);
    const report = { cleanup: {}, checks: [] }; const calls = []; let witness;
    // Every DDL/catalog operation uses the actual verified harness DB connection.
    const admin = { query: async (sql, params) => { await verify(); calls.push(sql); return client.query(sql, params); } };
    const catalog = () => admin.query(`SELECT datname, oid::text, pg_get_userbyid(datdba) AS owner,
      shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`, [name]);
    try {
      await client.connect();
      assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, o.database);
      const owner = (await admin.query('SELECT current_user AS name')).rows[0].name;
      await assert.rejects(createRestoreDatabase(admin, name, marker, owner, report, async () => {
        // Separate test witness: the production function has not established
        // ownership. Record this CREATE's exact OID solely for final test cleanup.
        witness = (await catalog()).rows[0]; throw injected;
      }), error => error === injected);
      assert.deepEqual(report.restore, { name, phase: 'created-awaiting-ownership', createdConfirmed: true, ownershipConfirmed: false });
      const count = calls.length;
      await cleanupRestoreDatabase(admin, undefined, report);
      assert.equal(calls.length, count, 'Unverified cleanup must not issue DROP or guess ownership');
      assert.equal((await catalog()).rows[0].oid, witness.oid, 'Database must still exist after failed run');
      assert.equal(report.cleanup.databaseRetained.name, name);
      await temporary(async backup => {
        const logs = [], original = failed('create owned restore database', injected);
        report.failure = safeError(injected, 'create owned restore database');
        const result = await finishReport(report, backup, original, [], fs.writeFile, text => logs.push(text));
        assert.equal(result.cause, injected);
        const saved = JSON.parse(await fs.readFile(path.join(backup, 'verification.json'), 'utf8'));
        assert.equal(saved.restore.name, name); assert.equal(saved.restore.phase, 'created-awaiting-ownership');
        assert.equal(saved.cleanup.databaseRetained.name, name);
        assert.ok(!JSON.stringify(saved).includes(canary)); assert.ok(!logs.join('').includes(canary));
      });
    } finally {
      try {
        if (witness) {
          // The failed script deliberately retained the DB. Test-only recovery
          // uses the independently captured name/owner/OID, then establishes a
          // marker and verifies all four fields before DROP. Never use a prefix.
          assert.deepEqual((await catalog()).rows[0], witness);
          assert.equal(witness.datname, name); assert.equal(witness.owner, o.username);
          const recoveryMarker = 'elv-restore:' + randomUUID();
          await admin.query(`COMMENT ON DATABASE "${name}" IS '${recoveryMarker}'`);
          const proof = { ...witness, marker: recoveryMarker };
          await verifyDatabase(admin, proof);
          await cleanupRestoreDatabase(admin, proof, { cleanup: {} });
          assert.equal((await catalog()).rows.length, 0);
        }
      } finally { await client.end(); }
    }
  });
});

test('report write and cleanup errors preserve the original cause without logging error payloads', async () => {
  await temporary(async backup => {
    await fs.writeFile(path.join(backup, 'backup-sentinel'), 'keep');
    const canary = randomUUID(), root = new Error(canary), cleanup = new Error(canary), disk = new Error(canary);
    disk.code = 'ENOSPC'; cleanup.code = 'EPERM';
    const failure = failed('restore', root), cleanupFailure = failed('owned-cleanup', cleanup);
    const report = { cleanup: {}, checks: [], failure: safeError(root, 'restore') }, logs = [];
    const result = await finishReport(report, backup, failure, [cleanupFailure], async () => { throw disk; }, text => logs.push(text));
    assert.ok(result instanceof AggregateError); assert.equal(result.cause, failure);
    assert.equal(result.errors[0].cause, root); assert.equal(result.errors[1].cause, cleanup);
    assert.equal(result.errors[2].cause, disk);
    assert.deepEqual(report.cleanup.errors.map(e => e.code), ['EPERM', 'ENOSPC']);
    assert.ok(!JSON.stringify(report).includes(canary)); assert.ok(!logs.join('').includes(canary));
    assert.equal(await fs.readFile(path.join(backup, 'backup-sentinel'), 'utf8'), 'keep');
  });
});

test('ZIP PDF is extracted and checked with the real Python text reader', { timeout: 60000 }, async () => {
  await temporary(async root => {
    const { pdf, PDF_TEXT_FEATURES } = require('../dist/exports/exports.render');
    const font = path.join(__dirname, '../dist/exports/fonts/NotoSans.ttf');
    const artifact = await pdf('backup-regression.pdf', font, doc => {
      doc.addPage(); doc.font(font).text('CT-BACKUP-TEST AC-BACKUP-TEST', { features: PDF_TEXT_FEATURES });
    });
    try {
      const archive = new (require('yazl').ZipFile)();
      archive.addFile(artifact.path, 'acceptance/acceptance.pdf'); archive.end();
      const filename = path.join(root, 'fixture.zip');
      await pipeline(archive.outputStream, createWriteStream(filename, { flags: 'wx' }));
      const entries = await unzip(filename);
      const inspect = async file => JSON.parse((await exec(process.env.EXPORT_PYTHON_BIN || 'python',
        [path.join(__dirname, 'read-export-pdf.py'), file], { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout);
      await checkZipPdf(entries, root, 'CT-BACKUP-TEST', 'AC-BACKUP-TEST', inspect);
      await assert.rejects(checkZipPdf(entries, root, 'WRONG-PROJECT', 'AC-BACKUP-TEST', inspect), /wrong project/);
    } finally { await artifact.cleanup(); }
  });
});
