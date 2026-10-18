// Mounted App, intercepted HTTP by default. Real mode is read-only and uses local credentials.
// PLAYWRIGHT_MODULE / CHROME_EXECUTABLE may point to tools installed outside this repo.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const web = process.env.SUMMARY_WEB_URL || 'http://localhost:5173';
const api = process.env.SUMMARY_API_URL || 'http://localhost:3000';
const real = process.env.SUMMARY_REAL_SMOKE === '1';
const webOrigin = new URL(web).origin, apiOrigin = new URL(api).origin;
if (!real && webOrigin === apiOrigin) throw new Error('Mock smoke requires separate frontend/API origins.');
const stage = label => console.log(`Summary smoke: ${label}`);
const signal = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Smoke barrier timeout')), 8000); })]); }
  finally { clearTimeout(timer); }
}

async function run() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const releases = new Set();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
    const button = name => page.getByRole('button', { name, exact: true });
    const overview = () => page.getByRole('region', { name: 'Tổng kết công trình', exact: true });
    const goBack = async () => { await button('Về tổng quan').click(); await overview().getByText('Bắt đầu lượt đọc:', { exact: false }).waitFor(); };
    const login = async (email, password) => {
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
      await button('Đăng nhập').click();
    };
    if (real) {
      stage('real API / read-only, two roles');
      const fs = require('node:fs'), path = require('node:path');
      const local = require('dotenv').parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
      const credentials = role => ({ email: process.env[`DEMO_${role}_EMAIL`] || local[`DEMO_${role}_EMAIL`] || (role === 'MANAGER' ? 'manager.demo@example.local' : 'technician.demo@example.local'), password: process.env[`DEMO_${role}_PASSWORD`] || local[`DEMO_${role}_PASSWORD`] });
      for (const role of ['MANAGER', 'TECHNICIAN']) if (!credentials(role).password) throw new Error('Missing local demo credentials; no account changes are performed.');
      for (const role of ['MANAGER', 'TECHNICIAN']) {
        stage(`real API role ${role}`);
        await page.goto(web);
        const credentialsForRole = credentials(role);
        await login(credentialsForRole.email, credentialsForRole.password);
        const responsePromise = page.waitForResponse(response => new URL(response.url()).origin === apiOrigin && /\/projects\/[^/]+\/summary$/.test(new URL(response.url()).pathname));
        await page.locator('.project-row').filter({ hasText: process.env.SUMMARY_PROJECT_CODE || 'CT-DEMO-ELV-01' }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200);
        const data = await response.json();
        await overview().getByText('Bắt đầu lượt đọc:', { exact: false }).waitFor();
        assert.equal(await overview().locator('.summary-metric').filter({ hasText: 'Chưa duyệt' }).locator('strong').textContent(), String(data.tasks.notApproved));
        assert.equal(await overview().locator('.summary-metric').filter({ hasText: 'Chưa đóng' }).locator('strong').textContent(), String(data.issues.notClosed));
        assert.equal(await page.locator('.overview-links button').count(), 6);
        if (role === 'TECHNICIAN') {
          assert.equal('inspections' in data, false); assert.equal('draft' in data.acceptances, false);
          assert.equal(await overview().getByText('Phiếu kiểm tra', { exact: true }).count(), 0);
        }
        if (role === 'MANAGER' && process.env.SUMMARY_ARTIFACT_DIR) await page.screenshot({ path: require('node:path').join(process.env.SUMMARY_ARTIFACT_DIR, 'summary-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (role === 'MANAGER' && process.env.SUMMARY_ARTIFACT_DIR) await page.screenshot({ path: require('node:path').join(process.env.SUMMARY_ARTIFACT_DIR, 'summary-mobile.png'), fullPage: true });
        const targets = [['Chưa duyệt', 'Nhóm công việc', 'notApproved'], ['Chưa đóng', 'Nhóm lỗi', 'notClosed'],
          ...(role === 'MANAGER' ? [['Đạt', 'Nhóm phiếu', 'passed'], ['Chưa kiểm tra', 'Nhóm phiếu', 'notChecked'], ['Đang kiểm tra / chưa đạt', 'Nhóm phiếu', 'pendingOrFailed'], ['Bản nháp', 'Nhóm hồ sơ nghiệm thu', 'draft']] : []),
          ['Xác nhận hiện hành', 'Nhóm hồ sơ nghiệm thu', 'confirmedCurrent'], ['Đã thay thế', 'Nhóm hồ sơ nghiệm thu', 'superseded']];
        for (const [label, groupLabel, group] of targets) {
          await overview().getByRole('button', { name: new RegExp(`^\\d+ ${label}$`) }).click();
          await page.getByLabel(groupLabel, { exact: true }).waitFor();
          assert.equal(await page.getByLabel(groupLabel, { exact: true }).inputValue(), group);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await goBack();
        }
        await button('Đăng xuất').click();
      }
      console.log('PASS real API summaries, two roles, every allowed group link and 390px; no business writes.');
      return;
    }

    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.name));
    // Fault injection: let summary responses survive AbortController so React/session gates are exercised too.
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (input, options) => {
        const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
        if (/\/projects\/[^/]+\/summary$/.test(path) && options) {
          const copy = { ...options }; delete copy.signal; return original(input, copy);
        }
        return original(input, options);
      };
    });
    const token = ['fixture', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.');
    let role = 'MANAGER', summaryCalls = 0, failSummary = false, holdSummary = null;
    const date = '2026-10-18T03:00:00.000Z';
    const projects = ['A', 'B', 'C'].map(id => ({ id, code: `SUMMARY-${id}`, name: `Công trình ${id}`, status: 'IN_PROGRESS', address: null, description: null, createdAt: date, updatedAt: date }));
    const system = { id: 'LAN', projectId: 'A', code: 'LAN', name: 'Mạng LAN', category: 'LAN', description: null };
    const tasks = Array.from({ length: 14 }, (_, i) => ({ id: `task-${i}`, projectId: 'A', code: `TASK-${String(i).padStart(2, '0')}`, title: `Việc ${i}`, systemId: 'LAN', areaId: null, assigneeId: 'tech', status: i === 13 ? 'APPROVED' : 'ASSIGNED', description: null, completionNote: null, returnReason: null }));
    const issues = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((status, i) => ({ id: `issue-${i}`, projectId: 'A', itemId: `item-${i}`, inspectionId: `sheet-${i}`, inspectionCode: `CHECK-${i}`, systemId: 'LAN', areaId: null, deviceId: null, assigneeId: 'tech', assignee: { id: 'tech', email: 'tech@example.invalid' }, status, version: 1, description: `Lỗi ${i}`, item: { id: `item-${i}`, code: `ITEM-${i}`, title: 'Kiểm tra', version: 1, result: 'FAIL' } }));
    const sheets = [
      { code: 'CHECK-PASS', passed: true, summary: { total: 1, pass: 1, notChecked: 0, openIssues: 0 } },
      { code: 'CHECK-NOTCHECK', passed: false, summary: { total: 1, pass: 0, notChecked: 1, openIssues: 0 } },
      { code: 'CHECK-PENDING', passed: false, summary: { total: 1, pass: 0, notChecked: 0, openIssues: 1 } },
      { code: 'CHECK-EMPTY', passed: false, summary: { total: 0, pass: 0, notChecked: 0, openIssues: 0 } },
    ].map((row, i) => ({ ...row, id: `sheet-${i}`, projectId: 'A', systemId: 'LAN', title: row.code, templateRevision: 1, areaId: null, deviceId: null, items: [] }));
    const acceptances = [
      { id: 'draft', code: 'AC-DRAFT', status: 'DRAFT', replacedById: null },
      { id: 'current', code: 'AC-CURRENT', status: 'CONFIRMED', replacedById: null },
      { id: 'old', code: 'AC-OLD', status: 'CONFIRMED', replacedById: 'current' },
    ].map(row => ({ ...row, projectId: 'A', systemId: 'LAN', title: row.code, version: 1, inspectionIds: [], evidenceIds: [] }));
    function summary(projectId) {
      const zero = projectId === 'C';
      const assigned = zero ? 0 : projectId === 'B' ? 22 : 13;
      return { projectId, readAt: date, workScope: role === 'MANAGER' ? 'PROJECT' : 'ASSIGNED_TO_ME',
        tasks: { total: zero ? 0 : assigned + 1, notApproved: assigned, byStatus: { ASSIGNED: assigned, IN_PROGRESS: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: zero ? 0 : 1 } },
        issues: { total: zero ? 0 : 4, notClosed: zero ? 0 : 3, byStatus: { OPEN: zero ? 0 : 1, IN_PROGRESS: zero ? 0 : 1, RESOLVED: zero ? 0 : 1, CLOSED: zero ? 0 : 1 } },
        inventory: { devicesTotal: zero ? 0 : 3, systemsTotal: zero ? 0 : 1, areas: { total: 0, floor: 0, room: 0 }, racks: { total: zero ? 0 : 2, main: zero ? 0 : 1, sub: zero ? 0 : 1, unclassified: 0 } },
        acceptances: { confirmedCurrent: zero ? 0 : 1, superseded: zero ? 0 : 1, ...(role === 'MANAGER' ? { draft: zero ? 0 : 1 } : {}) },
        ...(role === 'MANAGER' ? { inspections: { total: zero ? 0 : 4, passed: zero ? 0 : 1, notChecked: zero ? 0 : 1, pendingOrFailed: zero ? 0 : 2 } } : {}),
      };
    }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname;
      if (url.origin === webOrigin) return route.continue();
      if (url.origin !== apiOrigin) { unexpected.push(`${method} ${url.origin}${path}`); return route.abort(); }
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': webOrigin }, body: JSON.stringify(body) });
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': webOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' } });
      if (method === 'POST' && path === '/auth/login') return json({ accessToken: token }, 201);
      if (method === 'GET' && path === '/auth/me') return json({ id: role === 'MANAGER' ? 'manager' : 'tech', email: role === 'MANAGER' ? 'manager@example.invalid' : 'tech@example.invalid', role, isActive: true, version: 1, mustChangePassword: false });
      if (method === 'GET' && path === '/projects') return json(projects);
      if (method === 'GET' && path === '/users/technicians') return json([{ id: 'tech', email: 'tech@example.invalid' }]);
      if (method === 'GET' && path === '/checklist-templates') return json([]);
      const match = path.match(/^\/projects\/([ABC])\/(summary|areas|systems|tasks|issues|devices|inspections|acceptances)$/);
      if (method === 'GET' && match) {
        const [, projectId, kind] = match;
        if (kind === 'summary') {
          summaryCalls++;
          const value = summary(projectId), held = holdSummary;
          if (held && held.projectId === projectId) { holdSummary = null; held.entered.resolve(); await held.release.promise; return json(value, held.status); }
          if (failSummary) { failSummary = false; return json({ message: 'Injected GET failure' }, 503); }
          return json(value);
        }
        if (kind === 'areas' || kind === 'devices') return json([]);
        if (projectId === 'C') return json([]);
        if (kind === 'systems') return json([{ ...system, projectId }]);
        if (kind === 'tasks') return json(projectId === 'A' ? tasks : Array.from({ length: 23 }, (_, i) => ({ ...tasks[0], projectId, id: `task-B-${i}`, code: `TASK-B-${i}`, status: i === 22 ? 'APPROVED' : 'ASSIGNED' })));
        if (kind === 'issues') return json(issues);
        if (kind === 'inspections') { assert.equal(role, 'MANAGER'); return json(sheets); }
        if (kind === 'acceptances') return json(role === 'MANAGER' ? acceptances : acceptances.filter(row => row.status === 'CONFIRMED'));
      }
      unexpected.push(`${method} ${path}`); return json({ message: 'Unmocked API blocked' }, 501);
    });
    const hold = (projectId, status = 200) => {
      const gate = { projectId, status, entered: signal(), release: signal() };
      releases.add(gate.release.resolve); holdSummary = gate; return gate;
    };
    const select = async id => { await page.locator('.project-row').filter({ hasText: `SUMMARY-${id}` }).click(); };
    const metric = group => overview().locator('.summary-metric').filter({ hasText: group });
    await page.goto(web); await login('manager@example.invalid', randomBytes(18).toString('hex')); await select('A');
    await overview().getByText('Bắt đầu lượt đọc:', { exact: false }).waitFor();
    stage('six cards / every group / pagination reset');
    assert.equal(await page.locator('.overview-links button').count(), 6);
    assert.equal(await page.locator('.tasks-panel,.inspection-panel,.connections-panel,.devices-panel').count(), 0);
    assert.match(await page.locator('.overview-links button').filter({ hasText: 'Thiết bị' }).textContent(), /3 thiết bị/);
    const targets = [
      ['Chưa duyệt', 'Nhóm công việc', 'notApproved', 6],
      ['Chưa đóng', 'Nhóm lỗi', 'notClosed', 3],
      ['Đạt', 'Nhóm phiếu', 'passed', 1],
      ['Chưa kiểm tra', 'Nhóm phiếu', 'notChecked', 1],
      ['Đang kiểm tra / chưa đạt', 'Nhóm phiếu', 'pendingOrFailed', 2],
      ['Xác nhận hiện hành', 'Nhóm hồ sơ nghiệm thu', 'confirmedCurrent', 1],
      ['Bản nháp', 'Nhóm hồ sơ nghiệm thu', 'draft', 1],
      ['Đã thay thế', 'Nhóm hồ sơ nghiệm thu', 'superseded', 1],
    ];
    for (const [label, groupLabel, value, count] of targets) {
      await overview().getByRole('button', { name: new RegExp(`^\\d+ ${label}$`) }).click();
      const group = page.getByLabel(groupLabel, { exact: true }); await group.waitFor();
      assert.equal(await group.inputValue(), value);
      await page.getByText(/Trang 1\//).waitFor();
      const rows = value === 'notApproved' ? page.locator('.task-list > li') : value === 'notClosed' ? page.locator('.inspection-issue') : groupLabel === 'Nhóm phiếu' ? page.locator('.inspection-sheet') : page.locator('.item-list > li');
      assert.equal(await rows.count(), count);
      if (value === 'notApproved') {
        await button('Sau').click(); await page.getByText(/Trang 2\/3/).waitFor();
        await group.selectOption(''); await page.getByText(/Trang 1\/3/).waitFor();
      }
      await goBack();
    }
    await page.locator('.overview-links button').filter({ hasText: 'Công việc' }).click();
    await page.getByLabel('Nhóm công việc', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Nhóm công việc', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Lọc công việc', { exact: true }).inputValue(), '');
    await goBack();
    stage('refresh failure hides counts / new GET / late Project response');
    failSummary = true; await button('Tải lại tổng kết').click(); await overview().getByRole('alert').waitFor();
    assert.equal(await overview().locator('.summary-metric').count(), 0);
    assert.equal(await page.locator('.overview-links button').count(), 6);
    assert.equal(await page.locator('.overview-links button').filter({ hasText: '3 thiết bị' }).count(), 0);
    await button('Tải lại tổng kết').click(); await metric('Chưa duyệt').waitFor();
    const late = hold('A'); await button('Tải lại tổng kết').click(); await bounded(late.entered.promise);
    assert.equal(await overview().locator('.summary-metric').count(), 0, 'loading must hide old counts');
    await select('B'); await overview().getByRole('button', { name: '22 Chưa duyệt', exact: true }).waitFor();
    const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/projects/A/summary');
    late.release.resolve(); await lateResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await overview().getByRole('button', { name: '13 Chưa duyệt', exact: true }).count(), 0);
    await select('C'); await overview().getByRole('button', { name: '0 Chưa duyệt', exact: true }).waitFor();
    await metric('Chưa duyệt').click(); await page.getByLabel('Nhóm công việc', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Nhóm công việc', { exact: true }).inputValue(), 'notApproved');
    assert.equal(await page.locator('.task-list > li').count(), 0); await goBack();
    const old401 = hold('C', 401); await button('Tải lại tổng kết').click(); await bounded(old401.entered.promise);
    await button('Đăng xuất').click(); role = 'TECHNICIAN';
    await login('tech@example.invalid', randomBytes(18).toString('hex')); await select('A');
    await overview().getByText('Việc của tôi', { exact: true }).waitFor();
    const old401Response = page.waitForResponse(response => response.status() === 401 && new URL(response.url()).pathname === '/projects/C/summary');
    old401.release.resolve(); await old401Response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    stage('same JWT / stale 401 / technician whitelist / reload / mobile keyboard');
    assert.equal(await page.getByRole('button', { name: 'Đăng nhập', exact: true }).count(), 0);
    assert.equal(await overview().getByText('Lỗi của tôi', { exact: true }).count(), 1);
    assert.equal(await overview().getByText('Phiếu kiểm tra', { exact: true }).count(), 0);
    assert.equal(await overview().getByRole('button', { name: /Bản nháp/ }).count(), 0);
    await metric('Xác nhận hiện hành').click(); await page.getByLabel('Nhóm hồ sơ nghiệm thu', { exact: true }).waitFor();
    assert.equal(await button('Tạo hồ sơ').count(), 0);
    assert.equal(await page.getByLabel('Nhóm hồ sơ nghiệm thu', { exact: true }).locator('option[value="draft"]').count(), 0);
    await goBack();
    const before = summaryCalls; await page.reload(); await select('A'); await overview().getByText('Việc của tôi', { exact: true }).waitFor();
    assert.ok(summaryCalls > before);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await metric('Chưa đóng').focus(); await page.keyboard.press('Enter'); await page.getByLabel('Nhóm lỗi', { exact: true }).waitFor();
    assert.equal(await page.locator('.inspection-issue').count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await goBack();
    const oldSuccess = hold('A'); await button('Tải lại tổng kết').click(); await bounded(oldSuccess.entered.promise);
    await button('Đăng xuất').click(); role = 'MANAGER';
    await login('manager@example.invalid', randomBytes(18).toString('hex')); await select('C');
    await overview().getByRole('button', { name: '0 Chưa duyệt', exact: true }).waitFor();
    const successResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/projects/A/summary');
    oldSuccess.release.resolve(); await successResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await overview().getByText('Việc của tôi', { exact: true }).count(), 0);
    assert.equal(await overview().getByRole('button', { name: '0 Chưa duyệt', exact: true }).count(), 1);
    const current401 = hold('C', 401); await button('Tải lại tổng kết').click(); await bounded(current401.entered.promise);
    current401.release.resolve(); await button('Đăng nhập').waitFor();
    assert.equal(await overview().count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('PASS mounted React: eight links/groups, pagination reset, six cards, zero/omitted fields, refresh failure, late Project/session success, old/current 401 with same JWT, reload, two roles and 390px keyboard. All API routes mocked.');
  } finally {
    for (const release of releases) release();
    await browser.close();
  }
}
// Playwright action logs can include fill() arguments; never print raw errors in credential mode.
run().catch(error => { console.error(`Summary smoke failed: ${error.name}`); process.exitCode = 1; });
