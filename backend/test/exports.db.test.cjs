// All fixture writes are confined to a disposable PostgreSQL database and temp storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const readWorkbook = require('./read-xlsx.cjs');
const { dataSource } = require('../dist/database/data-source');
const { ExportsService, validSnapshot } = require('../dist/exports/exports.service');
const { workbook, pdf, RowBudget, exportLimits } = require('../dist/exports/exports.render');
const { EvidenceStorage } = require('../dist/evidence/evidence.storage');
const { User } = require('../dist/users/user.entity');
const { Project } = require('../dist/projects/project.entity');
const { ProjectSystem } = require('../dist/projects/project-system.entity');
const { ProjectArea } = require('../dist/projects/project-area.entity');
const { ProjectDevice } = require('../dist/devices/project-device.entity');
const { DeviceNetworkProfile } = require('../dist/devices/device-network-profile.entity');
const { DevicePort } = require('../dist/connections/device-port.entity');
const { PhysicalConnection } = require('../dist/connections/physical-connection.entity');
const { ConnectionEndpoint } = require('../dist/connections/connection-endpoint.entity');
const { ProjectTask } = require('../dist/tasks/project-task.entity');
const { EvidenceAttachment } = require('../dist/evidence/evidence.entity');
const { ProjectAcceptance, AcceptanceSnapshot, AcceptanceEvidence } = require('../dist/acceptances/acceptance.entities');

const rejects = (promise, status) => assert.rejects(promise, error => error.getStatus?.() === status);

const { execFileSync } = require('node:child_process');
const inspectPdf = file => {
  const result = JSON.parse(execFileSync(process.env.EXPORT_PYTHON_BIN || 'python', [path.join(__dirname, 'read-export-pdf.py'), file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  return { ...result, text: result.pages.join('\n') };
};
const readPdf = async file => { try { return inspectPdf(file.path); } finally { await file.cleanup(); } };
const bounded = async (promise, ms) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), ms); })]); } finally { clearTimeout(timer); } };


test('handover exports: isolated PostgreSQL, HTTP, PDF and XLSX', { timeout: 180000 }, async t => {
  const name = 'exports_test_' + randomUUID().replaceAll('-', '');
  const o = dataSource.options;
  const admin = new Client({ host: o.host, port: o.port, user: o.username, password: o.password, database: o.database });
  const db = new DataSource({ ...o, database: name });
  const previous = { DB_NAME: process.env.DB_NAME, JWT_SECRET: process.env.JWT_SECRET, EVIDENCE_STORAGE_DIR: process.env.EVIDENCE_STORAGE_DIR };
  const tempBaseline = new Set(await fs.readdir(os.tmpdir()));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-export-storage-'));
  process.env.EVIDENCE_STORAGE_DIR = root;
  let created = false, app;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    created = true; await db.initialize(); await db.runMigrations();
    const manager = await db.getRepository(User).save({ email: 'manager@export.invalid', role: 'MANAGER', isActive: true, passwordHash: randomBytes(32).toString('hex') });
    const tech = await db.getRepository(User).save({ email: 'tech@export.invalid', role: 'TECHNICIAN', isActive: true, passwordHash: randomBytes(32).toString('hex') });
    const project = await db.getRepository(Project).save({ code: 'EXPORT-A', name: 'Tòa nhà kiểm thử tiếng Việt' });
    const foreign = await db.getRepository(Project).save({ code: 'EXPORT-B', name: 'Khác' });
    const system = await db.getRepository(ProjectSystem).save({ projectId: project.id, code: 'CAMERA', name: 'Camera', category: 'CAMERA' });
    const area = await db.getRepository(ProjectArea).save({ projectId: project.id, code: 'F01', name: 'Tầng một', type: 'FLOOR' });
    const rack = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'RACK-01', name: 'Tủ chính', type: 'RACK', areaId: area.id, capacityU: 42 });
    const sw = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'SW-01', name: 'Switch', type: 'SWITCH', rackId: rack.id, mountMode: 'U', startU: 2, heightU: 1 });
    const camera = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'CAM-01', name: '=HYPERLINK("unsafe")', type: 'CAMERA', areaId: area.id });
    const camera2 = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'CAM-02', name: 'Camera qua ổ mạng', type: 'CAMERA', areaId: area.id });
    const outlet = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'OUT-01', name: 'Ổ mạng', type: 'NETWORK_OUTLET', areaId: area.id });
    const panel = await db.getRepository(ProjectDevice).save({ projectId: project.id, code: 'PP-01', name: 'Patch panel', type: 'PATCH_PANEL', rackId: rack.id });
    const pCamera = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: camera.id, code: 'ETH1' });
    const pCamera2 = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: camera2.id, code: 'ETH1' });
    const pOutlet = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: outlet.id, code: 'P01' });
    const pPanel = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: panel.id, code: 'P01' });
    const pSwitch = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: sw.id, code: 'P01', accessVlanId: 20, poeEnabled: false });
    const pSwitch2 = await db.getRepository(DevicePort).save({ projectId: project.id, deviceId: sw.id, code: 'P02', accessVlanId: 30, poeEnabled: true });
    await db.getRepository(DeviceNetworkProfile).save({ projectId: project.id, deviceId: camera.id, addressMode: 'DHCP', ipAddress: null, macAddress: 'AA:BB:CC:DD:EE:FF' });
    await db.transaction(async m => {
      const c = await m.getRepository(PhysicalConnection).save({ projectId: project.id, kind: 'PATCH', label: 'Dây camera' });
      await m.getRepository(ConnectionEndpoint).save([
        { projectId: project.id, connectionId: c.id, end: 'A', portId: pCamera.id, side: 'SINGLE' },
        { projectId: project.id, connectionId: c.id, end: 'B', portId: pSwitch.id, side: 'SINGLE' },
      ]);
      for (const [kind, a, aSide, b, bSide] of [
        ['PATCH', pCamera2, 'SINGLE', pOutlet, 'FRONT'],
        ['FIXED', pOutlet, 'REAR', pPanel, 'REAR'],
        ['PATCH', pPanel, 'FRONT', pSwitch2, 'SINGLE'],
      ]) {
        const wire = await m.getRepository(PhysicalConnection).save({ projectId: project.id, kind });
        await m.getRepository(ConnectionEndpoint).save([
          { projectId: project.id, connectionId: wire.id, end: 'A', portId: a.id, side: aSide },
          { projectId: project.id, connectionId: wire.id, end: 'B', portId: b.id, side: bSide },
        ]);
      }
    });
    const task = await db.getRepository(ProjectTask).save({ projectId: project.id, systemId: system.id, code: 'TASK-01', title: 'Task', assigneeId: tech.id });
    const fileData = Buffer.from('sample pinned evidence');
    const key = randomUUID();
    await fs.mkdir(path.join(root, 'files'), { recursive: true });
    await fs.writeFile(path.join(root, 'files', key), fileData);
    const attachment = await db.getRepository(EvidenceAttachment).save({ projectId: project.id, taskId: task.id, storageKey: key,
      originalName: 'ảnh hiện trường.png', mimeType: 'image/png', sizeBytes: fileData.length,
      sha256: createHash('sha256').update(fileData).digest('hex'), uploadedById: manager.id,
      caption: 'Ảnh lắp đặt', idempotencyKey: randomUUID(), fingerprint: 'f'.repeat(64) });
    const acceptance = await db.getRepository(ProjectAcceptance).save({ projectId: project.id, systemId: system.id,
      code: 'AC-01', title: 'Nghiệm thu camera', status: 'CONFIRMED', createdById: manager.id,
      confirmedById: manager.id, confirmedAt: new Date() });
    const snapshot = { acceptance: { code: acceptance.code, title: acceptance.title, note: null, replacesId: null, replacementReason: null },
      project: { code: project.code, name: project.name }, system: { code: system.code, name: system.name },
      inspections: [{ code: 'SHEET-01', title: 'Kiểm tra tiếng Việt', area: { code: area.code, name: area.name }, device: null,
        items: [{ code: 'TEST-01', title: 'Chất lượng kết nối', result: 'PASS', note: 'Đạt' }], issues: [] }],
      evidence: [{ id: attachment.id, originalName: attachment.originalName, caption: attachment.caption,
        sizeBytes: attachment.sizeBytes, sha256: attachment.sha256 }],
      actors: [{ id: manager.id, email: manager.email }], confirmedBy: { id: manager.id, email: manager.email },
      summary: { inspectionCount: 1, itemCount: 1, evidenceCount: 1 } };
    await db.getRepository(AcceptanceSnapshot).save({ projectId: project.id, acceptanceId: acceptance.id, schemaVersion: 1,
      sourceFingerprint: 'a'.repeat(64), content: snapshot });
    await db.getRepository(AcceptanceEvidence).save({ projectId: project.id, acceptanceId: acceptance.id,
      evidenceId: attachment.id, pinnedStorageKey: key });
    const service = new ExportsService(db, new EvidenceStorage());
    const selectedCase = process.env.EXPORT_TEST_CASE;
    const runCase = (name, fn) => selectedCase && name !== selectedCase
      ? t.test(name, { skip: 'Isolated PDF regression' }, fn) : t.test(name, fn);

    await runCase('PDF text proves snapshot history, replacement and each pinned-file warning', async () => {
      assert.equal(validSnapshot(snapshot), true);
      for (const bad of [{ ...snapshot, project: null }, { ...snapshot, project: { code: ' ', name: 'Missing' } },
        { ...snapshot, inspections: [{ ...snapshot.inspections[0], items: [] }] },
        { ...snapshot, summary: { ...snapshot.summary, itemCount: 2 } }]) assert.equal(validSnapshot(bad), false);
      const first = await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager));
      assert.equal(first.invalidUnicodeMappings, 0);
      assert.match(first.text, /Tòa nhà kiểm thử tiếng Việt/);
      assert.match(first.text, /KHỚP SHA-256/);
      assert.doesNotMatch(first.text, /storageKey|passwordHash|pinnedStorageKey/);
      await db.getRepository(Project).update(project.id, { name: 'Tên công trình đã đổi' });
      const old = await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager));
      assert.match(old.text, /Tòa nhà kiểm thử tiếng Việt/);
      assert.doesNotMatch(old.text, /Tên công trình đã đổi/);
      assert.match(old.text, /Chưa có bản thay thế xác nhận/);
      await db.getRepository(ProjectAcceptance).save({ projectId: project.id, systemId: system.id,
        code: 'AC-02', title: 'Thay thế', status: 'CONFIRMED', createdById: manager.id,
        confirmedById: manager.id, confirmedAt: new Date(), replacesId: acceptance.id, replacementReason: 'Sửa sai' });
      const replaced = await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager));
      assert.match(replaced.text, /Bản lịch sử, đã được thay bằng AC-02/);
      assert.match(replaced.text, /Tòa nhà kiểm thử tiếng Việt/);
      await db.getRepository(EvidenceAttachment).update(attachment.id, { deletedAt: new Date(), deleteReason: 'Soft deleted', deletedById: manager.id });
      assert.match((await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager))).text, /KHỚP SHA-256/);
      await fs.writeFile(path.join(root, 'files', key), Buffer.from('wrong'));
      assert.match((await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager))).text, /SAI SHA-256/);
      await fs.unlink(path.join(root, 'files', key));
      assert.match((await readPdf(await service.acceptancePdf(project.id, acceptance.id, manager))).text, /THIẾU FILE/);
      const unavailable = new ExportsService(db, { root: async () => { throw new Error('injected unavailable storage'); } });
      assert.match((await readPdf(await unavailable.acceptancePdf(project.id, acceptance.id, manager))).text, /KHÔNG THỂ KIỂM TRA/);
      await db.getRepository(AcceptanceSnapshot).update({ acceptanceId: acceptance.id }, { content: { ...snapshot, project: null } });
      await rejects(service.acceptancePdf(project.id, acceptance.id, manager), 409);
      await db.getRepository(AcceptanceSnapshot).update({ acceptanceId: acceptance.id }, { content: snapshot });
      await rejects(service.acceptancePdf(foreign.id, acceptance.id, manager), 404);
      await rejects(service.acceptancePdf(project.id, acceptance.id, tech), 403);
    });

    await runCase('one multi-page row preserves newlines/long words, repeats headers and stays inside A4', async () => {
      const markers = Array.from({ length: 110 }, (_, i) => 'LINE-' + String(i).padStart(4, '0'));
      const longWord = 'LONGSTART' + 'W'.repeat(1800) + 'LONGEND';
      const note = ['NEWLINES-BEGIN', ...markers, '', '', longWord, 'ROW-END'].join('\n');
      const long = { ...snapshot, inspections: [{ ...snapshot.inspections[0], items: [
        { code: 'DENSE-01', title: 'Hàng dài hơn một trang, giữ tiếng Việt', result: 'PASS', note },
      ] }], summary: { ...snapshot.summary, itemCount: 1 } };
      await db.getRepository(AcceptanceSnapshot).update({ acceptanceId: acceptance.id }, { content: long });
      const file = await service.acceptancePdf(project.id, acceptance.id, manager);
      try {
        if (process.env.EXPORT_QA_PDF) { await fs.copyFile(file.path, process.env.EXPORT_QA_PDF); console.log('QA PDF:', process.env.EXPORT_QA_PDF); }
        const result = inspectPdf(file.path);
        assert.ok(result.pages.length >= 3);
        assert.equal(result.invalidUnicodeMappings, 0);
        assert.deepEqual(result.overflow, []);
        assert.deepEqual(result.rectangleOverflow, []);
        for (const marker of markers) assert.ok(result.text.includes(marker), marker + ' survives page split');
        // Page headers are inserted between fragments of one long word.
        // Remove only those verified headers before checking every character in order.
        const withoutPageHeaders = result.pages.map(page =>
          page.replace(/^Trang \d+\nMục kiểm tra Kết quả \/ Ghi chú\n/u, '')).join('\n');
        assert.ok(withoutPageHeaders.replace(/\s/g, '').includes(longWord));
        assert.match(result.text, /NEWLINES-BEGIN/); assert.match(result.text, /ROW-END/);
        for (const page of result.pages.filter(p => /LINE-|WWWW|LONGSTART|LONGEND/.test(p))) {
          assert.match(page, /Mục kiểm tra/); assert.match(page, /Kết quả \/ Ghi chú/);
        }
      } finally { await file.cleanup(); }
      await db.getRepository(AcceptanceSnapshot).update({ acceptanceId: acceptance.id }, { content: snapshot });
    });

    await runCase('XLSX is real, text-safe, PoE false preserved, trace from same snapshot', async () => {
      const deviceFile = await service.devicesWorkbook(project.id, manager);
      const deviceBook = await readWorkbook(deviceFile.path); await deviceFile.cleanup();
      assert.deepEqual(deviceBook.worksheets.map(sheet => sheet.name), ['Thông tin', 'Thiết bị', 'Tủ']);
      assert.equal(deviceBook.getWorksheet('Thông tin').rowCount, 5);
      assert.equal(deviceBook.getWorksheet('Thiết bị').rowCount, 7);
      assert.equal(deviceBook.getWorksheet('Tủ').rowCount, 2);
      const currentProject = await db.getRepository(Project).findOneByOrFail({ id: project.id });
      assert.equal(deviceBook.getWorksheet('Thông tin').getRow(2).getCell(2).value,
        `${project.code} — ${currentProject.name}`);
      assert.match(currentProject.name, /[À-ỹ]/u, 'Vietnamese project name survives XLSX readback');
      const cameraRow = [...deviceBook.getWorksheet('Thiết bị').getRows(2, 3)].find(r => r.getCell(1).value === camera.code);
      assert.equal(cameraRow.getCell(2).value, "'=HYPERLINK(\"unsafe\")");
      assert.equal(cameraRow.getCell(2).type, 'string');
      assert.equal(cameraRow.getCell(16).value, null, 'unassigned IP is blank, not an invented address');
      const connectionFile = await service.connectionsWorkbook(project.id, manager);
      const connectionBook = await readWorkbook(connectionFile.path); await connectionFile.cleanup();
      assert.deepEqual(connectionBook.worksheets.map(sheet => sheet.name), ['Thông tin', 'Cổng', 'Dây', 'Tra cứu']);
      assert.equal(connectionBook.getWorksheet('Thông tin').rowCount, 5);
      assert.equal(connectionBook.getWorksheet('Cổng').rowCount, 9);
      assert.equal(connectionBook.getWorksheet('Dây').rowCount, 5);
      assert.equal(connectionBook.getWorksheet('Tra cứu').rowCount, 4);
      const trace = connectionBook.getWorksheet('Tra cứu').getRow(2);
      assert.equal(trace.getCell(1).value, camera.code);
      assert.equal(trace.getCell(4).value, 'Đủ khai báo tới switch');
      assert.equal(trace.getCell(8).value, '20 / Tắt');
      const throughOutlet = [...connectionBook.getWorksheet('Tra cứu').getRows(2, 3)].find(r => r.getCell(1).value === camera2.code);
      assert.equal(throughOutlet.getCell(4).value, 'Đủ khai báo tới switch');
      assert.equal(throughOutlet.getCell(8).value, '30 / Bật');
      assert.match(throughOutlet.getCell(3).value, /OUT-01.*PP-01.*SW-01/);
      await rejects(service.devicesWorkbook(foreign.id, tech), 403);
      await rejects(service.devicesWorkbook(randomUUID(), manager), 404);
    });

    await runCase('READ ONLY REPEATABLE READ rejects writes and resists a concurrent update', async () => {
      const stable = { transaction: (isolation, action) => db.transaction(isolation, async m => {
        const original = m.findOneBy.bind(m);
        m.findOneBy = async (entity, where) => {
          const found = await original(entity, where);
          if (entity === Project) await db.getRepository(ProjectDevice).update(camera.id, { name: 'Changed concurrently' });
          return found;
        };
        return action(m);
      }) };
      assert.equal((await db.getRepository(ProjectDevice).findOneBy({ id: camera.id })).name, '=HYPERLINK("unsafe")');
      const stableService = new ExportsService(stable, new EvidenceStorage());
      const file = await stableService.devicesWorkbook(project.id, manager);
      const book = await readWorkbook(file.path); await file.cleanup();
      const row = [...book.getWorksheet('Thiết bị').getRows(2, 3)].find(r => r.getCell(1).value === camera.code);
      assert.equal(row.getCell(2).value, "'=HYPERLINK(\"unsafe\")");
      assert.equal((await db.getRepository(ProjectDevice).findOneBy({ id: camera.id })).name, 'Changed concurrently');
      await assert.rejects(db.transaction('REPEATABLE READ', async m => { await m.query('SET TRANSACTION READ ONLY'); await m.query("UPDATE projects SET name='forbidden' WHERE id=$1", [project.id]); }), e => e.code === '25006');
    });

    await runCase('SQL preflight rejects before graph reads; builder budgets also reject an undercount', async () => {
      const devicesTotal = 7 + Number((await db.query('SELECT count(*) AS n FROM project_devices WHERE project_id=$1', [project.id]))[0].n)
        + Number((await db.query("SELECT count(*) AS n FROM project_devices WHERE project_id=$1 AND type='RACK'", [project.id]))[0].n);
      // 8 info/header rows, 8 port faces, 4 wires, 3 trace paths.
      const connectionsTotal = 23;
      for (const [method, total] of [['devicesWorkbook', devicesTotal], ['connectionsWorkbook', connectionsTotal]]) {
        await (await new ExportsService(db, new EvidenceStorage(), { maxRows: total })[method](project.id, manager)).cleanup();
        let graphReads = 0;
        const wrapped = undercount => ({ transaction: (isolation, action) => db.transaction(isolation, async m => {
          const query = m.query.bind(m), find = m.findBy.bind(m), repo = m.getRepository.bind(m);
          m.query = async (...args) => undercount && /AS rows/.test(args[0]) ? [{ rows: 0 }] : query(...args);
          m.findBy = async (...args) => { graphReads++; return find(...args); };
          m.getRepository = (...args) => { if (args[0] !== Project) graphReads++; return repo(...args); };
          return action(m);
        }) });
        await rejects(new ExportsService(wrapped(false), new EvidenceStorage(), { maxRows: total - 1 })[method](project.id, manager), 413);
        assert.equal(graphReads, 0, 'preflight fails before loading any collection');
        await rejects(new ExportsService(wrapped(true), new EvidenceStorage(), { maxRows: total - 1 })[method](project.id, manager), 413);
        assert.ok(graphReads > 0, 'construction budget independently detects preflight undercount');
      }
    });

    await runCase('HTTP auth, cross-project, content type and filenames', async () => {
      process.env.DB_NAME = name; process.env.JWT_SECRET = randomBytes(48).toString('hex');
      const { NestFactory } = require('@nestjs/core'); const { JwtService } = require('@nestjs/jwt');
      const { AppModule } = require('../dist/app.module');
      app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, '127.0.0.1');
      const base = await app.getUrl(), jwt = app.get(JwtService);
      const get = (url, user) => fetch(base + url, { headers: user ? { Authorization: 'Bearer ' + jwt.sign({ sub: user.id }) } : {} });
      const p = `/projects/${project.id}`, f = `/projects/${foreign.id}`;
      for (const route of [`${p}/exports/devices.xlsx`, `${p}/exports/connections.xlsx`, `${p}/acceptances/${acceptance.id}/export.pdf`]) {
        assert.equal((await get(route)).status, 401); assert.equal((await get(route, tech)).status, 403);
        const response = await get(route, manager); assert.equal(response.status, 200);
        assert.match(response.headers.get('content-disposition'), /attachment; filename="[A-Za-z0-9-]+\.(pdf|xlsx)"/);
        assert.ok((await response.arrayBuffer()).byteLength > 100);
      }
      assert.equal((await get(`${f}/acceptances/${acceptance.id}/export.pdf`, manager)).status, 404);
      assert.equal((await get(`${f}/exports/devices.xlsx`, manager)).status, 200);
      // The first request holds the process slot while current() is paused before its DB query.
      const slotService = app.get(ExportsService), originalCurrent = slotService.current;
      let currentCalls = 0, enteredCurrent, continueCurrent;
      const currentEntered = new Promise(resolve => { enteredCurrent = resolve; });
      const currentGate = new Promise(resolve => { continueCurrent = resolve; });
      slotService.current = async function (...args) {
        currentCalls++;
        if (currentCalls === 1) { enteredCurrent(); await currentGate; }
        return originalCurrent.apply(this, args);
      };
      try {
        const firstRequest = get(`${p}/exports/devices.xlsx`, manager);
        await bounded(currentEntered, 5000);
        const busy = await get(`${p}/exports/connections.xlsx`, manager);
        assert.equal(busy.status, 503, 'parallel XLSX request is rejected, not queued');
        assert.equal(busy.headers.get('retry-after'), '1');
        assert.equal(currentCalls, 1, 'busy request is refused before data queries');
        continueCurrent();
        const firstResponse = await bounded(firstRequest, 30000);
        assert.equal(firstResponse.status, 200);
        await firstResponse.arrayBuffer();
        const nextResponse = await bounded(get(`${p}/exports/connections.xlsx`, manager), 30000);
        assert.equal(nextResponse.status, 200, 'a later request proceeds after the prior worker exits');
        await nextResponse.arrayBuffer();
        assert.equal(currentCalls, 2);
      } finally { continueCurrent(); slotService.current = originalCurrent; }

      // Exercise the real guarded route/pipeline with a large temporary response.
      const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-export-abort-'));
      const downloadPath = path.join(folder, 'document'), size = 8 * 1024 * 1024;
      await fs.writeFile(downloadPath, Buffer.alloc(size, 65));
      let cleaned;
      const cleanupDone = new Promise(resolve => { cleaned = resolve; });
      const actual = app.get(ExportsService), original = actual.devicesWorkbook;
      actual.devicesWorkbook = async () => ({ path: downloadPath, name: 'abort.xlsx', mime: 'application/octet-stream', size,
        cleanup: async () => { await fs.rm(folder, { recursive: true, force: true }); cleaned(); } });
      try {
        const received = await new Promise((resolve, reject) => {
          const request = require('node:http').get(base + p + '/exports/devices.xlsx',
            { headers: { Authorization: 'Bearer ' + jwt.sign({ sub: manager.id }) } }, response => {
              response.once('data', chunk => { response.destroy(); request.destroy(); resolve(chunk.length); });
              response.on('error', () => undefined);
            });
          request.on('error', reject);
        });
        assert.ok(received < size, 'client disconnects before completing download');
        await bounded(cleanupDone, 5000);
        await assert.rejects(fs.stat(folder), error => error.code === 'ENOENT');
      } finally { actual.devicesWorkbook = original; await fs.rm(folder, { recursive: true, force: true }); }

      // Abort while XLSX is still being prepared (before response headers exist).
      let started, workerPid;
      const workerStarted = new Promise(resolve => { started = resolve; });
      actual.devicesWorkbook = (_projectId, _user, signal) => workbook('slow.xlsx',
        [{ name: 'STALL', columns: ['A'], rows: [['a']] }], { xlsxTimeoutMs: 5000 }, signal,
        { path: path.join(__dirname, 'fixtures', 'xlsx-worker-fault.cjs'), onStart: pid => { workerPid = pid; started(); } });
      try {
        const request = require('node:http').get(base + p + '/exports/devices.xlsx',
          { headers: { Authorization: 'Bearer ' + jwt.sign({ sub: manager.id }) } });
        request.on('error', () => undefined);
        await bounded(workerStarted, 5000);
        request.destroy();
        await bounded(new Promise(resolve => {
          const check = () => { try { process.kill(workerPid, 0); setTimeout(check, 20); } catch { resolve(); } };
          check();
        }), 5000);
      } finally { actual.devicesWorkbook = original; }

      await app.close(); app = undefined;
    });

    await runCase('configurable row/page/byte boundaries stop render and clean temporary files', async () => {
      const font = path.join(__dirname, '../dist/exports/fonts/NotoSans.ttf');
      assert.deepEqual(exportLimits(), { maxBytes: 20 * 1024 * 1024, maxRows: 10000, maxPages: 200,
        maxInputBytes: 8 * 1024 * 1024, xlsxTimeoutMs: 60000 });
      const sheets = [{ name: 'A', columns: ['A'], rows: [['one'], ['two']] }, { name: 'B', columns: ['B'], rows: [['three']] }];
      await (await workbook('fits.xlsx', sheets, { maxRows: 5 })).cleanup();
      await rejects(workbook('over.xlsx', sheets, { maxRows: 4 }), 413);
      const budget = new RowBudget(2); budget.add(2); assert.throws(() => budget.add(), e => e.getStatus() === 413);
      const two = await pdf('two.pdf', font, doc => { doc.text('First'); doc.addPage(); doc.text('Second'); }, { maxPages: 2 });
      const parsed = await readPdf(two); assert.equal(parsed.pages.length, 2);
      let attempts = 0, buffered = 0;
      await rejects(pdf('over.pdf', font, doc => {
        assert.equal(doc.options.bufferPages, false);
        for (let i = 0; i < 10; i++) { buffered = Math.max(buffered, doc.bufferedPageRange().count); attempts++; doc.addPage(); }
      }, { maxPages: 2 }), 413);
      assert.equal(attempts, 2, 'third page is refused before creation');
      assert.equal(buffered, 1, 'only the current page is buffered');
      const acceptable = await workbook('bytes-fit.xlsx', sheets, { maxBytes: 65536 });
      assert.ok(acceptable.size <= 65536); await acceptable.cleanup();
      await bounded(rejects(workbook('bytes-over.xlsx', sheets, { maxBytes: 1024 }), 413), 5000);
      let pagesWritten = 0;
      await bounded(rejects(pdf('bytes-over.pdf', font, async (doc, checkpoint) => {
        for (let i = 0; i < 100; i++) {
          doc.text(randomBytes(500).toString('hex')); doc.addPage(); pagesWritten++; await checkpoint();
        }
      }, { maxBytes: 1024 }), 413), 5000);
      assert.ok(pagesWritten < 100, 'byte limit cancels the producer, not just the final stat');
      await rejects(pdf('fault.pdf', 'missing-font.ttf', () => {}), 503);
      const after = await fs.readdir(os.tmpdir());
      const leftovers = await Promise.all(after.filter(x => x.startsWith('elv-export-') && x !== path.basename(root) && !tempBaseline.has(x))
        .map(async x => (await fs.stat(path.join(os.tmpdir(), x))).isDirectory() ? x : null));
      assert.deepEqual(leftovers.filter(Boolean), []);
    });
  } finally {
    if (app) await app.close(); if (db.isInitialized) await db.destroy();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});
