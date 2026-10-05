// Optional local smoke. Requires external Playwright and existing demo credentials.
// Creates only uniquely labelled test devices, cleans them through the API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const local = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
const api = process.env.RACK_API_URL || 'http://localhost:3000';
const web = process.env.RACK_WEB_URL || 'http://localhost:5173';
const prefix = `RACK-UI-${randomUUID().slice(0, 8).toUpperCase()}-`;
let stage = 'setup';

async function run() {
  assert.ok(local.DEMO_MANAGER_PASSWORD && local.DEMO_TECHNICIAN_PASSWORD, 'Demo password variables required');
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: local.DEMO_MANAGER_EMAIL || 'manager.demo@example.local', password: local.DEMO_MANAGER_PASSWORD }) });
  assert.equal(login.status, 201);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const get = async endpoint => { const response = await fetch(`${api}${endpoint}`, { headers }); assert.equal(response.status, 200); return response.json(); };
  assert.equal((await get('/health')).database, 'connected');
  const project = (await get('/projects')).find(p => p.code === 'CT-DEMO-ELV-01');
  assert.ok(project, 'Requires CT-DEMO-ELV-01 seeded separately');
  const base = `/projects/${project.id}`;
  const [before, areas, racks] = await Promise.all([get(`${base}/devices`), get(`${base}/areas`), get(`${base}/racks`)]);
  assert.equal(before.some(d => d.code.startsWith(prefix)), false, 'Trial prefix already exists; stop before writes or cleanup');
  const core = racks.find(r => r.code === 'RACK-CORE');
  const sub = racks.find(r => r.code === 'RACK-T02');
  assert.equal(core.capacityU, 42); assert.equal(sub.capacityU, 24);
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('Browser runtime error'));
    const signIn = async role => {
      await page.goto(web);
      await page.getByLabel('Email', { exact: true }).fill(role === 'MANAGER' ? (local.DEMO_MANAGER_EMAIL || 'manager.demo@example.local') : (local.DEMO_TECHNICIAN_EMAIL || 'technician.demo@example.local'));
      await page.getByLabel('Mật khẩu', { exact: true }).fill(role === 'MANAGER' ? local.DEMO_MANAGER_PASSWORD : local.DEMO_TECHNICIAN_PASSWORD);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.locator('.project-row').filter({ hasText: project.code }).click();
      await page.getByRole('button', { name: 'Mở sơ đồ tủ →', exact: true }).waitFor();
    };
    const open = async () => {
      await page.getByRole('button', { name: 'Mở sơ đồ tủ →', exact: true }).click();
      await page.locator('.rack-title h4').waitFor();
    };
    const selectRack = async id => {
      if ((await page.viewportSize()).width <= 700) await page.getByLabel('Chọn tủ', { exact: true }).selectOption(id);
      else await page.locator('.rack-tree button').filter({ hasText: racks.find(r => r.id === id)?.code || `${prefix}RACK` }).click();
      await page.locator('.rack-title h4').filter({ hasText: racks.find(r => r.id === id)?.code || `${prefix}RACK` }).waitFor();
    };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const shot = async filename => {
      if (process.env.RACK_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.RACK_ARTIFACT_DIR, filename), fullPage: true });
    };
    stage = 'demo read and desktop';
    await signIn('MANAGER'); await open(); await selectRack(core.id);
    assert.equal(await page.locator('.rack-unit-number').count(), 42);
    assert.equal(await page.locator('.rack-unit-number').first().innerText(), 'U42');
    assert.equal(await page.locator('.rack-unit-number').last().innerText(), 'U1');
    assert.ok(await page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' }).count());
    const span = await page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' }).evaluate(el => el.style.gridRow);
    assert.ok(span.includes('span 2'));
    assert.ok((await page.locator('.rack-accessories').innerText()).includes('PDU'));
    assert.ok((await page.locator('.rack-accessories').innerText()).includes('SHELF-CORE'));
    await noOverflow(); await shot('rack-layout-desktop.png');
    await page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' }).click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('U1–2'));
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    stage = 'mobile and SUB';
    await page.setViewportSize({ width: 390, height: 844 }); await selectRack(sub.id);
    assert.equal(await page.locator('.rack-unit-number').count(), 24);
    assert.equal(await page.locator('.rack-tree').isVisible(), false);
    await noOverflow(); await shot('rack-layout-390.png');
    await selectRack(core.id);
    await page.getByRole('button', { name: 'Cấu hình tủ', exact: true }).click();
    assert.equal(await page.getByLabel('Vai trò tủ', { exact: true }).inputValue(), 'MAIN');
    await noOverflow(); await shot('rack-config-390.png');
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();

    stage = 'drawer keyboard focus at 390px';
    const opener = page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'Shift+Tab from detail heading stays in drawer');
    const editPlacement = dialog.getByRole('button', { name: 'Xếp / chuyển / bỏ vị trí U', exact: true });
    await editPlacement.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Thiết bị');
    const focusInside = async () => assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'Keyboard focus stays inside rack drawer');
    const steps = await dialog.locator('button, input, select').count() + 3;
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < steps; i++) { await page.keyboard.press(key); await focusInside(); }
      // Deliberately move focus outside to exercise recovery, not only wraparound.
      await page.getByRole('button', { name: 'Đăng xuất', exact: true }).focus();
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), false);
      await page.keyboard.press(key);
      await focusInside();
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate(el => el === document.activeElement), true, 'Escape returns focus to original device opener');
    console.log('PASS detail → placement keyboard focus, Tab/Shift+Tab wrap/recovery and Escape restoration at 390px');

    stage = 'DevicePanel refresh and isolated fixtures';
    await page.getByRole('button', { name: '← Tổng quan công trình', exact: true }).click();
    const devicePanel = page.getByRole('region', { name: 'Danh mục thiết bị' });
    const create = async (type, code, rackId) => {
      await devicePanel.getByRole('button', { name: '＋ Thiết bị', exact: true }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Loại thiết bị', { exact: true }).selectOption(type);
      await form.getByLabel('Mã nhãn', { exact: true }).fill(code);
      await form.getByLabel('Tên thiết bị', { exact: true }).fill('Thiết bị kiểm tra rack UI');
      if (type === 'RACK') await form.getByLabel('Dung lượng rack (U)', { exact: true }).fill('6');
      await form.getByLabel('Cách đặt vị trí', { exact: true }).selectOption(rackId ? 'rack' : 'area');
      if (rackId) await form.getByLabel('Tủ rack', { exact: true }).selectOption(rackId);
      else await form.getByLabel('Tầng / phòng', { exact: true }).selectOption(areas[0].id);
      await form.getByRole('button', { name: 'Tạo thiết bị', exact: true }).click();
      await devicePanel.getByRole('button', { name: `Xem ${code}`, exact: true }).waitFor();
    };
    await create('RACK', `${prefix}RACK`);
    const testRack = (await get(`${base}/devices`)).find(d => d.code === `${prefix}RACK`);
    await create('SWITCH', `${prefix}SW`, testRack.id);
    await create('PDU', `${prefix}PDU`, testRack.id);
    await create('UPS', `${prefix}UPS`, testRack.id);
    await open(); await selectRack(testRack.id);
    assert.ok((await page.locator('.rack-accessories').innerText()).includes(`${prefix}SW`));
    await page.getByRole('button', { name: 'Cấu hình tủ', exact: true }).click();
    await page.getByLabel('Vai trò tủ', { exact: true }).selectOption('MAIN');
    await page.locator('.rack-area-choices input').first().check();
    await page.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('.rack-title h4').waitFor();
    assert.equal((await get(`${base}/racks`)).find(r => r.id === testRack.id).rackRole, 'MAIN');
    const fixtures = await get(`${base}/devices`);
    const sw = fixtures.find(d => d.code === `${prefix}SW`);
    const pdu = fixtures.find(d => d.code === `${prefix}PDU`);
    const ups = fixtures.find(d => d.code === `${prefix}UPS`);
    const placement = async (deviceId, mode, start = '', height = '1') => {
      await page.getByRole('button', { name: 'Xếp / chuyển thiết bị', exact: true }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Thiết bị', { exact: true }).selectOption(deviceId);
      await form.getByLabel('Kiểu lắp', { exact: true }).selectOption(mode);
      if (mode === 'U') { await form.getByLabel('U bắt đầu', { exact: true }).fill(start); await form.getByLabel('Chiều cao (U)', { exact: true }).fill(height); }
      await form.getByRole('button', { name: 'Lưu vị trí', exact: true }).click();
    };
    stage = 'placement and real 409';
    await placement(sw.id, 'U', '3'); await page.locator('.rack-mounted').filter({ hasText: `${prefix}SW` }).waitFor();
    await placement(ups.id, 'U', '3', '2');
    await page.getByText(/Lỗi 409:/).waitFor();
    assert.equal((await get(`${base}/devices`)).find(d => d.id === ups.id).mountMode, null);
    await placement(pdu.id, 'ZERO_U'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('.rack-accessories').getByText(`${prefix}PDU`, { exact: true }).waitFor();

    stage = 'write success then GET failure and retry';
    let puts = 0, failGet = false;
    await page.route(`**${base}/devices/${sw.id}/placement`, async route => {
      if (route.request().method() === 'PUT') { puts++; const response = await route.fetch(); failGet = true; await route.fulfill({ response }); }
      else await route.continue();
    });
    await page.route(`**${base}/racks/${testRack.id}/layout`, async route => {
      if (failGet) { failGet = false; await route.fulfill({ status: 503, body: JSON.stringify({ message: 'Simulated refresh failure' }), contentType: 'application/json' }); }
      else await route.continue();
    });
    await placement(sw.id, 'U', '5');
    await page.getByText('Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.rack-elevation').count(), 0);
    await page.getByRole('button', { name: 'Thử tải lại bằng GET', exact: true }).click();
    await page.locator('.rack-mounted').filter({ hasText: `${prefix}SW` }).waitFor();
    assert.equal(puts, 1);
    assert.equal((await get(`${base}/devices`)).find(d => d.id === sw.id).startU, 5);
    await page.unrouteAll({ behavior: 'wait' });

    stage = 'move and unplace';
    await placement(sw.id, '', ''); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('.rack-accessories').getByText(`${prefix}SW`, { exact: true }).waitFor();
    assert.equal((await get(`${base}/devices`)).find(d => d.id === sw.id).startU, null);
    await page.getByRole('button', { name: 'Xếp / chuyển thiết bị', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Thiết bị', { exact: true }).selectOption(sw.id);
    await page.getByRole('dialog').getByLabel('Vị trí', { exact: true }).selectOption('area');
    await page.getByRole('dialog').getByLabel('Area', { exact: true }).selectOption(areas[0].id);
    await page.getByRole('button', { name: 'Lưu vị trí', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('.rack-title h4').waitFor();
    const moved = (await get(`${base}/devices`)).find(d => d.id === sw.id);
    assert.equal(moved.areaId, areas[0].id); assert.equal(moved.rackId, null);
    assert.equal(moved.mountMode, null); assert.equal(moved.startU, null); assert.equal(moved.heightU, null);

    stage = 'late Rack response';
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let captured;
    const capturedPromise = new Promise(resolve => { captured = resolve; });
    await page.route(`**${base}/racks/${core.id}/layout`, async route => { const response = await route.fetch(); captured(); await hold; await route.fulfill({ response }); });
    await page.getByLabel('Chọn tủ', { exact: true }).selectOption(core.id);
    await capturedPromise;
    // Picker is intentionally hidden along with stale data during GET. Switch via Project.
    const otherProject = (await get('/projects')).find(p => p.id !== project.id);
    assert.ok(otherProject);
    await page.getByRole('button', { name: '← Danh sách công trình', exact: true }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.code }).click();
    release();
    await page.getByRole('button', { name: 'Mở sơ đồ tủ →', exact: true }).click();
    assert.equal(await page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' }).count(), 0);
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();

    stage = 'TECHNICIAN read only and reload';
    await signIn('TECHNICIAN'); await open(); await selectRack(core.id);
    assert.equal(await page.getByRole('button', { name: 'Cấu hình tủ', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Xếp / chuyển thiết bị', exact: true }).count(), 0);
    await page.locator('.rack-mounted').filter({ hasText: 'UPS-CORE' }).click();
    assert.equal(await page.getByRole('button', { name: 'Xếp / chuyển / bỏ vị trí U', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.reload();
    await page.locator('.project-row').filter({ hasText: project.code }).click(); await open(); await selectRack(core.id);
    await noOverflow();
    assert.deepEqual(errors, []);
    console.log('PASS rack demo, 42U/24U, multi-U, ZERO_U/unplaced, manager write/409, GET failure retry, late Project response, technician/reload, desktop/390px');
  } finally {
    await browser.close();
    const remaining = await get(`${base}/devices`);
    for (const device of remaining.filter(d => d.code.startsWith(prefix)).sort((a, b) => Number(a.type === 'RACK') - Number(b.type === 'RACK'))) {
      const response = await fetch(`${api}${base}/devices/${device.id}`, { method: 'DELETE', headers });
      assert.equal(response.status, 204, 'Cleanup only smoke devices');
    }
    const after = await get(`${base}/devices`);
    assert.deepEqual(after.sort((a, b) => a.id.localeCompare(b.id)), before.sort((a, b) => a.id.localeCompare(b.id)), 'Existing inventory unchanged');
    console.log('PASS isolated fixture cleanup; existing devices preserved');
  }
}
run().catch(error => {
  let message = error instanceof Error ? error.message : 'Unknown smoke failure';
  for (const [key, value] of Object.entries(local)) if (/PASSWORD|SECRET|TOKEN/i.test(key) && value) message = message.split(value).join('[redacted]');
  message = message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
  console.error(`FAIL rack browser smoke at stage: ${stage}\n${message}`);
  process.exitCode = 1;
});
