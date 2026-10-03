// Optional local Chromium smoke test. Uses existing demo credentials in backend/.env;
// never prints credentials/tokens, installs dependencies or changes existing fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const local = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
const api = process.env.DEVICE_API_URL || 'http://localhost:3000';
const web = process.env.DEVICE_WEB_URL || 'http://localhost:5173';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const prefix = `UI-${suffix}-`;
const labels = { RACK: 'Tủ rack', PATCH_PANEL: 'Patch panel', SWITCH: 'Switch', NETWORK_OUTLET: 'Ổ mạng', AP: 'AP WiFi', CAMERA: 'Camera' };

async function run() {
  const managerEmail = local.DEMO_MANAGER_EMAIL || 'manager.demo@example.local';
  const technicianEmail = local.DEMO_TECHNICIAN_EMAIL || 'technician.demo@example.local';
  assert.ok(local.DEMO_MANAGER_PASSWORD && local.DEMO_TECHNICIAN_PASSWORD, 'Local demo password variables required');
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: managerEmail, password: local.DEMO_MANAGER_PASSWORD }) });
  assert.equal(login.status, 201);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const get = async endpoint => { const response = await fetch(`${api}${endpoint}`, { headers }); assert.equal(response.status, 200); return response.json(); };
  const projects = await get('/projects');
  let fixture;
  for (const project of projects) {
    const [areas, systems] = await Promise.all([get(`/projects/${project.id}/areas`), get(`/projects/${project.id}/systems`)]);
    if (areas.length && systems.length) { fixture = { project, areas, systems }; break; }
  }
  assert.ok(fixture, 'Requires an existing project with at least one area and system; does not create/delete projects');
  const { project, areas, systems } = fixture;
  const otherProject = projects.find(item => item.id !== project.id);
  assert.ok(otherProject, 'Project-switch smoke test requires a second existing project');
  const [otherAreas, otherSystems] = await Promise.all([
    get(`/projects/${otherProject.id}/areas`), get(`/projects/${otherProject.id}/systems`),
  ]);
  const endpoint = `/projects/${project.id}/devices`;
  const before = await get(endpoint);
  assert.equal(before.some(device => device.code.startsWith(prefix)), false, 'Fixture prefix must not match existing inventory');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('Browser runtime error'));
    page.on('console', message => { if (message.type() === 'error' && /same key/i.test(message.text())) errors.push('Duplicate React key'); });
    const signIn = async (email, password) => {
      await page.goto(web);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await page.locator('.project-row').filter({ hasText: project.code }).click();
      await page.getByRole('heading', { name: 'Thiết bị', exact: true }).waitFor();
      await page.locator('.device-loading').waitFor({ state: 'hidden' });
    };
    await signIn(managerEmail, local.DEMO_MANAGER_PASSWORD);
    console.log('PASS MANAGER login and project selection');
    const panel = page.getByRole('region', { name: 'Danh mục thiết bị' });
    if (before.length === 0) await panel.getByRole('heading', { name: 'Chưa có thiết bị', exact: true }).waitFor();
    const findRow = code => panel.locator('.device-row').filter({ has: page.getByRole('button', { name: `Xem ${code}`, exact: true }) });
    const create = async (type, code, placement = 'area', multi = false) => {
      await panel.getByRole('button', { name: '＋ Thiết bị', exact: true }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Loại thiết bị').selectOption(type);
      await form.getByLabel('Mã nhãn', { exact: true }).fill(code.toLowerCase());
      await form.getByLabel('Tên thiết bị', { exact: true }).fill(`Thiết bị ${labels[type]}`);
      await form.getByLabel('Hãng', { exact: true }).fill('Hãng thử');
      await form.getByLabel('Model', { exact: true }).fill('Model thử');
      await form.getByLabel('Số serial', { exact: true }).fill(`SERIAL-${type}`);
      await form.getByLabel('Ghi chú vị trí', { exact: true }).fill('Ghi chú vị trí thử');
      await form.getByLabel('Thông tin thêm', { exact: true }).fill('Dữ liệu kiểm thử local; sẽ xóa sau khi kiểm tra');
      if (type === 'RACK') await form.getByLabel('Dung lượng rack (U)', { exact: true }).fill('42');
      await form.getByLabel('Cách đặt vị trí').selectOption(placement);
      if (placement === 'area') await form.getByLabel('Tầng / phòng').selectOption(areas[0].id);
      if (placement === 'rack') {
        const rack = (await get(endpoint)).find(device => device.code === `${prefix}RACK`);
        await form.getByLabel('Tủ rack').selectOption(rack.id);
      }
      if (multi) for (const system of systems.slice(0, 2)) await form.locator('.device-checkbox').filter({ hasText: system.code }).locator('input').check();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      if (process.env.DEVICE_ARTIFACT_DIR && type === 'RACK' && code === `${prefix}RACK`) {
        await page.screenshot({ path: path.join(process.env.DEVICE_ARTIFACT_DIR, 'device-form-390.png') });
      }
      await form.getByRole('button', { name: 'Tạo thiết bị', exact: true }).click();
    };
    for (const type of Object.keys(labels)) {
      const code = `${prefix}${type.replaceAll('_', '-')}`;
      await create(type, code, ['SWITCH', 'PATCH_PANEL'].includes(type) ? 'rack' : 'area', type === 'SWITCH');
      console.log(`Created through form: ${type}`);
      await findRow(code).waitFor();
      assert.ok(await findRow(code).getByText(labels[type], { exact: true }).count());
    }
    const swCode = `${prefix}SWITCH`;
    const row = findRow(swCode);
    assert.ok((await row.innerText()).includes('Kế thừa từ rack'));
    await row.getByRole('button', { name: 'Xem đầy đủ', exact: true }).click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('SERIAL-SWITCH'));
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).last().click();
    const edit = async placement => {
      await row.getByRole('button', { name: 'Sửa', exact: true }).click();
      const form = page.getByRole('dialog');
      assert.equal(await form.getByLabel('Loại thiết bị').isDisabled(), true);
      await form.getByLabel('Cách đặt vị trí').selectOption(placement);
      if (placement === 'area') await form.getByLabel('Tầng / phòng').selectOption(areas[0].id);
      if (placement === 'rack') await form.getByLabel('Tủ rack').selectOption((await get(endpoint)).find(device => device.code === `${prefix}RACK`).id);
      for (const input of await form.locator('.device-checkbox input').all()) await input.uncheck();
      await form.getByRole('button', { name: 'Lưu thiết bị', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await panel.getByText('Đã lưu thiết bị.', { exact: true }).waitFor();
    };
    await edit('area');
    let sw = (await get(endpoint)).find(device => device.code === swCode);
    assert.equal(sw.rackId, null); assert.equal(sw.areaId, areas[0].id); assert.deepEqual(sw.systemIds, []);
    await edit('rack');
    sw = (await get(endpoint)).find(device => device.code === swCode);
    assert.equal(sw.areaId, null); assert.ok(sw.rackId); assert.equal(sw.effectiveAreaId, areas[0].id);
    console.log('PASS MANAGER: six types, full details, optional fields, multiple systems, Area/Rack moves and clearing systems');

    await findRow(`${prefix}RACK`).getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa thiết bị này', exact: true }).click();
    await page.getByRole('dialog').getByText(/Lỗi 409:/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: true }).click();
    await create('RACK', `${prefix}RACK`);
    await page.getByRole('dialog').getByText(/Lỗi 409:/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: true }).click();
    console.log('PASS 409: duplicate label and rack dependency shown; unsuccessful forms remain open');

    let postCount = 0;
    const failGet = async route => {
      const req = route.request();
      if (req.method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      else { if (req.method() === 'POST') postCount++; await route.continue(); }
    };
    await page.route(`${api}${endpoint}`, failGet);
    await create('AP', `${prefix}REFRESH`);
    await panel.getByRole('alert').filter({ hasText: 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await panel.locator('.device-row').count(), 0);
    assert.equal(await panel.getByRole('button', { name: '＋ Thiết bị', exact: true }).isDisabled(), true);
    assert.equal(postCount, 1);
    assert.equal((await get(endpoint)).filter(device => device.code === `${prefix}REFRESH`).length, 1);
    await page.unroute(`${api}${endpoint}`, failGet);
    await panel.getByRole('button', { name: 'Tải lại thiết bị', exact: true }).click();
    await findRow(`${prefix}REFRESH`).waitFor();
    console.log('PASS POST success / refresh GET failure: form closed, stale rows hidden, no duplicate POST; GET retry recovers');

    await findRow(`${prefix}REFRESH`).getByRole('button', { name: 'Xóa', exact: true }).click();
    await page.getByRole('dialog').getByText(/không thể hoàn tác/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Xóa thiết bị này', exact: true }).click();
    await panel.getByText('Đã xóa thiết bị.', { exact: true }).waitFor();
    assert.equal(await findRow(`${prefix}REFRESH`).count(), 0);
    assert.equal((await get(endpoint)).some(device => device.code === `${prefix}REFRESH`), false);
    console.log('PASS MANAGER confirmed DELETE through UI and refreshed inventory');

    for (const status of [400, 404]) {
      const failPatch = async route => route.request().method() === 'PATCH'
        ? route.fulfill({ status, contentType: 'application/json', body: '{}' }) : route.continue();
      await page.route(`${api}${endpoint}/*`, failPatch);
      await row.getByRole('button', { name: 'Sửa', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Lưu thiết bị', exact: true }).click();
      await page.getByRole('dialog').getByText(new RegExp(`Lỗi ${status}:`)).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: true }).click();
      await page.unroute(`${api}${endpoint}/*`, failPatch);
    }
    console.log('PASS 400/404 presentation (responses deliberately simulated in browser)');
    await page.setViewportSize({ width: 1280, height: 900 });
    const projectRow = item => page.locator('.project-row').filter({
      has: page.locator('.project-row-copy small').getByText(item.code, { exact: true }),
    });
    const otherAreasUrl = `${api}/projects/${otherProject.id}/areas`;
    let releaseOtherAreas;
    const otherAreasGate = new Promise(resolve => { releaseOtherAreas = resolve; });
    const delayOtherAreas = async route => { await otherAreasGate; await route.continue(); };
    await page.route(otherAreasUrl, delayOtherAreas);
    try {
      await projectRow(otherProject).click();
      await page.locator('.title-line h2').getByText(otherProject.name, { exact: true }).waitFor();
      await page.locator('.detail-loading').waitFor();
      assert.equal(await page.locator('.detail-grid').count(), 0);
      assert.equal(await page.getByRole('region', { name: 'Danh mục thiết bị' }).count(), 0);
      assert.equal(await page.getByRole('region', { name: 'Công việc thi công' }).count(), 0);
      releaseOtherAreas();
      await page.locator('.detail-grid').waitFor();
    } finally {
      releaseOtherAreas();
      await page.unroute(otherAreasUrl, delayOtherAreas);
    }

    const originalAreasUrl = `${api}/projects/${project.id}/areas`;
    let releaseOriginalAreas;
    let markOriginalAreasRequested;
    const originalAreasGate = new Promise(resolve => { releaseOriginalAreas = resolve; });
    const originalAreasRequested = new Promise(resolve => { markOriginalAreasRequested = resolve; });
    const delayOriginalAreas = async route => {
      markOriginalAreasRequested();
      await originalAreasGate;
      await route.continue();
    };
    await page.route(originalAreasUrl, delayOriginalAreas);
    try {
      await projectRow(project).click();
      await originalAreasRequested;
      await projectRow(otherProject).click();
      await page.locator('.detail-grid').waitFor();
      const lateResponse = page.waitForResponse(response => response.url() === originalAreasUrl && response.status() === 200);
      releaseOriginalAreas();
      await lateResponse;
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.title-line h2').innerText(), otherProject.name);
      assert.equal(await page.locator('.detail-grid').count(), 1);
      assert.equal(await page.getByRole('region', { name: 'Danh mục thiết bị' }).count(), 1);
      assert.equal(await page.getByRole('region', { name: 'Công việc thi công' }).count(), 1);
      assert.equal(await findRow(swCode).count(), 0);
      const shownAreaCodes = (await page.locator('.area-copy small').allTextContents()).map(value => value.split(' · ')[0]).sort();
      const shownSystemCodes = (await page.locator('.system-row .system-copy small').allTextContents()).map(value => value.split(' · ')[0]).sort();
      assert.deepEqual(shownAreaCodes, otherAreas.map(area => area.code).sort());
      assert.deepEqual(shownSystemCodes, otherSystems.map(system => system.code).sort());
    } finally {
      releaseOriginalAreas();
      await page.unroute(originalAreasUrl, delayOriginalAreas);
    }
    console.log('PASS direct A → B: old detail hidden while B loads; late A GET cannot replace B');
    await projectRow(project).click();
    await findRow(swCode).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (process.env.DEVICE_ARTIFACT_DIR) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.DEVICE_ARTIFACT_DIR, 'device-manager-desktop.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('.project-row').filter({ hasText: project.code }).click();
    await findRow(swCode).waitFor();
    assert.equal(await panel.locator('.device-row').count(), before.length + 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (process.env.DEVICE_ARTIFACT_DIR) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.DEVICE_ARTIFACT_DIR, 'device-manager-390.png') });
    }
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await signIn(technicianEmail, local.DEMO_TECHNICIAN_PASSWORD);
    await findRow(swCode).waitFor();
    assert.equal(await panel.getByRole('button', { name: '＋ Thiết bị', exact: true }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'Sửa', exact: true }).count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'Xóa', exact: true }).count(), 0);
    await row.getByRole('button', { name: 'Xem đầy đủ', exact: true }).click();
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Sửa thiết bị', exact: true }).count(), 0);
    assert.ok((await page.getByRole('dialog').innerText()).includes('SERIAL-SWITCH'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (process.env.DEVICE_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.DEVICE_ARTIFACT_DIR, 'device-technician-390.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await page.reload();
    await page.locator('.project-row').filter({ hasText: project.code }).click();
    await findRow(swCode).waitFor();
    assert.equal(await panel.locator('.device-row').count(), before.length + 6);
    assert.equal(await page.getByRole('region', { name: 'Công việc thi công', exact: true }).count(), 1);
    console.log('PASS reload persistence, TECHNICIAN read-only/full view, Task panel present, 390px page/dialog without horizontal overflow');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    const own = (await get(endpoint)).filter(device => device.code.startsWith(prefix));
    for (const device of [...own.filter(device => device.type !== 'RACK'), ...own.filter(device => device.type === 'RACK')]) {
      const response = await fetch(`${api}${endpoint}/${device.id}`, { method: 'DELETE', headers });
      assert.equal(response.status, 204);
    }
    assert.deepEqual((await get(endpoint)).map(device => device.id), before.map(device => device.id));
    console.log('PASS cleanup: only this run\'s Device fixtures removed; pre-existing inventory unchanged');
  }
}

run().catch(error => {
  // Only assertion messages contain UI text/status; avoid logging request/session objects.
  let message = error.stack || error.message;
  for (const [key, value] of Object.entries(local)) if (/PASSWORD|SECRET|TOKEN/.test(key) && value) message = message.replaceAll(value, '[redacted]');
  message = message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
  console.error(error.name, message);
  process.exitCode = 1;
});
