// Optional smoke: external Playwright/Chrome, existing API/Vite and demo accounts.
// No DELETE inspection/project API exists: prints only the unique trial Project code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const local = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
const api = process.env.INSPECTION_API_URL || 'http://localhost:3000';
const web = process.env.INSPECTION_WEB_URL || 'http://localhost:5173';
const code = `CHECK-UI-${randomUUID().slice(0, 8).toUpperCase()}`;
let stage = 'environment', createdProject = false;
async function run() {
  const credentials = role => ({ email: local[role === 'MANAGER' ? 'DEMO_MANAGER_EMAIL' : 'DEMO_TECHNICIAN_EMAIL'] || (role === 'MANAGER' ? 'manager.demo@example.local' : 'technician.demo@example.local'), password: local[role === 'MANAGER' ? 'DEMO_MANAGER_PASSWORD' : 'DEMO_TECHNICIAN_PASSWORD'] });
  assert.ok(credentials('MANAGER').password && credentials('TECHNICIAN').password);
  const request = async (token, method, endpoint, body, status = 200) => {
    const res = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(res.status, status, `${method} ${endpoint}`); return res.status === 204 ? null : res.json();
  };
  assert.equal((await request(null, 'GET', '/health')).database, 'connected');
  const managerToken = (await request(null, 'POST', '/auth/login', credentials('MANAGER'), 201)).accessToken;
  const techToken = (await request(null, 'POST', '/auth/login', credentials('TECHNICIAN'), 201)).accessToken;
  const tech = await request(techToken, 'GET', '/auth/me');
  // Launch before any writes: unavailable Chrome must not leave test data.
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  let project, base, page;
  const errors = [];
  try {
    const projectCodesBefore = (await request(managerToken, 'GET', '/projects')).map(p => p.code);
    assert.equal(projectCodesBefore.includes(code), false);
    project = await request(managerToken, 'POST', '/projects', { code, name: 'Smoke checklist riêng', status: 'IN_PROGRESS' }, 201); createdProject = true;
    base = `/projects/${project.id}`;
    const system = await request(managerToken, 'POST', `${base}/systems`, { code: 'LAN-SMOKE', name: 'LAN kiểm tra', category: 'LAN' }, 201);
    const area = await request(managerToken, 'POST', `${base}/areas`, { code: 'F01', name: 'Tầng kiểm tra', type: 'FLOOR' }, 201);
    const device = await request(managerToken, 'POST', `${base}/devices`, { code: 'CAM-SMOKE', name: 'Camera thử riêng', type: 'CAMERA', areaId: area.id, systemIds: [system.id] }, 201);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', () => errors.push('runtime'));
    const signIn = async role => {
      await page.goto(web); await page.getByLabel('Email', { exact: true }).fill(credentials(role).email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials(role).password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.locator('.project-row').filter({ hasText: code }).click();
      await page.locator('.inspection-panel').getByRole('heading', { name: role === 'MANAGER' ? 'Kiểm tra' : 'Lỗi được giao', exact: true }).waitFor();
      if (role === 'MANAGER') await panel().getByRole('button', { name: '＋ Tạo phiếu', exact: true }).waitFor();
    };
    const dialog = () => page.getByRole('dialog');
    const close = async () => { await dialog().getByRole('button', { name: 'Đóng', exact: true }).click(); };
    const panel = () => page.locator('.inspection-panel');
    const openSheet = async () => { await panel().locator('.inspection-sheet').filter({ hasText: 'CHECK-01' }).click(); };
    const openResult = async index => { await openSheet(); await dialog().getByRole('button', { name: 'Ghi kết quả', exact: true }).nth(index).click(); };
    const signedOut = async () => { await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); };
    const selectIssues = async () => { await panel().getByRole('button', { name: 'Lỗi khắc phục', exact: true }).click(); };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    stage = 'create and FAIL'; await signIn('MANAGER');
    await panel().getByRole('button', { name: '＋ Tạo phiếu', exact: true }).click();
    await dialog().getByLabel('Mã phiếu', { exact: true }).fill('CHECK-01'); await dialog().getByLabel('Tên phiếu', { exact: true }).fill('Phiếu smoke');
    await dialog().getByLabel('System', { exact: true }).selectOption(system.id);
    const templates = await request(managerToken, 'GET', '/checklist-templates?category=LAN');
    await dialog().getByLabel('Mẫu checklist', { exact: true }).selectOption(templates[0].id);
    await dialog().getByLabel('Phạm vi', { exact: true }).selectOption('device'); await dialog().getByLabel('Thiết bị', { exact: true }).selectOption(device.id);
    await dialog().getByRole('button', { name: 'Tạo phiếu', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    await openResult(0); await dialog().getByLabel('Kết quả', { exact: true }).selectOption('FAIL');
    await dialog().getByLabel('Mô tả lỗi', { exact: true }).fill('Cáp thử cần khắc phục'); await dialog().getByLabel('Kỹ thuật viên', { exact: true }).selectOption(tech.id);
    await dialog().getByRole('button', { name: 'Lưu kết quả', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    stage = 'real stale version and preserved draft';
    await openResult(0); await dialog().getByLabel('Ghi chú mục', { exact: true }).fill('Nội dung giữ sau 409');
    let sheet = (await request(managerToken, 'GET', `${base}/inspections`)).find(s => s.code === 'CHECK-01');
    await request(managerToken, 'PUT', `${base}/inspections/${sheet.id}/items/${sheet.items[0].id}/result`, { expectedVersion: sheet.items[0].version, result: 'FAIL', note: 'Cập nhật song song' });
    await dialog().getByRole('button', { name: 'Lưu kết quả', exact: true }).click(); await dialog().getByText('Lỗi 409:', { exact: false }).waitFor();
    assert.equal(await dialog().getByLabel('Ghi chú mục', { exact: true }).inputValue(), 'Nội dung giữ sau 409');
    await dialog().getByRole('button', { name: 'Tải lại phiên bản', exact: true }).click();
    await dialog().getByText('Đã tải phiên bản mới.', { exact: false }).waitFor();
    await dialog().getByRole('button', { name: 'Lưu kết quả', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    await signedOut();
    for (const pass of [false, true]) {
      stage = pass ? 'fix again then close' : 'resolve then return'; await signIn('TECHNICIAN');
      assert.equal(await panel().getByRole('button', { name: '＋ Tạo phiếu' }).count(), 0);
      await panel().getByRole('button', { name: 'Bắt đầu sửa', exact: true }).click(); await dialog().getByRole('button', { name: 'Bắt đầu sửa', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
      await panel().getByRole('button', { name: 'Báo đã sửa', exact: true }).click();
      await dialog().getByLabel('Ghi chú khắc phục', { exact: true }).fill(pass ? 'Đã sửa lại' : 'Đã sửa lần đầu');
      await dialog().getByRole('button', { name: 'Báo đã sửa', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
      await page.reload(); await page.locator('.project-row').filter({ hasText: code }).click(); await panel().getByText('Chờ kiểm tra lại', { exact: true }).waitFor();
      await signedOut(); await signIn('MANAGER'); await selectIssues();
      await panel().getByRole('button', { name: 'Kiểm tra lại', exact: true }).click();
      await dialog().getByLabel('Kết quả kiểm tra lại', { exact: true }).selectOption(pass ? 'PASS' : 'FAIL');
      await dialog().getByLabel('Ghi chú kiểm tra lại', { exact: true }).fill(pass ? 'Kiểm tra đạt' : 'Vẫn chưa đạt');
      if (!pass) await dialog().getByLabel('Lý do trả lỗi', { exact: true }).fill('Đấu nối lại cáp');
      await dialog().getByRole('button', { name: 'Lưu kiểm tra lại', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
      if (!pass) await signedOut();
    }
    stage = 'passed history keyboard mobile reload';
    await panel().getByRole('button', { name: 'Phiếu kiểm tra', exact: true }).click();
    for (const i of [1, 2]) { await openResult(i); await dialog().getByLabel('Kết quả', { exact: true }).selectOption('PASS'); await dialog().getByRole('button', { name: 'Lưu kết quả', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
    sheet = await request(managerToken, 'GET', `${base}/inspections/${sheet.id}`); assert.equal(sheet.passed, true); assert.equal(sheet.summary.openIssues, 0);
    await openSheet(); await dialog().getByText('Đã đóng', { exact: false }).waitFor();
    await page.keyboard.press('Tab'); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); await openSheet(); await noOverflow();
    if (process.env.INSPECTION_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.INSPECTION_ARTIFACT_DIR, 'inspection-mobile.png'), fullPage: true });
    await close(); await page.reload(); await page.locator('.project-row').filter({ hasText: code }).click(); await panel().getByText('Phiếu đạt', { exact: false }).waitFor();
    stage = 'POST success followed by GET failure and GET-only retry';
    let posts = 0; page.on('request', r => { if (r.method() === 'POST' && r.url() === `${api}${base}/inspections`) posts++; });
    await panel().getByRole('button', { name: '＋ Tạo phiếu', exact: true }).click();
    await dialog().getByLabel('Mã phiếu', { exact: true }).fill('CHECK-GET-FAIL'); await dialog().getByLabel('Tên phiếu', { exact: true }).fill('Thử tải lại lỗi');
    await dialog().getByLabel('System', { exact: true }).selectOption(system.id); await dialog().getByLabel('Mẫu checklist', { exact: true }).selectOption(templates[0].id);
    await page.route(`${api}${base}/inspections`, async route => route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
    await dialog().getByRole('button', { name: 'Tạo phiếu', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    await panel().getByText('Đã lưu trên server nhưng chưa tải lại được', { exact: false }).waitFor();
    assert.equal(await panel().locator('.inspection-sheet').count(), 0); assert.equal(posts, 1);
    assert.equal(await panel().getByRole('button', { name: '＋ Tạo phiếu', exact: true }).isDisabled(), true);
    await page.unroute(`${api}${base}/inspections`); await panel().getByRole('button', { name: 'Tải lại hồ sơ', exact: true }).click();
    await panel().locator('.inspection-sheet').filter({ hasText: 'CHECK-GET-FAIL' }).waitFor(); assert.equal(posts, 1);
    await noOverflow(); assert.deepEqual(errors, []);
    const finalSheets = await request(managerToken, 'GET', `${base}/inspections`);
    assert.equal(finalSheets.length, 2);
    assert.equal((await request(managerToken, 'GET', '/projects')).filter(p => projectCodesBefore.includes(p.code)).length, projectCodesBefore.length);
    console.log(`Chrome/API smoke passed; trial Project ${code}: 2 inspections, 6 items, 1 CLOSED issue retained (no DELETE API).`);
  } catch (error) {
    if (page && process.env.INSPECTION_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.INSPECTION_ARTIFACT_DIR, 'inspection-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); if (createdProject) console.log(`Trial data retained only in ${code}; CT-DEMO-ELV-01 was not written.`); }
}
run().catch(error => {
  let message = String(error.message ?? error.name).split('\n')[0];
  for (const [key, value] of Object.entries(local)) if (/PASSWORD|JWT_SECRET|TOKEN/i.test(key) && value) message = message.replaceAll(value, '[redacted]');
  message = message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
  console.error(`Inspection smoke failed at: ${stage}: ${message}`);
  if (createdProject) console.error(`Trial Project: ${code}; no automatic SQL cleanup.`); process.exitCode = 1;
});
