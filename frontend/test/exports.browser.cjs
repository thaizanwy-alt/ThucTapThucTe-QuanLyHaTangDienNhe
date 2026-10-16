// Optional read-only Chrome/API smoke. Uses existing local demo credentials and Projects;
// creates no records and never prints passwords, tokens or downloaded contents.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const ExcelJS = require('exceljs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const local = dotenv.parse(require('node:fs').readFileSync(path.resolve(__dirname, '../../backend/.env')));
const api = process.env.EXPORT_API_URL || 'http://localhost:3000';
const web = process.env.EXPORT_WEB_URL || 'http://localhost:5173';
const trialCode = process.env.EXPORT_TRIAL_CODE || 'EVIDENCE-UI-F47A47EE';
const demoCode = process.env.EXPORT_DEVICE_PROJECT_CODE || 'CT-DEMO-ELV-01';
const python = process.env.EXPORT_PYTHON_BIN || 'python';

async function run() {
  const credentials = role => ({
    email: process.env[`DEMO_${role}_EMAIL`] || local[`DEMO_${role}_EMAIL`] ||
      (role === 'MANAGER' ? 'manager.demo@example.local' : 'technician.demo@example.local'),
    password: process.env[`DEMO_${role}_PASSWORD`] || local[`DEMO_${role}_PASSWORD`],
  });
  assert.ok(credentials('MANAGER').password && credentials('TECHNICIAN').password, 'Local demo credentials required');
  const health = await fetch(api + '/health'); assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'connected');
  const login = async role => {
    const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials(role)) });
    assert.equal(response.status, 201, `${role} login must work`);
    return (await response.json()).accessToken;
  };
  const managerToken = await login('MANAGER'), technicianToken = await login('TECHNICIAN');
  const get = async (url, token = managerToken) => {
    const response = await fetch(api + url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, `GET ${url}`); return response.json();
  };
  const projects = await get('/projects');
  const trial = projects.find(p => p.code === trialCode);
  assert.ok(trial, 'Requires existing acceptance trial Project; does not create one');
  const deviceProject = projects.find(p => p.code === demoCode) || trial;
  const confirmed = (await get(`/projects/${trial.id}/acceptances`)).find(a => a.status === 'CONFIRMED');
  assert.ok(confirmed, 'Requires an existing CONFIRMED acceptance');
  const existingDevices = await get(`/projects/${deviceProject.id}/devices`);
  const portDevice = existingDevices.find(d => ['SWITCH', 'PATCH_PANEL', 'NETWORK_OUTLET', 'CAMERA', 'AP'].includes(d.type));
  const existingPorts = portDevice ? await get(`/projects/${deviceProject.id}/devices/${portDevice.id}/ports`) : [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-export-browser-'));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const pageErrors = []; page.on('pageerror', () => pageErrors.push('Browser runtime error'));
    await page.addInitScript(() => {
      const active = new Set(); window.__activeExportUrls = active;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
      URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    });
    const loginUi = async role => {
      await page.goto(web);
      await page.getByLabel('Email').fill(credentials(role).email);
      await page.getByLabel('Mật khẩu').fill(credentials(role).password);
      await page.getByRole('button', { name: 'Đăng nhập' }).click();
      await page.locator('.project-rail').waitFor();
    };
    const select = async project => {
      if (!await page.locator('.project-row').filter({ hasText: project.code }).isVisible())
        await page.getByRole('button', { name: /Danh sách công trình/ }).click();
      await page.locator('.project-row').filter({ hasText: project.code }).click();
      await page.locator('.overview-links').waitFor();
    };
    const download = async label => {
      const transfer = page.waitForEvent('download', { timeout: 30000 });
      await page.getByRole('button', { name: label }).click();
      const result = await transfer;
      const filename = path.join(directory, path.basename(result.suggestedFilename()));
      await result.saveAs(filename);
      return filename;
    };

    await loginUi('MANAGER'); await select(trial);
    assert.equal(await page.locator('.overview-links button').count(), 6);
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    await page.getByRole('button', { name: 'Tải PDF' }).waitFor();
    assert.match(await page.locator('.acceptance-export').innerText(), /snapshot/i);
    const pdf = await download('Tải PDF');
    const parsed = JSON.parse(execFileSync(python, [path.resolve(__dirname, '../../backend/test/read-export-pdf.py'), pdf], { encoding: 'utf8' }));
    const pdfText = parsed.pages.join('\n');
    assert.ok(pdfText.includes(trial.code)); assert.ok(pdfText.includes(confirmed.code));
    await page.getByRole('button', { name: 'Đóng' }).last().click();
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(deviceProject);
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    const deviceFile = await download('Xuất Excel thiết bị');
    const deviceBook = new ExcelJS.Workbook(); await deviceBook.xlsx.readFile(deviceFile);
    assert.deepEqual(deviceBook.worksheets.map(s => s.name), ['Thông tin', 'Thiết bị', 'Tủ']);
    assert.match(String(deviceBook.getWorksheet('Thông tin').getRow(2).getCell(2).value), new RegExp(deviceProject.code));
    if (existingDevices.length) assert.ok(existingDevices.some(d =>
      deviceBook.getWorksheet('Thiết bị').getColumn(1).values.includes(d.code)));
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Đấu nối/ }).click();
    const connectionFile = await download('Xuất Excel đấu nối');
    const connectionBook = new ExcelJS.Workbook(); await connectionBook.xlsx.readFile(connectionFile);
    assert.deepEqual(connectionBook.worksheets.map(s => s.name), ['Thông tin', 'Cổng', 'Dây', 'Tra cứu']);
    assert.match(String(connectionBook.getWorksheet('Thông tin').getRow(2).getCell(2).value), new RegExp(deviceProject.code));
    if (existingPorts.length) assert.ok(connectionBook.getWorksheet('Cổng').getColumn(2).values.includes(existingPorts[0].code),
      'current Project port code must appear in workbook');

    for (const status of [403, 404, 409, 413, 503]) {
      await page.route('**/exports/connections.xlsx', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'Smoke error' }) }));
      await page.getByRole('button', { name: 'Xuất Excel đấu nối' }).click();
      await page.getByRole('alert').filter({ hasText: 'Smoke error' }).waitFor();
      await page.unroute('**/exports/connections.xlsx');
    }
    let lateDownloads = 0;
    page.on('download', () => { lateDownloads++; });
    const canceledDownload = async (pattern, label, leave) => {
      let release, requestSeen, finishRoute;
      const gate = new Promise(resolve => { release = resolve; });
      const seen = new Promise(resolve => { requestSeen = resolve; });
      const routeDone = new Promise(resolve => { finishRoute = resolve; });
      let routeCount = 0;
      await page.route(pattern, async route => {
        routeCount++; requestSeen(); await gate;
        try { await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: await fs.readFile(connectionFile) }); }
        catch { /* unmount/abort is expected */ }
        finally { finishRoute(); }
      });
      const before = lateDownloads;
      await page.getByRole('button', { name: label }).click(); await seen;
      assert.equal(await page.getByRole('button', { name: 'Đang xuất…' }).isDisabled(), true);
      await leave(); release(); await routeDone; await page.waitForTimeout(100);
      assert.equal(routeCount, 1, 'only one export request while busy');
      assert.equal(lateDownloads, before, 'late response must not start a download');
      await page.unroute(pattern);
    };
    await canceledDownload('**/exports/connections.xlsx', 'Xuất Excel đấu nối',
      () => page.getByRole('button', { name: 'Về tổng quan' }).click());
    await select(trial);
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    await canceledDownload('**/export.pdf', 'Tải PDF',
      () => page.getByRole('button', { name: 'Đóng' }).last().click());
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(deviceProject);
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    await canceledDownload('**/exports/devices.xlsx', 'Xuất Excel thiết bị', async () => {
      await page.getByRole('button', { name: /Danh sách công trình/ }).click();
      await select(trial);
    });
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__activeExportUrls.size), 0, 'download object URLs must be revoked');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), '390 px layout must not overflow');
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    await page.route('**/exports/devices.xlsx', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Smoke expired session' }) }));
    await page.getByRole('button', { name: 'Xuất Excel thiết bị' }).click();
    await page.getByRole('heading', { name: 'Đăng nhập' }).waitFor();
    await page.unroute('**/exports/devices.xlsx');
    await loginUi('TECHNICIAN'); await select(deviceProject);
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Xuất Excel thiết bị' }).count(), 0);
    const denied = await fetch(`${api}/projects/${deviceProject.id}/exports/devices.xlsx`, { headers: { Authorization: `Bearer ${technicianToken}` } });
    assert.equal(denied.status, 403);
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Đấu nối/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Xuất Excel đấu nối' }).count(), 0);
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(trial); await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    assert.equal(await page.getByRole('button', { name: 'Tải PDF' }).count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log('PASS Chrome/API: three downloaded files contain correct Project/acceptance; roles, JSON errors, late response, 390 px');
  } finally {
    await browser.close();
    const root = path.resolve(os.tmpdir());
    if (!path.resolve(directory).startsWith(root + path.sep) || !path.basename(directory).startsWith('elv-export-browser-'))
      throw new Error('Refusing to remove unexpected browser test directory');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(`FAIL export browser smoke: ${error.message}`); process.exitCode = 1; });
