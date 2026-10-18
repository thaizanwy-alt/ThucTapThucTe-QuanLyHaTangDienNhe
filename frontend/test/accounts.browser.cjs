// Optional portable Chrome smoke. No dependency is installed by this test.
// Default: mounted App with intercepted API. ACCOUNT_REAL_SMOKE=1: local API,
// creates one uniquely named TECHNICIAN, leaves it inactive, never changes demo users.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const web = process.env.ACCOUNT_WEB_URL || 'http://localhost:5173';
const api = process.env.ACCOUNT_API_URL || 'http://localhost:3000';
const real = process.env.ACCOUNT_REAL_SMOKE === '1';
const password = () => randomBytes(24).toString('base64url');
const stage = name => console.log('Account smoke: ' + name);
function mockOrigins() {
  if (real) return null;
  const apiOrigin = new URL(api).origin, webOrigin = new URL(web).origin;
  if (apiOrigin === webOrigin) throw new Error('Mock mode does not support ACCOUNT_API_URL and ACCOUNT_WEB_URL with the same origin.');
  return { apiOrigin, webOrigin };
}
async function run() {
  const origins = mockOrigins();
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
    const errors = []; page.on('pageerror', () => errors.push('browser error'));
    const button = name => page.getByRole('button', { name, exact: true });
    const login = async (email, pass) => {
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(pass);
      await button('Đăng nhập').click();
    };
    if (!real) {
      stage('intercepted API / mounted React');
      const manager = { id: 'manager', email: 'manager@example.invalid', role: 'MANAGER', isActive: true, mustChangePassword: false, version: 1 };
      let current = manager, rows = [], posts = 0, failGet = false, stale = false, openWork = false, forced = false, writes = [], lateResolve;
      const { apiOrigin, webOrigin } = origins;
      const unexpectedApiRequests = [], blockedOrigins = [];
      let holdGet = false, businessCalls = 0, projectRows = [], holdArea = false, releaseArea, areaEnteredResolve, failNextArea = false, holdMe = false, releaseMe;
      const sharedToken = ['fixture', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
      const token = () => sharedToken;
      const waitUntil = async (predicate, label) => {
        const deadline = Date.now() + 5000;
        while (!predicate()) { if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 10)); }
      };
      const waitSignal = async (promise, label) => {
        let timer;
        try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000); })]); }
        finally { clearTimeout(timer); }
      };
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method();
        if (url.origin !== apiOrigin) {
          if (url.origin === webOrigin) return route.continue();
          blockedOrigins.push(`${method} ${url.origin}${p}`);
          return route.abort('blockedbyclient');
        }
        const json = (status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
        const areaMatch = p.match(/^\/projects\/[^/]+\/areas$/);
        const systemMatch = p.match(/^\/projects\/[^/]+\/systems$/);
        const summaryMatch = p.match(/^\/projects\/([^/]+)\/summary$/);
        const resetMatch = p.match(/^\/users\/technicians\/[^/]+\/password-reset$/);
        const statusMatch = p.match(/^\/users\/technicians\/[^/]+\/status$/);
        const knownPath = p === '/auth/login' || p === '/auth/me' || p === '/auth/change-password'
          || p === '/projects' || Boolean(areaMatch || systemMatch || summaryMatch)
          || p === '/users/technicians/manage' || p === '/users/technicians' || Boolean(resetMatch || statusMatch);
        if (method === 'OPTIONS' && knownPath) return route.fulfill({ status: 204, headers: {
          'Access-Control-Allow-Origin': webOrigin, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '0',
        } });
        const knownMethod = method === 'POST' && (p === '/auth/login' || p === '/auth/change-password' || p === '/users/technicians' || Boolean(resetMatch))
          || method === 'GET' && (p === '/auth/me' || p === '/projects' || Boolean(areaMatch || systemMatch || summaryMatch) || p === '/users/technicians/manage')
          || method === 'PATCH' && Boolean(statusMatch);
        if (!knownMethod) {
          unexpectedApiRequests.push(`${method} ${p}`);
          return json(501, { message: 'Unmocked API endpoint blocked by accounts browser test.' }, {
            'Access-Control-Allow-Origin': webOrigin, 'Access-Control-Expose-Headers': 'X-Accounts-Smoke-Mock',
            'X-Accounts-Smoke-Mock': 'blocked',
          });
        }
        if (method === 'POST' && p === '/auth/login') return json(201, { accessToken: token() });
        if (method === 'GET' && p === '/auth/me') {
          if (holdMe) { holdMe = false; await new Promise(r => { releaseMe = r; }); return json(200, manager); }
          return json(200, current);
        }
        if (method === 'POST' && p === '/auth/change-password') { writes.push(req.postDataJSON()); return stale ? json(409, { code: 'ACCOUNT_VERSION_CONFLICT' }) : route.fulfill({ status: 204 }); }
        if (method === 'GET' && p === '/projects') { businessCalls++; return json(200, projectRows); }
        if (method === 'GET' && areaMatch) {
          if (failNextArea) { failNextArea = false; return json(401, { message: 'current-session 401' }); }
          if (holdArea) { holdArea = false; areaEnteredResolve?.(); await new Promise(r => { releaseArea = r; }); return json(401, { message: 'late old-session 401' }); }
          return json(200, []);
        }
        if (method === 'GET' && systemMatch) return json(200, []);
        if (method === 'GET' && summaryMatch) return json(200, {
          projectId: summaryMatch[1], readAt: new Date().toISOString(), workScope: current.role === 'MANAGER' ? 'PROJECT' : 'ASSIGNED_TO_ME',
          tasks: { total: 0, notApproved: 0, byStatus: { ASSIGNED: 0, IN_PROGRESS: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0 } },
          issues: { total: 0, notClosed: 0, byStatus: { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 } },
          inventory: { devicesTotal: 0, systemsTotal: 0, areas: { total: 0, floor: 0, room: 0 }, racks: { total: 0, main: 0, sub: 0, unclassified: 0 } },
          acceptances: { confirmedCurrent: 0, superseded: 0, ...(current.role === 'MANAGER' ? { draft: 0 } : {}) },
          ...(current.role === 'MANAGER' ? { inspections: { total: 0, passed: 0, notChecked: 0, pendingOrFailed: 0 } } : {}),
        });
        if (method === 'GET' && p === '/users/technicians/manage') {
          if (forced) return json(403, { code: 'PASSWORD_CHANGE_REQUIRED' });
          if (holdGet) { await new Promise(r => { lateResolve = r; }); }
          if (failGet) return json(503, {});
          return json(200, rows);
        }
        writes.push(req.postDataJSON());
        if (method === 'POST' && p === '/users/technicians') {
          posts++; rows = [{ id: 'tech', email: 'fixture@example.invalid', role: 'TECHNICIAN', isActive: true, mustChangePassword: true, version: 1 }]; failGet = true;
          return json(201, rows[0]);
        }
        if (stale) return json(409, { code: 'ACCOUNT_VERSION_CONFLICT' });
        if (openWork) return json(409, { code: 'TECHNICIAN_HAS_OPEN_WORK', details: { taskCount: 1, issueCount: 1, tasks: [{ id: 'task', code: 'TASK-FIXTURE', projectId: 'project', status: 'ASSIGNED' }], issues: [{ id: 'issue', projectId: 'project', status: 'OPEN' }] } });
        return json(201, { ...rows[0], version: 2 });
      });
      await page.addInitScript(() => {
        Object.defineProperty(window, '__authTokenRemovalCount', { value: 0, writable: true });
        const removeItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (key) {
          if (key === 'elv-demo-access-token') window.__authTokenRemovalCount++;
          return removeItem.call(this, key);
        };
      });
      await page.goto(web); stage('mock login'); await login(manager.email, password());
      await button('Quản lý tài khoản').click();
      stage('mock create'); await button('Tạo kỹ thuật viên').click();
      const dialog = page.getByRole('dialog'); const draft = password();
      await dialog.getByLabel('Email', { exact: true }).fill('fixture@example.invalid');
      await dialog.getByLabel('Mật khẩu tạm', { exact: true }).fill(draft);
      await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await dialog.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
      await page.getByText(/Chỉ thử tải lại danh sách/).waitFor();
      assert.equal(await dialog.count(), 0); assert.equal(await page.locator('.account-list').count(), 0);
      stage('mock GET retry'); failGet = false; await button('Tải lại danh sách').click(); await button('Reset mật khẩu').click();
      assert.equal(posts, 1, 'GET retry cannot repeat POST');
      assert.equal(await dialog.getByLabel('Mật khẩu tạm').inputValue(), '');
      await dialog.getByLabel('Mật khẩu tạm').fill(draft); stale = true;
      await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await dialog.getByText(/Tài khoản đã thay đổi/).waitFor();
      assert.equal(await dialog.getByLabel('Mật khẩu tạm').inputValue(), draft, '409 preserves draft');
      assert.equal(await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).isDisabled(), true);
      stale = false; rows[0].version = 2;
      await button('Tải lại phiên bản').click(); await dialog.getByText(/Đã tải phiên bản mới/).waitFor();
      await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await page.locator('.account-list').waitFor(); assert.equal(writes.at(-1).expectedVersion, 2);
      stage('mock open-work'); openWork = true; await button('Vô hiệu hóa').click(); await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await dialog.getByText(/Task TASK-FIXTURE/).waitFor(); await dialog.getByText(/Issue issue/).waitFor();
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      if (process.env.ACCOUNT_ARTIFACT_DIR) await page.screenshot({ path: require('node:path').join(process.env.ACCOUNT_ARTIFACT_DIR, 'accounts-desktop.png'), fullPage: true });
      stage('mock mobile / draft cleanup'); await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await button('Reset mật khẩu').click(); await dialog.getByLabel('Mật khẩu tạm').fill(draft);
      if (process.env.ACCOUNT_ARTIFACT_DIR) await page.screenshot({ path: require('node:path').join(process.env.ACCOUNT_ARTIFACT_DIR, 'accounts-mobile.png'), fullPage: true });
      await page.keyboard.press('Escape');
      assert.equal(await button('Reset mật khẩu').evaluate(el => el === document.activeElement), true, 'Escape restores opener focus');
      await button('Reset mật khẩu').click(); assert.equal(await dialog.getByLabel('Mật khẩu tạm').inputValue(), ''); await page.keyboard.press('Escape');
      await button('Về công trình').click();
      stage('mock late GET'); holdGet = true; await button('Quản lý tài khoản').click();
      await page.getByText('Đang tải tài khoản…').waitFor(); await button('Về công trình').click();
      lateResolve(); await page.waitForTimeout(50);
      assert.equal(await page.locator('.account-list').count(), 0, 'late GET cannot remount account list');
      stage('mock forced change'); holdGet = false; forced = true; await button('Quản lý tài khoản').click();
      await page.getByRole('heading', { name: 'Đổi mật khẩu', exact: true }).waitFor();
      const before = businessCalls; await page.waitForTimeout(50); assert.equal(businessCalls, before);
      assert.equal(await button('Về công trình').count(), 0, 'forced mode has no business navigation');
      await page.getByLabel('Mật khẩu hiện tại').fill(draft); await page.getByLabel('Mật khẩu mới', { exact: true }).fill(draft); await page.getByLabel('Nhập lại mật khẩu mới').fill(draft);
      stale = true; await button('Đổi mật khẩu').click(); await page.getByText(/Tài khoản đã thay đổi/).waitFor();
      assert.equal(await page.getByLabel('Mật khẩu mới', { exact: true }).inputValue(), draft);
      stale = false;
      await button('Đổi mật khẩu').click(); await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('elv-demo-access-token')), null);
      forced = false; current = { ...manager, id: 'tech', role: 'TECHNICIAN', mustChangePassword: true };
      const callsBeforeForcedLogin = businessCalls; await login(current.email, password());
      await page.getByRole('heading', { name: 'Đổi mật khẩu', exact: true }).waitFor();
      assert.equal(businessCalls, callsBeforeForcedLogin, 'forced login must never mount/request business modules');
      assert.equal(await button('Quản lý tài khoản').count(), 0);
      await button('Đăng xuất').click(); current = { ...current, mustChangePassword: false }; await login(current.email, password());
      await button('Đổi mật khẩu').waitFor(); assert.equal(await button('Quản lý tài khoản').count(), 0);
      assert.equal(errors.length, 0); stage('PASS mounted React: permissions, forced-change, 409/draft, open-work, GET retry, late response, focus, 390px');

      // Actual ProjectWorkspace callback regression: retain an Area request from the old
      // mounted workspace, start a new login that deliberately receives the same JWT,
      // then deliver the old 401. The old callback must be bound to the old generation.
      stage('session-generation regression / mounted ProjectWorkspace');
      await button('Đăng xuất').click();
      current = manager;
      projectRows = [{ id: 'project-session-race', code: 'SESSION-RACE', name: 'Session race', address: null, status: 'IN_PROGRESS', description: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
      await login(manager.email, password());
      holdArea = true;
      const areaEntered = new Promise(resolve => { areaEnteredResolve = resolve; });
      await page.getByRole('button', { name: /Session race/ }).click();
      await waitSignal(areaEntered, 'held ProjectWorkspace Area request');
      await waitUntil(() => Boolean(releaseArea), 'held ProjectWorkspace Area request');
      await button('Đăng xuất').click();
      await login(manager.email, password());
      await page.getByRole('button', { name: /Session race/ }).click();
      await page.getByRole('heading', { name: 'Session race', exact: true }).waitFor();
      releaseArea(); releaseArea = null;
      await page.getByRole('button', { name: 'Đăng xuất', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Session race', exact: true }).count(), 1, 'old ProjectWorkspace 401 must not sign out the new session');

      // Also hold an authenticated /me success from the prior session. Its result
      // must not replace the newer technician identity, even with the same JWT text.
      holdMe = true;
      const previousUser = current;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await waitUntil(() => Boolean(releaseMe), 'held old-session /auth/me request');
      await button('Đăng xuất').click();
      current = { id: 'technician-new', email: 'new-tech@example.invalid', role: 'TECHNICIAN', isActive: true, mustChangePassword: false, version: 1 };
      await login(current.email, password());
      await page.getByText('Kỹ thuật viên', { exact: true }).waitFor();
      assert.equal(previousUser.role, 'MANAGER');
      releaseMe(); releaseMe = null;
      await page.getByText('Kỹ thuật viên', { exact: true }).waitFor();
      assert.equal(await button('Quản lý tài khoản').count(), 0, 'late successful /me from old session cannot restore manager');
      assert.equal(await button('Đăng xuất').count(), 1, 'new session remains authenticated after stale success');
      await button('Đăng xuất').click();
      current = manager;
      await login(manager.email, password());
      const tokenRemovalsBeforeCurrent401 = await page.evaluate(() => window.__authTokenRemovalCount);
      failNextArea = true;
      await page.getByRole('button', { name: /Session race/ }).click();
      await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('elv-demo-access-token')), null, 'current-session 401 clears session');
      assert.equal(await page.evaluate(() => window.__authTokenRemovalCount), tokenRemovalsBeforeCurrent401 + 1, 'current-session 401 signs out exactly once');
      const unknownEndpointResult = await page.evaluate(async url => {
        const response = await fetch(url);
        return { status: response.status, marker: response.headers.get('X-Accounts-Smoke-Mock') };
      }, api + '/__accounts-smoke-unknown');
      assert.deepEqual(unknownEndpointResult, { status: 501, marker: 'blocked' }, 'unknown API must be fulfilled by the mock, never forwarded');
      assert.deepEqual(unexpectedApiRequests, ['GET /__accounts-smoke-unknown'], 'unknown API method/path is recorded');
      unexpectedApiRequests.length = 0;
      assert.deepEqual(unexpectedApiRequests, [], `unexpected API requests: ${unexpectedApiRequests.join(', ')}`);
      assert.deepEqual(blockedOrigins, [], `unexpected external origins: ${blockedOrigins.join(', ')}`);
      stage('PASS: identical mocked JWT creates distinct generations; stale ProjectWorkspace 401 ignored; late /me success cannot overwrite User; current 401 clears session');
    } else {
      stage('real API health/auth');
      const fs = require('node:fs'), path = require('node:path');
      const local = require('dotenv').parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
      const { Client } = require('pg');
      const db = new Client({ host: process.env.DB_HOST || local.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || local.DB_PORT || 5432),
        database: process.env.DB_NAME || local.DB_NAME, user: process.env.DB_USER || local.DB_USER, password: process.env.DB_PASSWORD || local.DB_PASSWORD,
        connectionTimeoutMillis: 5000, statement_timeout: 5000 });
      try {
        await db.connect();
        const identity = (await db.query(`SELECT system_identifier::text AS system_id,current_database() AS database,current_setting('port') AS port FROM pg_control_system()`)).rows[0];
        assert.equal(identity.system_id, '7628257575938021648'); assert.equal(identity.database, 'electrical_infrastructure'); assert.equal(identity.port, '55432');
      } finally { await db.end(); }
      const managerEmail = process.env.DEMO_MANAGER_EMAIL || local.DEMO_MANAGER_EMAIL || 'manager.demo@example.local';
      const managerPassword = process.env.DEMO_MANAGER_PASSWORD || local.DEMO_MANAGER_PASSWORD;
      assert.ok(managerPassword, 'Missing local manager credential');
      async function request(token, method, p, body, expected) {
        const r = await fetch(api + p, { method, signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal(r.status, expected, `${method} ${p} HTTP status`); return r.status === 204 ? null : r.json();
      }
      assert.equal((await request(null, 'GET', '/health', null, 200)).database, 'connected');
      const managerToken = (await request(null, 'POST', '/auth/login', { email: managerEmail, password: managerPassword }, 201)).accessToken;
      const before = await request(managerToken, 'GET', '/users/technicians/manage', null, 200);
      const email = process.env.ACCOUNT_FIXTURE_EMAIL || 'accounts-ui-' + randomUUID() + '@example.invalid', temp = password(), reset = password(), changed = password();
      const reuse = process.env.ACCOUNT_FIXTURE_ID;
      if (reuse) {
        assert.match(email, /^accounts-ui-[0-9a-f-]{36}@example\.invalid$/);
        const owned = before.find(r => r.id === reuse && r.email === email);
        assert.ok(owned && owned.role === 'TECHNICIAN' && owned.isActive && owned.mustChangePassword, 'explicit incomplete smoke fixture required');
        await request(managerToken, 'POST', `/users/technicians/${owned.id}/password-reset`, { expectedVersion: owned.version, temporaryPassword: temp }, 201);
      }
      await page.goto(web); await login(managerEmail, managerPassword); stage('real manager list/create'); await button('Quản lý tài khoản').click();
      const dialog = page.getByRole('dialog');
      if (!reuse) {
        await button('Tạo kỹ thuật viên').click();
        await dialog.getByLabel('Email', { exact: true }).fill(email); await dialog.getByLabel('Mật khẩu tạm').fill(temp); await dialog.getByRole('button', { name: 'Tạo tài khoản' }).click();
      }
      await page.getByLabel('Tìm kỹ thuật viên', { exact: true }).fill(email); await page.locator('.account-list h2').filter({ hasText: email }).waitFor();
      const fixtureRow = page.locator('.account-list > li').filter({ hasText: email });
      let row = (await request(managerToken, 'GET', '/users/technicians/manage', null, 200)).find(r => r.email === email); assert.ok(row);
      console.log('Fixture created: ' + email + ' | ' + row.id);
      const first = (await request(null, 'POST', '/auth/login', { email, password: temp }, 201)).accessToken;
      await request(first, 'GET', '/projects', null, 403); await request(first, 'GET', '/auth/me', null, 200);
      stage('real reset/forced password'); await fixtureRow.getByRole('button', { name: 'Reset mật khẩu', exact: true }).click(); await dialog.getByLabel('Mật khẩu tạm').fill(reset); await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' }); await request(first, 'GET', '/auth/me', null, 401);
      await button('Đăng xuất').click(); await login(email, reset);
      await page.getByRole('heading', { name: 'Đổi mật khẩu', exact: true }).waitFor(); assert.equal(await button('Về công trình').count(), 0);
      await page.getByLabel('Mật khẩu hiện tại').fill(reset); await page.getByLabel('Mật khẩu mới', { exact: true }).fill(changed); await page.getByLabel('Nhập lại mật khẩu mới').fill(changed); await button('Đổi mật khẩu').click();
      await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor(); await login(email, changed); await button('Đổi mật khẩu').waitFor(); assert.equal(await button('Quản lý tài khoản').count(), 0);
      const techToken = (await request(null, 'POST', '/auth/login', { email, password: changed }, 201)).accessToken;
      await request(techToken, 'GET', '/users/technicians/manage', null, 403);
      stage('real no-op/stale version/deactivate'); row = (await request(managerToken, 'GET', '/users/technicians/manage', null, 200)).find(r => r.email === email);
      const noop = await request(managerToken, 'PATCH', `/users/technicians/${row.id}/status`, { isActive: true, expectedVersion: row.version }, 200); assert.equal(noop.version, row.version);
      const active = await request(managerToken, 'GET', '/users/technicians', null, 200); assert.ok(active.some(r => r.id === row.id)); assert.ok(active.every(r => Object.keys(r).sort().join(',') === 'email,id'));
      await request(managerToken, 'PATCH', `/users/technicians/${row.id}/status`, { isActive: false, expectedVersion: row.version - 1 }, 409);
      await request(managerToken, 'PATCH', `/users/technicians/${row.id}/status`, { isActive: false, expectedVersion: row.version }, 200);
      await request(techToken, 'GET', '/auth/me', null, 401);
      await page.reload(); await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
      const after = await request(managerToken, 'GET', '/users/technicians/manage', null, 200);
      assert.deepEqual(after.filter(r => r.id !== row.id), before.filter(r => r.id !== row.id), 'all other preexisting technicians unchanged');
      assert.equal(errors.length, 0);
      console.log('Fixture retained inactive: ' + email + ' | ' + row.id);
      stage('PASS real Chrome/API: create/reset/forced password/relogin/TECHNICIAN403/no-op/stale version/deactivate/revoked401; no Project written');
    }
  } finally { await browser.close(); }
}
const timer = setTimeout(() => { console.error('Account smoke deadline exceeded'); process.exit(1); }, 120000);
run().catch(error => { console.error('Account smoke FAILED (request bodies/credentials omitted)'); console.error(String(error.message).split('\n')[0]); console.error((error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).join('\n')); process.exitCode = 1; }).finally(() => clearTimeout(timer));
