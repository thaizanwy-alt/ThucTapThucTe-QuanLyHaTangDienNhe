// Optional read-only Chrome/API smoke. Uses existing local demo credentials and Projects;
// creates no records and never prints passwords, tokens or downloaded contents.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const yauzl = require('yauzl');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const readWorkbook = require('../../backend/test/read-xlsx.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const local = dotenv.parse(require('node:fs').readFileSync(path.resolve(__dirname, '../../backend/.env')));
const api = process.env.EXPORT_API_URL || 'http://localhost:3000';
const web = process.env.EXPORT_WEB_URL || 'http://localhost:5173';
const trialCode = process.env.EXPORT_TRIAL_CODE || 'EVIDENCE-UI-F47A47EE';
const demoCode = process.env.EXPORT_DEVICE_PROJECT_CODE || 'CT-DEMO-ELV-01';
const acceptanceCode = process.env.EXPORT_ACCEPTANCE_CODE;
const python = process.env.EXPORT_PYTHON_BIN || 'python';
const stage = name => console.error(`Export smoke stage: ${name}`);
const bounded = (promise, name, ms = 15000) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms} ms`)), ms);
  promise.finally(() => clearTimeout(timer)).catch(() => {});
})]);

function readZip(filename) {
  return new Promise((resolve, reject) => {
    let zip, stream, done = false;
    const entries = new Map();
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer);
      stream?.destroy(); zip?.close();
      if (error) reject(error); else resolve(entries);
    };
    const timer = setTimeout(() => finish(new Error('ZIP read timed out after 15000 ms')), 15000);
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
      if (done) { archive?.close(); return; }
      if (error) return finish(error);
      zip = archive;
      zip.once('error', finish);
      zip.on('entry', entry => zip.openReadStream(entry, (streamError, current) => {
        if (done) { current?.destroy(); return; }
        if (streamError) return finish(streamError);
        stream = current;
        const chunks = [];
        current.on('data', chunk => chunks.push(chunk));
        current.once('error', finish);
        current.once('end', () => { stream = null; entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      }));
      zip.once('end', () => finish()); zip.readEntry();
    });
  });
}

async function run() {
  const credentials = role => ({
    email: process.env[`DEMO_${role}_EMAIL`] || local[`DEMO_${role}_EMAIL`] ||
      (role === 'MANAGER' ? 'manager.demo@example.local' : 'technician.demo@example.local'),
    password: process.env[`DEMO_${role}_PASSWORD`] || local[`DEMO_${role}_PASSWORD`],
  });
  assert.ok(credentials('MANAGER').password && credentials('TECHNICIAN').password, 'Local demo credentials required');
  stage('health');
  const health = await fetch(api + '/health', { signal: AbortSignal.timeout(15000) }); assert.equal(health.status, 200);
  assert.equal((await health.json()).database, 'connected');
  const login = async role => {
    const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials(role)), signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 201, `${role} login must work`);
    return (await response.json()).accessToken;
  };
  stage('api-login');
  const managerToken = await login('MANAGER'), technicianToken = await login('TECHNICIAN');
  const get = async (url, token = managerToken) => {
    const response = await fetch(api + url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, `GET ${url}`); return response.json();
  };
  const projects = await get('/projects');
  const trial = projects.find(p => p.code === trialCode);
  assert.ok(trial, 'Requires existing acceptance trial Project; does not create one');
  const deviceProject = projects.find(p => p.code === demoCode) || trial;
  const acceptanceRows = await get(`/projects/${trial.id}/acceptances`);
  const confirmed = acceptanceCode ? acceptanceRows.find(a => a.code === acceptanceCode && a.status === 'CONFIRMED') :
    acceptanceRows.find(a => a.status === 'CONFIRMED');
  const draft = acceptanceRows.find(a => a.status === 'DRAFT');
  const replaced = acceptanceRows.find(a => a.status === 'CONFIRMED' && a.replacedById && a.id !== confirmed?.id);
  assert.ok(confirmed, `Requires CONFIRMED acceptance${acceptanceCode ? ` ${acceptanceCode}` : ''}`);
  const existingDevices = await get(`/projects/${deviceProject.id}/devices`);
  const portDevice = existingDevices.find(d => ['SWITCH', 'PATCH_PANEL', 'NETWORK_OUTLET', 'CAMERA', 'AP'].includes(d.type));
  const existingPorts = portDevice ? await get(`/projects/${deviceProject.id}/devices/${portDevice.id}/ports`) : [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-export-browser-'));
  stage('chrome-launch');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);
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

    stage('chrome-login');
    await loginUi('MANAGER'); await select(trial);
    if (process.env.EXPORT_SMOKE_CASE === 'login') { console.log('PASS isolated Chrome login/project selection'); return; }
    assert.equal(await page.locator('.overview-links button').count(), 6);
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    await page.getByRole('button', { name: 'Tải PDF' }).waitFor();
    assert.match(await page.locator('.acceptance-export').innerText(), /snapshot/i);
    stage('pdf-download');
    const pdf = await download('Tải PDF');
    const parsed = JSON.parse(execFileSync(python, [path.resolve(__dirname, '../../backend/test/read-export-pdf.py'), pdf], { encoding: 'utf8', timeout: 15000 }));
    const pdfText = parsed.pages.join('\n');
    assert.ok(pdfText.includes(trial.code)); assert.ok(pdfText.includes(confirmed.code));
    stage('zip-download');
    const zipFile = await download('Tải gói bàn giao ZIP');
    stage('zip-read');
    const zipEntries = await readZip(zipFile);
    const manifest = JSON.parse(zipEntries.get('manifest.json').toString('utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(zipEntries.has('acceptance/acceptance.pdf'));
    assert.ok(zipEntries.has('current/devices.xlsx'));
    assert.ok(zipEntries.has('current/connections.xlsx'));
    assert.equal(manifest.acceptance.code, confirmed.code);
    for (const file of manifest.files) {
      const bytes = zipEntries.get(file.path);
      assert.ok(bytes, `ZIP contains manifest entry ${file.path}`);
      assert.equal(bytes.length, file.sizeBytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    const zipPdf = path.join(directory, 'zip-acceptance.pdf');
    await fs.writeFile(zipPdf, zipEntries.get('acceptance/acceptance.pdf'));
    const zipPdfText = JSON.parse(execFileSync(python, [path.resolve(__dirname, '../../backend/test/read-export-pdf.py'), zipPdf], { encoding: 'utf8', timeout: 15000 })).pages.join('\n');
    assert.ok(zipPdfText.includes(confirmed.code)); assert.ok(zipPdfText.includes(trial.code));
    const zipDevices = path.join(directory, 'zip-devices.xlsx'), zipConnections = path.join(directory, 'zip-connections.xlsx');
    await fs.writeFile(zipDevices, zipEntries.get('current/devices.xlsx'));
    await fs.writeFile(zipConnections, zipEntries.get('current/connections.xlsx'));
    stage('zip-workbooks');
    const zipDeviceBook = await bounded(readWorkbook(zipDevices), 'ZIP device workbook'), zipConnectionBook = await bounded(readWorkbook(zipConnections), 'ZIP connection workbook');
    assert.deepEqual(zipDeviceBook.worksheets.map(s => s.name), ['Thông tin', 'Thiết bị', 'Tủ']);
    assert.deepEqual(zipConnectionBook.worksheets.map(s => s.name), ['Thông tin', 'Cổng', 'Dây', 'Tra cứu']);
    assert.match(String(zipDeviceBook.getWorksheet('Thông tin').getRow(2).getCell(2).value), new RegExp(deviceProject.code));
    if (manifest.files.some(file => file.kind === 'pinned-evidence'))
      assert.ok([...zipEntries.keys()].some(name => name.startsWith('evidence/')), 'pinned evidence content is present');
    if (process.env.EXPORT_SMOKE_CASE === 'zip') { console.log('PASS isolated Chrome ZIP download/content'); return; }
    stage('draft-replacement-ui');
    if (draft) {
      await page.getByRole('button', { name: 'Đóng' }).last().click();
      await page.locator('.item-list li').filter({ hasText: draft.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
      assert.equal(await page.getByRole('button', { name: 'Tải gói bàn giao ZIP' }).count(), 0, 'DRAFT has no ZIP action');
      await page.getByRole('button', { name: 'Đóng' }).last().click();
      await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    }
    if (replaced) {
      await page.getByRole('button', { name: 'Đóng' }).last().click();
      await page.locator('.item-list li').filter({ hasText: replaced.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
      await page.getByRole('button', { name: 'Tải gói bàn giao ZIP' }).waitFor();
      assert.match(await page.locator('.acceptance-dialog').innerText(), /đã được thay thế/i);
      await page.getByRole('button', { name: 'Đóng' }).last().click();
      await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    }
    await page.getByRole('button', { name: 'Đóng' }).last().click();
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(deviceProject);
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    const deviceFile = await download('Xuất Excel thiết bị');
    stage('device-export');
    const deviceBook = await bounded(readWorkbook(deviceFile), 'device workbook');
    assert.deepEqual(deviceBook.worksheets.map(s => s.name), ['Thông tin', 'Thiết bị', 'Tủ']);
    assert.match(String(deviceBook.getWorksheet('Thông tin').getRow(2).getCell(2).value), new RegExp(deviceProject.code));
    if (existingDevices.length) assert.ok(existingDevices.some(d =>
      deviceBook.getWorksheet('Thiết bị').getColumn(1).values.includes(d.code)));
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Đấu nối/ }).click();
    const connectionFile = await download('Xuất Excel đấu nối');
    stage('connection-export');
    const connectionBook = await bounded(readWorkbook(connectionFile), 'connection workbook');
    assert.deepEqual(connectionBook.worksheets.map(s => s.name), ['Thông tin', 'Cổng', 'Dây', 'Tra cứu']);
    assert.match(String(connectionBook.getWorksheet('Thông tin').getRow(2).getCell(2).value), new RegExp(deviceProject.code));
    if (existingPorts.length) assert.ok(connectionBook.getWorksheet('Cổng').getColumn(2).values.includes(existingPorts[0].code),
      'current Project port code must appear in workbook');
    if (process.env.EXPORT_SMOKE_CASE === 'workbooks') { console.log('PASS isolated Chrome PDF/ZIP/XLSX downloads'); return; }

    for (const status of [403, 404, 409, 413, 503]) {
      await page.route('**/exports/connections.xlsx', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'Smoke error' }) }));
      await page.getByRole('button', { name: 'Xuất Excel đấu nối' }).click();
      await page.getByRole('alert').filter({ hasText: 'Smoke error' }).waitFor();
      await page.unroute('**/exports/connections.xlsx');
    }
    let lateDownloads = 0;
    page.on('download', () => { lateDownloads++; });
    const canceledDownload = async (pattern, label, leave) => {
      stage(`abort-${label}`);
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
      try {
        const before = lateDownloads;
        await page.getByRole('button', { name: label }).click(); await bounded(seen, `${label} request`);
        assert.equal(await page.getByRole('button', { name: 'Đang xuất…' }).isDisabled(), true);
        await page.getByRole('button', { name: 'Đang xuất…' }).evaluate(button => button.click());
        await leave(); release(); await bounded(routeDone, `${label} route release`); await page.waitForTimeout(100);
        assert.equal(routeCount, 1, 'only one export request while busy');
        assert.equal(lateDownloads, before, 'late response must not start a download');
      } finally {
        release();
        await page.unroute(pattern);
      }
    };
    stage('late-response-cases');
    await canceledDownload('**/exports/connections.xlsx', 'Xuất Excel đấu nối',
      () => page.getByRole('button', { name: 'Về tổng quan' }).click());
    if (process.env.EXPORT_SMOKE_CASE === 'cancel') { console.log('PASS isolated Chrome aborted connection export'); return; }
    await select(trial);
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    await canceledDownload('**/export.pdf', 'Tải PDF',
      () => page.getByRole('button', { name: 'Đóng' }).last().click());
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(trial);
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    await canceledDownload('**/handover-package.zip', 'Tải gói bàn giao ZIP',
      () => page.getByRole('button', { name: 'Đóng' }).last().click());
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    for (const simulated of [
      { status: 503, message: 'An XLSX export is already running', headers: { 'Retry-After': '1' }, expected: 'đợi 1 giây' },
      { status: 504, message: 'Handover package timed out', headers: {}, expected: 'hết thời gian' },
      { status: 413, message: 'Handover package exceeds byte limit', headers: {}, expected: 'vượt giới hạn' },
      { status: 409, message: 'Pinned evidence checksum differs from snapshot', headers: {}, expected: 'file minh chứng ghim' },
      { status: 409, message: 'Pinned evidence file is missing', headers: {}, expected: 'file minh chứng ghim' },
    ]) {
      await page.route('**/handover-package.zip', route => route.fulfill({ status: simulated.status, contentType: 'application/json',
        headers: { ...simulated.headers, 'Access-Control-Expose-Headers': 'Retry-After' }, body: JSON.stringify({ message: simulated.message }) }));
      await page.getByRole('button', { name: 'Tải gói bàn giao ZIP' }).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), new RegExp(simulated.expected));
      await page.unroute('**/handover-package.zip');
    }
    if (process.env.EXPORT_SMOKE_CASE === 'errors') { console.log('PASS isolated Chrome export errors'); return; }
    await page.getByRole('button', { name: 'Đóng' }).last().click();
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
    stage('technician-ui');
    await loginUi('TECHNICIAN'); await select(deviceProject);
    await page.locator('.overview-links').getByRole('button', { name: /Thiết bị/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Xuất Excel thiết bị' }).count(), 0);
    const denied = await fetch(`${api}/projects/${deviceProject.id}/exports/devices.xlsx`, { headers: { Authorization: `Bearer ${technicianToken}` }, signal: AbortSignal.timeout(15000) });
    assert.equal(denied.status, 403);
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Đấu nối/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Xuất Excel đấu nối' }).count(), 0);
    await page.getByRole('button', { name: 'Về tổng quan' }).click();
    await select(trial); await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    await page.getByRole('button', { name: 'Hồ sơ nghiệm thu' }).click();
    await page.locator('.item-list li').filter({ hasText: confirmed.code }).getByRole('button', { name: 'Xem hồ sơ' }).click();
    assert.equal(await page.getByRole('button', { name: 'Tải PDF' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Tải gói bàn giao ZIP' }).count(), 0);
    const zipDenied = await fetch(`${api}/projects/${trial.id}/acceptances/${confirmed.id}/handover-package.zip`, { headers: { Authorization: `Bearer ${technicianToken}` }, signal: AbortSignal.timeout(15000) });
    assert.equal(zipDenied.status, 403, 'TECHNICIAN cannot access detailed handover ZIP');
    assert.deepEqual(pageErrors, []);
    console.log('PASS Chrome/API: PDF, ZIP and two XLSX files contain correct Project/acceptance; roles, simulated JSON errors, late response, 390 px');
  } finally {
    await browser.close();
    const root = path.resolve(os.tmpdir());
    if (!path.resolve(directory).startsWith(root + path.sep) || !path.basename(directory).startsWith('elv-export-browser-'))
      throw new Error('Refusing to remove unexpected browser test directory');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(`FAIL export browser smoke: ${error.message}`); process.exitCode = 1; });
