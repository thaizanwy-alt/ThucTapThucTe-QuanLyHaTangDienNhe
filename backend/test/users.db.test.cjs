// End-to-end account contract on a disposable PostgreSQL database only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { dataSource: localSource } = require('../dist/database/data-source.js');
const { barrierClient, verifyBarrier, releaseBarrier, closeBarrier } = require('./user-race-locks.cjs');

const password = () => randomBytes(30).toString('base64url');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const disposableDatabaseName = /^users_test_[0-9a-f]{32}$/;
const identitySql = `SELECT current_database() AS database, current_user AS current_user,
  (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner`;

async function bounded(work, ms, label) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out during ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function requestTracker() {
  const pending = new Set();
  return {
    fetch(url, options) {
      const controller = new AbortController();
      const entry = { controller };
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      entry.done = fetch(url, { ...options, signal }).finally(() => pending.delete(entry));
      // A barrier assertion can fail before the test reaches the request await.
      void entry.done.catch(() => undefined);
      pending.add(entry);
      return entry.done;
    },
    async drain() {
      const entries = [...pending];
      const settled = Promise.allSettled(entries.map(entry => entry.done));
      try { await bounded(settled, 6000, 'in-flight requests'); }
      catch (error) {
        for (const entry of entries) entry.controller.abort();
        await bounded(settled, 2000, 'aborted requests');
      }
    },
  };
}

async function assertOwnedDisposableDatabase(client, database, created) {
  if (!created || !disposableDatabaseName.test(database) || database === localSource.options.database) {
    throw new Error('Refusing database operation: target is not this test\'s disposable database');
  }
  const result = await client.query(identitySql);
  const identity = result.rows?.[0] ?? result[0];
  if (identity.database !== database || identity.owner !== identity.current_user) {
    throw new Error('Refusing database operation: connected database is not owned disposable test DB');
  }
}

async function runDisposableDdl(client, database, created, sql) {
  await assertOwnedDisposableDatabase(client, database, created);
  return client.query(sql);
}

async function runDisposableMigration(db, database, created, operation) {
  await assertOwnedDisposableDatabase(db, database, created);
  return operation();
}

test('account DB harness refuses DDL when its client points at the local database', async () => {
  const calls = [];
  const wrongClient = { query: async sql => {
    calls.push(sql);
    return { rows: [{ database: localSource.options.database, current_user: 'test-role', owner: 'test-role' }] };
  } };
  await assert.rejects(
    runDisposableDdl(wrongClient, 'users_test_0123456789abcdef0123456789abcdef', true, 'CREATE FUNCTION should_not_run() RETURNS void LANGUAGE sql AS $$ SELECT $$'),
    /not owned disposable test DB/,
  );
  assert.equal(calls.length, 1, 'only the read-only identity check may be sent to the wrong connection');
  assert.equal(calls.some(sql => /CREATE\s+(FUNCTION|TRIGGER|TABLE|INDEX)/i.test(sql)), false);
  await assert.rejects(
    runDisposableDdl(wrongClient, localSource.options.database, true, 'CREATE FUNCTION should_not_run() RETURNS void LANGUAGE sql AS $$ SELECT $$'),
    /not this test's disposable database/,
  );
  assert.equal(calls.length, 1, 'a local DB name is rejected before making any query');
});

test('User management PostgreSQL migrations, HTTP auth, revocation and assignment races', { timeout: 180000 }, async t => {
  const database = 'users_test_' + randomUUID().replaceAll('-', '');
  const options = localSource.options;
  const admin = new Client({ host: options.host, port: options.port, user: options.username, password: options.password, database: options.database, connectionTimeoutMillis: 5000, statement_timeout: 10000, lock_timeout: 8000 });
  const db = new DataSource({ ...options, database, extra: { ...options.extra, statement_timeout: 10000, lock_timeout: 8000 } });
  const oldDbName = process.env.DB_NAME, oldJwtSecret = process.env.JWT_SECRET;
  const oldPgOptions = process.env.PGOPTIONS, oldPgAppName = process.env.PGAPPNAME;
  let created = false, app, testAdmin, raceLocker, testFailure, testAdminHandle, raceLockerHandle;
  const requests = requestTracker();
  const envForSeed = (managerPassword, technicianPassword) => ({
    ...process.env, DB_HOST: String(options.host), DB_PORT: String(options.port), DB_USER: String(options.username),
    DB_PASSWORD: String(options.password ?? ''), DB_NAME: database,
    DEMO_MANAGER_EMAIL: `manager-${database}@example.invalid`, DEMO_MANAGER_PASSWORD: managerPassword,
    DEMO_TECHNICIAN_EMAIL: `technician-${database}@example.invalid`, DEMO_TECHNICIAN_PASSWORD: technicianPassword,
  });

  try {
    process.env.PGOPTIONS = `${oldPgOptions ?? ''} -c statement_timeout=10000 -c lock_timeout=8000`;
    process.env.PGAPPNAME = `user-race-${database}`;
    await admin.connect();
    assert.match(database, disposableDatabaseName);
    assert.notEqual(database, options.database, 'test DB must never be the configured application DB');
    const controlIdentity = (await admin.query('SELECT current_database() AS database, current_user AS current_user')).rows[0];
    assert.equal(controlIdentity.database, options.database, 'database creation connection must be explicitly the configured control DB');
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    created = true;
    testAdminHandle = barrierClient({ host: options.host, port: options.port, user: options.username, password: options.password, database });
    testAdmin = testAdminHandle.client;
    await testAdminHandle.connect();
    await verifyBarrier(testAdminHandle, database, created, options.database);
    await assertOwnedDisposableDatabase(testAdmin, database, created);
    await db.initialize();
    assert.equal(db.options.database, database, 'TypeORM DataSource must target the disposable DB');
    await assertOwnedDisposableDatabase(db, database, created);
    assert.equal(db.options.synchronize, false);
    await runDisposableMigration(db, database, created, () => db.runMigrations());
    assert.equal(await db.showMigrations(), false);

    const legacyHash = randomBytes(32).toString('hex');
    const legacyId = (await db.query(
      `INSERT INTO users(email,password_hash,role,is_active) VALUES($1,$2,'TECHNICIAN',false) RETURNING id`,
      [`legacy-${database}@example.invalid`, legacyHash],
    ))[0].id;
    await runDisposableMigration(db, database, created, () => db.undoLastMigration());
    assert.equal(await db.showMigrations(), true, 'only the new account security migration should be pending');
    const oldFields = (await db.query('SELECT email,password_hash,role,is_active FROM users WHERE id=$1', [legacyId]))[0];
    assert.equal(oldFields.password_hash, legacyHash);
    assert.equal(oldFields.role, 'TECHNICIAN');
    assert.equal(oldFields.is_active, false);
    await runDisposableMigration(db, database, created, () => db.runMigrations());
    const afterMigration = (await db.query('SELECT email,password_hash,role,is_active,must_change_password,auth_version,version FROM users WHERE id=$1', [legacyId]))[0];
    assert.deepEqual([afterMigration.email, afterMigration.password_hash, afterMigration.role, afterMigration.is_active],
      [oldFields.email, oldFields.password_hash, oldFields.role, oldFields.is_active]);
    assert.deepEqual([afterMigration.must_change_password, afterMigration.auth_version, afterMigration.version], [false, 0, 1]);

    const seedManagerPassword = password(), seedTechPassword = password(), rotatedSeedPassword = password();
    const seedPath = require('node:path').join(__dirname, '../dist/database/seed.js');
    const runSeed = env => execFileSync(process.execPath, [seedPath], { env, stdio: 'pipe', timeout: 30000 }).toString();
    runSeed(envForSeed(seedManagerPassword, seedTechPassword));
    const seedTech = (await db.query('SELECT * FROM users WHERE email=$1', [`technician-${database}@example.invalid`]))[0];
    assert.equal(seedTech.auth_version, 0);
    runSeed(envForSeed(seedManagerPassword, seedTechPassword));
    assert.equal((await db.query('SELECT auth_version FROM users WHERE id=$1', [seedTech.id]))[0].auth_version, 0);
    runSeed(envForSeed(seedManagerPassword, rotatedSeedPassword));
    const rotatedSeed = (await db.query('SELECT auth_version,version,is_active,role FROM users WHERE id=$1', [seedTech.id]))[0];
    assert.deepEqual([rotatedSeed.auth_version, rotatedSeed.version, rotatedSeed.is_active, rotatedSeed.role], [1, 2, true, 'TECHNICIAN']);
    assert.equal(await db.showMigrations(), false);

    process.env.DB_NAME = database;
    process.env.JWT_SECRET = randomBytes(48).toString('hex');
    const { NestFactory } = require('@nestjs/core');
    const { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = require('../dist/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    assert.equal(app.get(DataSource).options.database, database);
    const [startup] = await app.get(DataSource).query(`SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock`);
    assert.equal(startup.statement, '10s'); assert.equal(startup.lock, '8s');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const call = (path, { token, method = 'GET', body, signal } = {}) => requests.fetch(base + path, {
      method, signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const read = async response => response.status === 204 ? null : response.json();
    const login = async (email, pass) => {
      const response = await call('/auth/login', { method: 'POST', body: { email, password: pass } });
      return { response, value: await read(response) };
    };

    const managerEmail = `manager-${database}@example.invalid`;
    const techEmail = `technician-${database}@example.invalid`;
    const managerLogin = await login(managerEmail, seedManagerPassword);
    assert.equal(managerLogin.response.status, 201);
    const managerToken = managerLogin.value.accessToken;
    const managerMeResponse = await call('/auth/me', { token: managerToken });
    const managerMe = await read(managerMeResponse);
    assert.equal(managerMeResponse.status, 200);
    assert.equal(managerMe.mustChangePassword, false);
    assert.equal((await call('/users/technicians', { token: managerToken })).status, 200);
    const oldList = await read(await call('/users/technicians', { token: managerToken }));
    assert.ok(oldList.every(item => Object.keys(item).sort().join(',') === 'email,id'));
    assert.equal((await call('/users/technicians/manage', { token: managerToken })).status, 200);
    assert.equal((await call('/users/technicians/manage')).status, 401);
    const legacyJwt = app.get(require('@nestjs/jwt').JwtService).sign({ sub: managerMe.id });
    assert.equal((await call('/auth/me', { token: legacyJwt })).status, 401, 'JWT without authVersion is rejected');

    const initialTemp = password(), resetTemp = password(), selfPassword = password(), laterReset = password();
    const newEmail = `new-${database}@example.invalid`;
    const createdUserResponse = await call('/users/technicians', {
      token: managerToken, method: 'POST', body: { email: newEmail, temporaryPassword: initialTemp, role: 'MANAGER', isActive: false },
    });
    assert.equal(createdUserResponse.status, 201);
    const createdUser = await read(createdUserResponse);
    assert.equal(createdUser.role, 'TECHNICIAN');
    assert.equal(createdUser.isActive, true);
    assert.equal(createdUser.mustChangePassword, true);
    assert.equal(createdUser.version, 1);
    assert.equal(JSON.stringify(createdUser).includes(initialTemp), false);
    assert.equal(JSON.stringify(createdUser).includes('passwordHash'), false);
    assert.deepEqual(Object.keys(createdUser).sort(), ['email', 'id', 'isActive', 'mustChangePassword', 'role', 'version'].sort());
    assert.equal((await call('/users/technicians', { token: managerToken, method: 'POST', body: { email: newEmail.toUpperCase(), temporaryPassword: password() } })).status, 409);
    assert.equal((await call('/users/technicians', { token: managerToken, method: 'POST', body: { email: `short-${database}@example.invalid`, temporaryPassword: 'short' } })).status, 400);
    assert.equal((await call('/users/technicians', { token: managerToken, method: 'POST', body: { email: `long-${database}@example.invalid`, temporaryPassword: '😀'.repeat(19) } })).status, 400);
    const techLogin0 = await login(newEmail, initialTemp);
    assert.equal(techLogin0.response.status, 201);
    const techToken0 = techLogin0.value.accessToken;
    const techMe0 = await read(await call('/auth/me', { token: techToken0 }));
    assert.equal(techMe0.mustChangePassword, true);
    const forced = await call('/users/technicians/manage', { token: techToken0 });
    assert.equal(forced.status, 403);
    assert.equal((await read(forced)).code, 'PASSWORD_CHANGE_REQUIRED');
    const failedChange = await call('/auth/change-password', { token: techToken0, method: 'POST', body: { expectedVersion: 1, currentPassword: password(), newPassword: selfPassword } });
    assert.equal(failedChange.status, 401);

    const projectCode = `USER-MGMT-${randomBytes(4).toString('hex').toUpperCase()}`;
    const project = (await db.query('INSERT INTO projects(code,name) VALUES($1,$1) RETURNING id', [projectCode]))[0];
    const system = (await db.query(`INSERT INTO project_systems(project_id,code,name,category) VALUES($1,'LAN','LAN','LAN') RETURNING id`, [project.id]))[0];
    const template = (await db.query(`INSERT INTO checklist_templates(code,name,category,revision) VALUES($1,'Fixture','LAN',1) RETURNING id`, [`TM-${projectCode}`]))[0];
    const inspection = (await db.query(`INSERT INTO project_inspections(project_id,system_id,code,title,template_id,template_revision,created_by_id) VALUES($1,$2,$3,'Fixture',$4,1,$5) RETURNING id`, [project.id, system.id, `IN-${projectCode}`, template.id, managerMe.id]))[0];
    await db.query(`INSERT INTO inspection_items(project_id,inspection_id,code,title,sort_order) VALUES($1,$2,'ITEM','Fixture',0) RETURNING id`, [project.id, inspection.id]);
    const item = (await db.query('SELECT id FROM inspection_items WHERE project_id=$1 AND inspection_id=$2', [project.id, inspection.id]))[0];
    const issue = (await db.query(`INSERT INTO remediation_issues(project_id,item_id,description,assignee_id) VALUES($1,$2,'Open issue',$3) RETURNING id`, [project.id, item.id, createdUser.id]))[0];

    // Exercise both linearization orders for Issue reassignment versus account
    // deactivation. PostgreSQL row/advisory locks provide barriers; no timing sleeps.
    raceLockerHandle = barrierClient({ host: options.host, port: options.port, user: options.username, password: options.password, database });
    raceLocker = raceLockerHandle.client;
    await raceLockerHandle.connect();
    await verifyBarrier(raceLockerHandle, database, created, options.database);
    const createIssueRace = async tag => {
      const pair = await db.query(`INSERT INTO users(email,password_hash,role,is_active) VALUES
        ($1,$3,'TECHNICIAN',true),($2,$3,'TECHNICIAN',true) RETURNING id,email`,
      [`${tag}-a-${database}@example.invalid`, `${tag}-b-${database}@example.invalid`, randomBytes(32).toString('hex')]);
      const a = pair.find(user => user.email.startsWith(`${tag}-a-`));
      const b = pair.find(user => user.email.startsWith(`${tag}-b-`));
      const raceItem = (await db.query(`INSERT INTO inspection_items(project_id,inspection_id,code,title,sort_order)
        VALUES($1,$2,$3,'Race item',10) RETURNING id`, [project.id, inspection.id, `ITEM-${tag.replaceAll('-', '').toUpperCase()}`]))[0];
      const raceIssue = (await db.query(`INSERT INTO remediation_issues(project_id,item_id,description,assignee_id)
        VALUES($1,$2,'Race issue',$3) RETURNING id`, [project.id, raceItem.id, a.id]))[0];
      return { a, b, issueId: raceIssue.id };
    };
    const monitorBlocked = async (minimum, blockerPid) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const rows = (await testAdmin.query(`SELECT pid,query,wait_event_type,pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [database])).rows;
        const waiting = rows.filter(row => row.wait_event_type === 'Lock'
          && row.blockers.length > 0
          && (blockerPid === undefined || row.blockers.some(pid => Number(pid) === Number(blockerPid)))
          && row.query.toLowerCase().includes('users'));
        if (waiting.length >= minimum) return waiting;
        await pause(20);
      }
      throw new Error(`Timed out waiting for ${minimum} account-lock waiters`);
    };
    const issuePath = `/projects/${project.id}/issues`;
    const assignIssueRequest = (fixture, managerBearer) => call(`${issuePath}/${fixture.issueId}/assignee`, {
      token: managerBearer, method: 'PATCH', body: { expectedVersion: 1, assigneeId: fixture.b.id },
    });
    const deactivateRequest = (id, managerBearer) => call(`/users/technicians/${id}/status`, {
      token: managerBearer, method: 'PATCH', body: { expectedVersion: 1, isActive: false },
    });
    const barrierKey = [180317, 42];
    const raceFixtures = [await createIssueRace('issue-race-af'), await createIssueRace('issue-race-bf')];
    const raceIds = raceFixtures.map(fixture => fixture.issueId);
    await runDisposableDdl(testAdmin, database, created, `CREATE FUNCTION test_pause_issue_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id IN (${raceIds.map(id => `'${id}'::uuid`).join(',')}) AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        PERFORM pg_advisory_xact_lock(${barrierKey[0]},${barrierKey[1]});
      END IF; RETURN NEW; END $$`);
    await runDisposableDdl(testAdmin, database, created, 'CREATE TRIGGER test_pause_issue_reassignment BEFORE UPDATE ON remediation_issues FOR EACH ROW EXECUTE FUNCTION test_pause_issue_reassignment()');

    // Assignment gets the User pair and Issue path first; deactivation must queue on
    // whichever assignee it targets. Releasing the advisory barrier linearizes assignment first.
    const assignmentBarrierPid = (await testAdmin.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    for (const [index, fixture] of raceFixtures.entries()) {
      let advisoryAttempted = false, raceFailure;
      try {
      advisoryAttempted = true;
      await testAdmin.query('SELECT pg_advisory_lock($1,$2)', barrierKey);
      const assignment = assignIssueRequest(fixture, managerToken);
      const issueWaitDeadline = Date.now() + 8000;
      let assignmentPid;
      while (Date.now() < issueWaitDeadline) {
        const rows = (await testAdmin.query(`SELECT pid,wait_event_type,pg_blocking_pids(pid) AS blockers,query FROM pg_stat_activity WHERE datname=$1`, [database])).rows;
        const blocked = rows.find(row => row.wait_event_type === 'Lock' && row.query.toLowerCase().includes('remediation_issues')
          && row.blockers.some(pid => Number(pid) === Number(assignmentBarrierPid)));
        if (blocked) { assignmentPid = blocked.pid; break; }
        await pause(20);
      }
      assert.ok(assignmentPid, 'assignment must reach the controlled Issue update barrier');
      const target = index === 0 ? fixture.a : fixture.b;
      const deactivation = deactivateRequest(target.id, managerToken);
      await monitorBlocked(1, assignmentPid);
      await testAdmin.query('SELECT pg_advisory_unlock($1,$2)', barrierKey);
      advisoryAttempted = false;
      const [assigned, deactivated] = await Promise.all([assignment, deactivation]);
      assert.equal(assigned.status, 200);
      assert.equal(deactivated.status, index === 0 ? 200 : 409);
      if (deactivated.status === 409) {
        const conflict = await deactivated.json();
        assert.equal(conflict.code, 'TECHNICIAN_HAS_OPEN_WORK');
        assert.equal(conflict.details.issueCount, 1);
      }
      const state = (await db.query(`SELECT i.assignee_id,u.is_active,i.version,u.version AS user_version
        FROM remediation_issues i JOIN users u ON u.id=i.assignee_id WHERE i.id=$1`, [fixture.issueId]))[0];
      assert.equal(state.assignee_id, fixture.b.id);
      assert.equal(state.is_active, true, 'an open Issue must never end assigned to an inactive User');
      assert.equal(state.version, 2);
      assert.equal(state.user_version, 1);
      const accountA = (await db.query('SELECT is_active,version FROM users WHERE id=$1', [fixture.a.id]))[0];
      assert.equal(accountA.is_active, index === 0 ? false : true);
      assert.equal(accountA.version, index === 0 ? 2 : 1);
      } catch (error) { raceFailure = error; throw error; }
      finally {
        try {
          if (advisoryAttempted) {
            const result = await releaseBarrier(testAdminHandle, 'SELECT pg_advisory_unlock_all()');
            if (result.forced && !raceFailure) throw result.cause;
          }
          await requests.drain();
        } catch (error) {
          if (raceFailure) raceFailure.cleanupFailure = error.message; else throw error;
        }
      }
    }

    // Use fresh Issues/accounts for the opposite order; the first loop intentionally
    // changes both assignee and version and must not leak state into this scenario.
    const deactivationFirstFixtures = [await createIssueRace('issue-race-cf'), await createIssueRace('issue-race-df')];

    // Deactivation queues first on a row lock held by the independent locker connection.
    // Assignment queues behind it; releasing the lock yields deactivation-first serial order.
    for (const [index, fixture] of deactivationFirstFixtures.entries()) {
      let transactionAttempted = false, raceFailure;
      try {
      transactionAttempted = true;
      await raceLocker.query('BEGIN');
      await raceLocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [index === 0 ? fixture.a.id : fixture.b.id]);
      const blockerPid = (await raceLocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const target = index === 0 ? fixture.a : fixture.b;
      const deactivation = deactivateRequest(target.id, managerToken);
      await monitorBlocked(1, blockerPid);
      const assignment = assignIssueRequest(fixture, managerToken);
      await monitorBlocked(2);
      await raceLocker.query('COMMIT');
      transactionAttempted = false;
      const [deactivated, assigned] = await Promise.all([deactivation, assignment]);
      assert.equal(deactivated.status, index === 0 ? 409 : 200);
      assert.equal(assigned.status, index === 0 ? 200 : 409);
      if (deactivated.status === 409) {
        const conflict = await deactivated.json();
        assert.equal(conflict.code, 'TECHNICIAN_HAS_OPEN_WORK');
        assert.equal(conflict.details.issueCount, 1);
      }
      if (assigned.status === 409) {
        const conflict = await assigned.json();
        assert.match(conflict.message, /Assignee must be an active technician/);
      }
      const state = (await db.query(`SELECT i.assignee_id,u.is_active,i.version FROM remediation_issues i
        JOIN users u ON u.id=i.assignee_id WHERE i.id=$1`, [fixture.issueId]))[0];
      assert.equal(state.assignee_id, index === 0 ? fixture.b.id : fixture.a.id);
      assert.equal(state.is_active, true);
      assert.equal(state.version, index === 0 ? 2 : 1);
      const accounts = await db.query('SELECT id,is_active,version FROM users WHERE id = ANY($1::uuid[])', [[fixture.a.id, fixture.b.id]]);
      assert.equal(accounts.find(row => row.id === target.id).is_active, index === 0 ? true : false);
      assert.equal(accounts.find(row => row.id === target.id).version, index === 0 ? 1 : 2);
      if (index === 0) assert.equal((await db.query('SELECT count(*)::int AS count FROM remediation_issues WHERE assignee_id=$1 AND status<>\'CLOSED\'', [fixture.a.id]))[0].count, 0);
      } catch (error) { raceFailure = error; throw error; }
      finally {
        try {
          if (transactionAttempted) {
            const result = await releaseBarrier(raceLockerHandle, 'ROLLBACK');
            if (result.forced && !raceFailure) throw result.cause;
          }
          await requests.drain();
        } catch (error) {
          if (raceFailure) raceFailure.cleanupFailure = error.message; else throw error;
        }
      }
    }
    await runDisposableDdl(testAdmin, database, created, 'DROP TRIGGER test_pause_issue_reassignment ON remediation_issues');
    await runDisposableDdl(testAdmin, database, created, 'DROP FUNCTION test_pause_issue_reassignment()');

    // Reset obtains User FOR UPDATE, then its UPDATE trigger holds the lock. Start the
    // competing self-change only after PostgreSQL confirms that point in the request.
    await runDisposableDdl(testAdmin, database, created, `CREATE FUNCTION test_pause_user_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${createdUser.id}'::uuid THEN PERFORM pg_sleep(1.0); END IF; RETURN NEW; END $$`);
    await runDisposableDdl(testAdmin, database, created, 'CREATE TRIGGER test_pause_user_update BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION test_pause_user_update()');
    const resetFirstPromise = call(`/users/technicians/${createdUser.id}/password-reset`, { token: managerToken, method: 'POST', body: { expectedVersion: 1, temporaryPassword: resetTemp } });
    await waitForActivity(testAdmin, database, row => row.wait_event === 'PgSleep' && row.query.toLowerCase().includes('users'));
    const competingChangePromise = call('/auth/change-password', { token: techToken0, method: 'POST', body: { expectedVersion: 1, currentPassword: initialTemp, newPassword: selfPassword } });
    await waitForBlockingUserUpdate(testAdmin, database);
    const resetFirst = await resetFirstPromise;
    const competingChange = await competingChangePromise;
    assert.equal(resetFirst.status, 201);
    assert.equal(competingChange.status, 401);
    const afterReset = await read(await call('/users/technicians/manage', { token: managerToken }));
    const currentAfterReset = afterReset.find(user => user.id === createdUser.id);
    assert.equal(currentAfterReset.version, 2);
    assert.equal(currentAfterReset.mustChangePassword, true);
    assert.equal(currentAfterReset.isActive, true);
    assert.equal((await call('/auth/me', { token: techToken0 })).status, 401);

    const techLogin1 = await login(newEmail, resetTemp);
    assert.equal(techLogin1.response.status, 201);
    const techToken1 = techLogin1.value.accessToken;
    const selfChangeFirstPromise = call('/auth/change-password', { token: techToken1, method: 'POST', body: { expectedVersion: 2, currentPassword: resetTemp, newPassword: selfPassword } });
    await waitForActivity(testAdmin, database, row => row.wait_event === 'PgSleep' && row.query.toLowerCase().includes('users'));
    const staleResetPromise = call(`/users/technicians/${createdUser.id}/password-reset`, { token: managerToken, method: 'POST', body: { expectedVersion: 2, temporaryPassword: laterReset } });
    await waitForBlockingUserUpdate(testAdmin, database);
    const selfChangeFirst = await selfChangeFirstPromise;
    const staleReset = await staleResetPromise;
    assert.equal(selfChangeFirst.status, 204);
    assert.equal(staleReset.status, 409);
    await runDisposableDdl(testAdmin, database, created, 'DROP TRIGGER test_pause_user_update ON users');
    await runDisposableDdl(testAdmin, database, created, 'DROP FUNCTION test_pause_user_update()');
    const changedLogin = await login(newEmail, selfPassword);
    assert.equal(changedLogin.response.status, 201);
    const techToken2 = changedLogin.value.accessToken;
    const afterChange = (await read(await call('/users/technicians/manage', { token: managerToken }))).find(user => user.id === createdUser.id);
    assert.equal(afterChange.version, 3);
    assert.equal(afterChange.mustChangePassword, false);

    // Task assignment takes the same User lock before INSERT; deactivation waits and
    // then observes the committed assignment instead of racing past it.
    await runDisposableDdl(testAdmin, database, created, `CREATE FUNCTION test_pause_task_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.assignee_id = '${createdUser.id}'::uuid THEN PERFORM pg_sleep(1.0); END IF; RETURN NEW; END $$`);
    await runDisposableDdl(testAdmin, database, created, 'CREATE TRIGGER test_pause_task_insert BEFORE INSERT ON project_tasks FOR EACH ROW EXECUTE FUNCTION test_pause_task_insert()');
    const taskPromise = call(`/projects/${project.id}/tasks`, { token: managerToken, method: 'POST', body: { systemId: system.id, assigneeId: createdUser.id, code: 'USER-RACE-TASK', title: 'Race fixture' } });
    await waitForActivity(testAdmin, database, row => row.query.includes('INSERT INTO "project_tasks"') && row.wait_event === 'PgSleep');
    const deactivatePromise = call(`/users/technicians/${createdUser.id}/status`, { token: managerToken, method: 'PATCH', body: { expectedVersion: 3, isActive: false } });
    await waitForBlockingUserUpdate(testAdmin, database);
    const taskResponse = await taskPromise;
    const deactivateResponse = await deactivatePromise;
    assert.equal(taskResponse.status, 201);
    assert.equal(deactivateResponse.status, 409);
    const conflict = await read(deactivateResponse);
    assert.equal(conflict.code, 'TECHNICIAN_HAS_OPEN_WORK');
    assert.equal(conflict.details.taskCount, 1);
    assert.equal(conflict.details.issueCount, 1);
    assert.equal(conflict.details.tasks[0].code, 'USER-RACE-TASK');
    assert.deepEqual(conflict.details.issues.map(value => value.id), [issue.id]);
    assert.equal(JSON.stringify(conflict).includes('passwordHash'), false);
    await runDisposableDdl(testAdmin, database, created, 'DROP TRIGGER test_pause_task_insert ON project_tasks');
    await runDisposableDdl(testAdmin, database, created, 'DROP FUNCTION test_pause_task_insert()');
    assert.equal((await call('/auth/me', { token: techToken2 })).status, 200);

    // The open-work conflict did not change the version. Close only the disposable
    // fixtures, then exercise status invalidation, no-op and inactive reset behavior.
    await db.query(`UPDATE project_tasks SET status='APPROVED',completion_note='done',submitted_at=now(),reviewed_by_id=$1,reviewed_at=now() WHERE code='USER-RACE-TASK'`, [managerMe.id]);
    await db.query(`UPDATE remediation_issues SET status='CLOSED',resolution_note='fixed',resolved_at=now(),reviewed_by_id=$1,reviewed_at=now() WHERE id=$2`, [managerMe.id, issue.id]);
    const deactivate = await call(`/users/technicians/${createdUser.id}/status`, { token: managerToken, method: 'PATCH', body: { expectedVersion: 3, isActive: false } });
    assert.equal(deactivate.status, 200);
    assert.equal((await read(deactivate)).version, 4);
    assert.equal((await call('/auth/me', { token: techToken2 })).status, 401);
    assert.equal((await login(newEmail, selfPassword)).response.status, 401);
    const resetInactive = await call(`/users/technicians/${createdUser.id}/password-reset`, { token: managerToken, method: 'POST', body: { expectedVersion: 4, temporaryPassword: laterReset } });
    assert.equal(resetInactive.status, 201);
    const inactiveReset = await read(resetInactive);
    assert.equal(inactiveReset.isActive, false, 'password reset must not reactivate an inactive user');
    assert.equal(inactiveReset.mustChangePassword, true);
    const activate = await call(`/users/technicians/${createdUser.id}/status`, { token: managerToken, method: 'PATCH', body: { expectedVersion: 5, isActive: true } });
    assert.equal(activate.status, 200);
    const activated = await read(activate);
    assert.equal(activated.version, 6);
    const newLogin = await login(newEmail, laterReset);
    assert.equal(newLogin.response.status, 201);
    const finalToken = newLogin.value.accessToken;
    const noOp = await call(`/users/technicians/${createdUser.id}/status`, { token: managerToken, method: 'PATCH', body: { expectedVersion: 6, isActive: true } });
    assert.equal(noOp.status, 200);
    assert.equal((await read(noOp)).version, 6);
    assert.equal((await call('/auth/me', { token: finalToken })).status, 200, 'status no-op does not revoke a valid token');
    const blockedAgain = await call('/users/technicians/manage', { token: finalToken });
    assert.equal(blockedAgain.status, 403);
    assert.equal((await read(blockedAgain)).code, 'PASSWORD_CHANGE_REQUIRED');
    const finalChange = await call('/auth/change-password', { token: finalToken, method: 'POST', body: { expectedVersion: 6, currentPassword: laterReset, newPassword: initialTemp } });
    assert.equal(finalChange.status, 204);
    assert.equal((await call('/auth/me', { token: finalToken })).status, 401);
    const finalLogin = await login(newEmail, initialTemp);
    assert.equal(finalLogin.response.status, 201);
    assert.equal((await call('/users/technicians/manage', { token: finalLogin.value.accessToken })).status, 403, 'technician cannot manage accounts');
  } catch (error) { testFailure = error; throw error; }
  finally {
    let cleanupFailure;
    try {
      // If a barrier cannot be confirmed closed, fail here. Never advance to
      // app.close/pool teardown on the strength of a timer alone.
      for (const [handle, sql] of [[raceLockerHandle, 'ROLLBACK'], [testAdminHandle, 'SELECT pg_advisory_unlock_all()']]) {
        try { if (handle?.verified && !handle.socketClosed) await releaseBarrier(handle, sql); }
        finally { await closeBarrier(handle); }
      }
      await requests.drain();
      await waitForTestSessions(admin, database, true);
      if (app) await bounded(app.close(), 10000, 'Nest close (supervisor required if unconfirmed)');
      if (db.isInitialized) await bounded(db.destroy(), 10000, 'fixture pool close (supervisor required if unconfirmed)');
      if (created) {
        await waitForTestSessions(admin, database, false);
        await assertDisposableCatalog(admin, database, options.database);
        await admin.query(`DROP DATABASE "${database}"`);
        assert.equal((await admin.query('SELECT count(*)::int AS count FROM pg_database WHERE datname=$1', [database])).rows[0].count, 0);
      }
    } catch (error) { cleanupFailure = error; }
    finally {
      try { await admin.end(); } catch (error) { cleanupFailure ??= error; }
      if (oldDbName === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = oldDbName;
      if (oldJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwtSecret;
      if (oldPgOptions === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = oldPgOptions;
      if (oldPgAppName === undefined) delete process.env.PGAPPNAME; else process.env.PGAPPNAME = oldPgAppName;
    }
    if (cleanupFailure) {
      if (testFailure) testFailure.cleanupFailure = cleanupFailure.message;
      else throw cleanupFailure;
    }
  }
});

async function assertDisposableCatalog(control, database, localDatabase, marker) {
  assert.match(database, disposableDatabaseName);
  assert.notEqual(database, localDatabase);
  const row = (await control.query(`SELECT pg_get_userbyid(datdba) AS owner,current_user AS actor,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1`, [database])).rows[0];
  assert.ok(row, 'owned test database must exist');
  assert.equal(row.owner, row.actor);
  if (marker) assert.equal(row.marker, marker);
}

async function waitForTestSessions(control, database, onlyBusy) {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const rows = (await control.query('SELECT state FROM pg_stat_activity WHERE datname=$1', [database])).rows;
    if (!rows.some(row => !onlyBusy || ['active', 'idle in transaction', 'idle in transaction (aborted)'].includes(row.state))) return;
    await pause(25);
  }
  throw new Error('Disposable sessions did not finish; cleanup unconfirmed, supervisor required');
}

function runCleanupFixture(database, marker, mode, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require('node:path').join(__dirname, 'fixtures/user-race-cleanup.cjs')], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
        DB_HOST: String(options.host), DB_PORT: String(options.port), DB_USER: String(options.username),
        DB_PASSWORD: String(options.password ?? ''), DB_NAME: database,
        USER_RACE_DATABASE: database, USER_RACE_CONTROL_DATABASE: String(options.database),
        USER_RACE_MARKER: marker, USER_RACE_MODE: mode },
    });
    let stdout = '', stderr = '', killed = false, stdoutClosed = false, stderrClosed = false, killWatch;
    let timer = setTimeout(stop, 15000);
    function stop() {
      if (killed) return;
      killed = true;
      child.kill('SIGKILL'); // Fixture runs directly and never creates a descendant.
      killWatch = setTimeout(() => reject(new Error('Child close unconfirmed; do not clean its database')), 3000);
    }
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (mode === 'process-timeout' && stdout.includes('"stage":"held"')) {
        clearTimeout(timer); timer = setTimeout(stop, 150);
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.once('close', () => { stdoutClosed = true; });
    child.stderr.once('close', () => { stderrClosed = true; });
    child.once('error', error => { clearTimeout(timer); clearTimeout(killWatch); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killWatch);
      resolve({ code, signal, stdout, stderr, killed, stdoutClosed, stderrClosed, closed: true });
    });
  });
}

test('race cleanup handles SQL/close timeout and supervised fixture termination', { timeout: 120000 }, async () => {
  const options = localSource.options;
  const control = new Client({ host: options.host, port: options.port, user: options.username, password: options.password,
    database: options.database, connectionTimeoutMillis: 3000, statement_timeout: 10000, lock_timeout: 8000 });
  let primary;
  try {
    await control.connect();
    for (const mode of ['normal', 'advisory', 'row-lock', 'rollback-timeout', 'close-timeout', 'process-timeout']) {
      const database = 'users_test_' + randomUUID().replaceAll('-', '');
      const marker = 'user-race-cleanup:' + randomUUID();
      let created = false, outcome, failure;
      try {
        assert.match(database, disposableDatabaseName);
        assert.notEqual(database, options.database);
        await control.query(`CREATE DATABASE "${database}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
        created = true;
        await assertDisposableCatalog(control, database, options.database);
        await control.query(`COMMENT ON DATABASE "${database}" IS '${marker}'`);
        outcome = await runCleanupFixture(database, marker, mode, options);
        assert.equal(outcome.closed, true);
        assert.equal(outcome.stdoutClosed, true);
        assert.equal(outcome.stderrClosed, true);
        if (mode === 'process-timeout') {
          assert.equal(outcome.killed, true);
          assert.match(outcome.stdout, /"stage":"held"/);
        } else {
          assert.equal(outcome.killed, false);
          const report = JSON.parse(outcome.stdout.trim().split('\n').at(-1));
          assert.equal(report.cleaned, true);
          assert.equal(report.socketClosed, true);
          assert.equal(report.clientEnded, true);
          assert.equal(report.waiterFinished, true);
          assert.equal(report.forced, ['rollback-timeout', 'close-timeout'].includes(mode));
          assert.equal(outcome.code, ['advisory', 'row-lock'].includes(mode) ? 1 : 0);
          if (['advisory', 'row-lock'].includes(mode)) assert.equal(report.error, `injected ${mode}`);
        }
      } catch (error) { failure = error; throw error; }
      finally {
        // Never DROP while an unconfirmed child or a session may still be live.
        // On supervision failure keep the test DB for diagnosis.
        if (created && outcome?.closed) {
          try {
            await waitForTestSessions(control, database, false);
            await assertDisposableCatalog(control, database, options.database, marker);
            await control.query(`DROP DATABASE "${database}"`);
            assert.equal((await control.query('SELECT count(*)::int AS count FROM pg_database WHERE datname=$1', [database])).rows[0].count, 0);
          } catch (error) { if (failure) failure.cleanupFailure = error.message; else throw error; }
        }
      }
    }
  } catch (error) { primary = error; throw error; }
  finally { try { await control.end(); } catch (error) { if (primary) primary.cleanupFailure = error.message; else throw error; } }
});
async function waitForActivity(admin, database, predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = (await admin.query(`SELECT query,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [database])).rows;
    const found = rows.find(predicate);
    if (found) return found;
    await pause(25);
  }
  const rows = (await admin.query(`SELECT query,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [database])).rows;
  throw new Error(`Timed out waiting for PostgreSQL activity: ${JSON.stringify(rows)}`);
}

async function waitForBlockingUserUpdate(admin, database) {
  return waitForActivity(admin, database, row => row.wait_event_type === 'Lock' && row.blockers.length > 0 && row.query.toLowerCase().includes('users'));
}
