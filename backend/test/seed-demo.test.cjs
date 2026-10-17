const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { main, requireManagedProject, assertDeviceFixture, assertLayoutPreflight, preflightExistingDependents,
  seedDemoTasks, PROJECT_CODE, MARKER } = require('../scripts/seed-demo.cjs');

test('demo seed refuses an existing project code without its ownership marker', () => {
  const project = { description: MARKER, status: 'IN_PROGRESS',
    name: 'Tòa nhà minh họa hạ tầng điện nhẹ', address: 'Địa chỉ giả định — chỉ dùng demo' };
  assert.throws(() => requireManagedProject({ ...project, description: 'Công trình của người dùng' }),
    new RegExp(`${PROJECT_CODE} already exists`));
  assert.throws(() => requireManagedProject({ ...project, status: 'COMPLETED' }), /status was changed/);
  assert.throws(() => requireManagedProject({ ...project, address: 'Changed' }), /conflicts/);
  assert.doesNotThrow(() => requireManagedProject(project));
});

test('device fixture comparison normalizes null, UUID case and system order, but rejects optional-field drift', () => {
  const areaId = randomUUID();
  const systemIds = [randomUUID(), randomUUID()];
  const expected = {
    code: 'RACK-CORE', type: 'RACK', name: 'Demo rack', areaId, rackId: null,
    systemIds, description: 'Demo description', capacityU: 42,
    brand: null, model: null, serialNumber: null, locationNote: null,
  };
  const existing = { ...expected, areaId: areaId.toUpperCase(), systemIds: [...systemIds].reverse(), brand: undefined };
  assert.doesNotThrow(() => assertDeviceFixture(existing, expected));
  for (const field of ['description', 'capacityU', 'brand', 'model', 'serialNumber', 'locationNote']) {
    const changed = { ...existing, [field]: field === 'capacityU' ? 24 : 'Changed' };
    assert.throws(() => assertDeviceFixture(changed, expected), /Device code RACK-CORE conflicts/);
  }
  assert.throws(() => assertDeviceFixture({ ...existing, systemIds: [systemIds[0]] }, expected), /conflicts/);
  assert.throws(() => assertDeviceFixture({ ...existing, areaId: randomUUID() }, expected), /conflicts/);
});

for (const changedField of ['description', 'capacityU']) {
  test(`seed preflight refuses matching Device code with changed ${changedField} before dependent writes`, async () => {
    const projectId = randomUUID();
    const areaId = randomUUID();
    const floorId = randomUUID();
    const systemIds = [randomUUID(), randomUUID(), randomUUID()];
    const technicianId = randomUUID();
    const managerToken = randomUUID();
    const technicianToken = randomUUID();
    const calls = [];
    const rack = {
      id: randomUUID(), projectId, code: 'RACK-CORE', type: 'RACK',
      name: 'Tủ rack trung tâm — tầng 1', areaId, rackId: null, capacityU: 42,
      systemIds, description: 'Thiết bị demo — không đại diện hiện trạng thực',
      brand: null, model: null, serialNumber: null, locationNote: null,
      [changedField]: changedField === 'capacityU' ? 24 : 'Different description',
    };
    const fetchImpl = async (url, init) => {
      const route = new URL(url).pathname;
      calls.push({ method: init.method, route });
      let result;
      if (route === '/health') result = { status: 'ok', database: 'connected' };
      else if (route === '/auth/login') {
        const { email } = JSON.parse(init.body);
        result = { accessToken: email.startsWith('manager') ? managerToken : technicianToken };
      } else if (route === '/auth/me') {
        result = init.headers.Authorization === `Bearer ${managerToken}`
          ? { id: randomUUID(), role: 'MANAGER' }
          : { id: technicianId, role: 'TECHNICIAN' };
      } else if (route === '/users/technicians') result = [{ id: technicianId }];
      else if (route === '/projects') result = [{ id: projectId, code: PROJECT_CODE, description: MARKER, status: 'IN_PROGRESS',
        name: 'Tòa nhà minh họa hạ tầng điện nhẹ', address: 'Địa chỉ giả định — chỉ dùng demo' }];
      else if (route === `/projects/${projectId}/areas`) result = [
        { id: floorId, projectId, code: 'T01', name: 'Tầng 1 — sảnh và kỹ thuật trung tâm', type: 'FLOOR', parentId: null, sortOrder: 1 },
        { id: areaId, projectId, code: 'T01-KT', name: 'Phòng kỹ thuật trung tâm', type: 'ROOM', parentId: floorId, sortOrder: 1 },
      ];
      else if (route === `/projects/${projectId}/systems`) result = ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING']
        .map((code, index) => ({ id: systemIds[index], projectId, code,
          name: ['Mạng LAN tòa nhà', 'WiFi khu làm việc', 'Camera an ninh'][index],
          category: ['LAN', 'WIFI', 'CAMERA'][index], description: 'Hạng mục demo — dữ liệu giả định' }));
      else if (route === `/projects/${projectId}/devices`) result = [rack];
      else throw new Error(`Unexpected API route ${route}`);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const envOverride = {
      DEMO_API_URL: 'http://127.0.0.1:3000',
      DEMO_MANAGER_PASSWORD: randomUUID(), DEMO_TECHNICIAN_PASSWORD: randomUUID(),
      DEMO_MANAGER_EMAIL: 'manager.demo@example.local', DEMO_TECHNICIAN_EMAIL: 'technician.demo@example.local',
    };
    await assert.rejects(main({ envOverride, fetchImpl }), /Device code RACK-CORE conflicts/);
    assert.equal(calls.filter(({ method, route }) => method !== 'GET' && route !== '/auth/login').length, 0);
  });
}

test('rack layout preflight accepts pristine or exact fixture and rejects changed hierarchy or U', () => {
  const coreId = randomUUID();
  const subId = randomUUID();
  const coreArea = randomUUID();
  const lobbyArea = randomUUID();
  const subArea = randomUUID();
  const officeArea = randomUUID();
  const areas = [
    { code: 'T01-KT', id: coreArea }, { code: 'T01-SANH', id: lobbyArea },
    { code: 'T02-KT', id: subArea }, { code: 'T02-VP', id: officeArea },
  ];
  const devices = [
    { code: 'RACK-CORE', id: coreId, rackRole: null, parentRackId: null, areaId: coreArea, capacityU: 42 },
    { code: 'RACK-T02', id: subId, rackRole: null, parentRackId: null, areaId: subArea, capacityU: 24 },
    { code: 'SW-CORE', id: randomUUID(), rackId: coreId, mountMode: null, startU: null, heightU: null },
  ];
  const racks = devices.slice(0, 2).map(item => ({ ...item, servedAreaIds: [] }));
  assert.doesNotThrow(() => assertLayoutPreflight(areas, devices, racks));
  racks[0] = { ...racks[0], rackRole: 'MAIN', servedAreaIds: [lobbyArea, coreArea] };
  assert.doesNotThrow(() => assertLayoutPreflight(areas, devices, racks));
  devices[2] = { ...devices[2], mountMode: 'U', startU: 40, heightU: 1 };
  assert.doesNotThrow(() => assertLayoutPreflight(areas, devices, racks));
  assert.throws(() => assertLayoutPreflight(areas, devices, [{ ...racks[0], rackRole: 'SUB' }, racks[1]]), /conflicts/);
  assert.throws(() => assertLayoutPreflight(areas, devices, [{ ...racks[0], servedAreaIds: [coreArea] }, racks[1]]), /RACK-CORE conflicts/);
  assert.throws(() => assertLayoutPreflight(areas, [devices[0], devices[1], { ...devices[2], startU: 20 }], racks), /SW-CORE conflicts/);
  assert.throws(() => assertLayoutPreflight(areas, devices, racks, [{
    rack: racks[0], positioned: [{ code: 'USER-DEVICE', startU: 40, heightU: 1 }],
  }]), /U conflicts with existing Device USER-DEVICE/);
});

test('dependent preflight rejects a changed port before any seed write', async () => {
  const projectId = randomUUID();
  const deviceId = randomUUID();
  const readRoutes = [];
  const get = async route => {
    readRoutes.push(route);
    if (route.endsWith('/ports')) return [{
      id: randomUUID(), projectId, deviceId, code: 'P01', accessVlanId: null,
      poeEnabled: null, description: 'Changed by user',
    }];
    throw new Error(`Unexpected read ${route}`);
  };
  await assert.rejects(preflightExistingDependents(get, `/projects/${projectId}`, projectId, [], [],
    [{ id: deviceId, projectId, code: 'OUT-LOBBY' }], randomUUID()), /Port OUT-LOBBY\/P01 conflicts/);
  assert.equal(readRoutes.length, 1);
});

function taskHarness(targetStatus, interruptAt) {
  const projectId = randomUUID();
  const technicianId = randomUUID();
  const managerId = randomUUID();
  const spec = { code: `TASK-CHECKPOINT-${targetStatus}`, title: 'Task demo checkpoint',
    systemId: randomUUID(), areaId: randomUUID(), status: targetStatus };
  const task = { id: randomUUID(), projectId, code: spec.code, title: spec.title,
    systemId: spec.systemId, areaId: spec.areaId, assigneeId: technicianId,
    description: 'Công việc demo — giả định quy trình thi công', status: 'ASSIGNED',
    completionNote: null, returnReason: null, submittedAt: null, reviewedById: null, reviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  let interrupted = false;
  const writes = [];
  const change = (action, body) => {
    writes.push(action);
    const time = new Date(Date.parse(task.updatedAt) + 1000).toISOString();
    task.updatedAt = time;
    if (action === 'start') task.status = 'IN_PROGRESS';
    if (action === 'submit') {
      task.status = 'SUBMITTED';
      task.completionNote = body.completionNote;
      task.submittedAt = time;
    }
    if (action === 'return' || action === 'approve') {
      task.status = action === 'return' ? 'RETURNED' : 'APPROVED';
      task.returnReason = action === 'return' ? body.reason : null;
      task.reviewedById = managerId;
      task.reviewedAt = time;
    }
    if (action === interruptAt && !interrupted) {
      interrupted = true;
      throw new Error(`Simulated lost response after ${action}`);
    }
    return { ...task };
  };
  const asManager = async (method, route, body) => {
    if (method === 'GET' && route.endsWith('/tasks')) return [{ ...task }];
    if (method === 'POST' && route.endsWith('/return')) return change('return', body);
    if (method === 'POST' && route.endsWith('/approve')) return change('approve', body);
    throw new Error(`Unexpected manager request ${method} ${route}`);
  };
  const asTechnician = async (method, route, body) => {
    if (method === 'POST' && route.endsWith('/start')) return change('start', body);
    if (method === 'POST' && route.endsWith('/submit')) return change('submit', body);
    throw new Error(`Unexpected technician request ${method} ${route}`);
  };
  const run = () => {
    const created = { tasks: 0, taskTransitions: 0 };
    return seedDemoTasks({ root: `/projects/${projectId}`, projectId, taskDefinitions: [spec],
      technicianId, managerId, asManager, asTechnician, created }).then(() => created);
  };
  return { run, task, writes, spec, projectId, technicianId, managerId, asManager, asTechnician };
}

for (const [target, interruptAt, expected] of [
  ['RETURNED', 'start', ['start', 'submit', 'return']],
  ['APPROVED', 'submit', ['start', 'submit', 'approve']],
]) {
  test(`Task seed resumes after lost ${interruptAt} response and next run performs no write`, async () => {
    const fixture = taskHarness(target, interruptAt);
    await assert.rejects(fixture.run(), new RegExp(`lost response after ${interruptAt}`));
    assert.equal(fixture.task.status, interruptAt === 'start' ? 'IN_PROGRESS' : 'SUBMITTED');
    const resumed = await fixture.run();
    assert.equal(fixture.task.status, target);
    assert.equal(resumed.tasks, 0);
    assert.deepEqual(fixture.writes, expected);
    const again = await fixture.run();
    assert.deepEqual(again, { tasks: 0, taskTransitions: 0 });
    assert.deepEqual(fixture.writes, expected);
  });
}

test('Task seed preflights all existing tasks before writing when another fixture was edited', async () => {
  const fixture = taskHarness('RETURNED', null);
  const changed = { ...fixture.task, id: randomUUID(), code: 'TASK-OTHER', title: 'Other task',
    description: 'User edited this task' };
  const spec2 = { ...fixture.spec, code: changed.code, title: changed.title };
  let writes = 0;
  const asManager = async method => {
    if (method === 'GET') return [{ ...fixture.task }, changed];
    writes++;
    throw new Error('Unexpected write');
  };
  const asTechnician = async () => { writes++; throw new Error('Unexpected write'); };
  await assert.rejects(seedDemoTasks({ root: `/projects/${fixture.projectId}`, projectId: fixture.projectId,
    taskDefinitions: [fixture.spec, spec2], technicianId: fixture.technicianId, managerId: fixture.managerId,
    asManager, asTechnician, created: { tasks: 0, taskTransitions: 0 } }), /TASK-OTHER conflicts/);
  assert.equal(writes, 0);
});

test('new returned Task has a distinct code; legacy fixture is never in the managed Task list', () => {
  const { TASK_SPECS } = require('../scripts/seed-demo.cjs');
  assert.equal(TASK_SPECS.some(x => x.code === 'TASK-CAM-RETURNED'), false);
  assert.equal(TASK_SPECS.find(x => x.code === 'TASK-CAM-RETURNED-V2')?.status, 'RETURNED');
});

test('workflow checkpoint accepts unfinished intent and refuses changed inspection data', () => {
  const { assertInspectionCheckpoint, INSPECTIONS } = require('../scripts/seed-demo-workflow.cjs');
  const templateId = randomUUID(), systemId = randomUUID(), assigneeId = randomUUID();
  const template = { id: templateId, revision: 1, items: [{ code: 'LABEL', title: 'Nhãn', instruction: 'Kiểm tra nhãn', sortOrder: 1 }] };
  const spec = INSPECTIONS.find(x => x.code === 'DEMO-INSP-LAN-PASS');
  const sheet = { code: spec.code, title: spec.title, systemId, areaId: randomUUID(), deviceId: null,
    templateId, templateRevision: 1, items: [{ code: 'LABEL', title: 'Nhãn', instruction: 'Kiểm tra nhãn', sortOrder: 1,
      result: 'NOT_CHECKED', note: null, version: 1, issues: [] }] };
  assert.doesNotThrow(() => assertInspectionCheckpoint(sheet, spec, template, systemId, sheet.areaId, null, assigneeId));
  sheet.items[0].result = 'PASS'; sheet.items[0].note = 'Kết quả giả định theo phiếu demo.'; sheet.items[0].version = 2;
  assert.doesNotThrow(() => assertInspectionCheckpoint(sheet, spec, template, systemId, sheet.areaId, null, assigneeId));
  assert.throws(() => assertInspectionCheckpoint({ ...sheet, title: 'User edit' }, spec, template, systemId, sheet.areaId, null, assigneeId), /conflicts/);
  assert.throws(() => assertInspectionCheckpoint({ ...sheet, items: [{ ...sheet.items[0], note: 'User edit' }] }, spec, template, systemId, sheet.areaId, null, assigneeId), /conflicts/);
});

test('acceptance checkpoint keeps explicit selection and confirmed snapshot immutable', () => {
  const { assertAcceptanceCheckpoint, ACCEPTANCES, PDF } = require('../scripts/seed-demo-workflow.cjs');
  assert.match(PDF.subarray(0, 8).toString(), /^%PDF-1\.4/);
  const spec = ACCEPTANCES.find(x => x.code === 'DEMO-AC-CONFIRMED-V2');
  const systemId = randomUUID(), inspectionId = randomUUID(), evidenceId = randomUUID(), predecessorId = randomUUID();
  const row = { code: spec.code, title: spec.title, systemId, replacesId: predecessorId, note: null,
    replacementReason: 'Thay thế hồ sơ demo để minh họa lịch sử phiên bản.', version: 1,
    inspectionIds: [inspectionId], evidenceIds: [evidenceId], status: 'DRAFT', snapshot: null };
  assert.doesNotThrow(() => assertAcceptanceCheckpoint(row, spec, systemId, inspectionId, evidenceId, predecessorId));
  const confirmed = { ...row, status: 'CONFIRMED', version: 2, confirmedAt: new Date().toISOString(),
    snapshot: { schemaVersion: 1, content: { acceptance: { code: spec.code }, system: { id: systemId }, inspections: [{ id: inspectionId }] } } };
  assert.doesNotThrow(() => assertAcceptanceCheckpoint(confirmed, spec, systemId, inspectionId, evidenceId, predecessorId));
  assert.throws(() => assertAcceptanceCheckpoint({ ...confirmed, evidenceIds: [] }, spec, systemId, inspectionId, evidenceId, predecessorId), /conflicts/);
  assert.throws(() => assertAcceptanceCheckpoint({ ...confirmed, snapshot: null }, spec, systemId, inspectionId, evidenceId, predecessorId), /conflicts/);
});

test('issue checkpoints resume OPEN to RESOLVED and reject edited or inconsistent closed history', () => {
  const { assertInspectionCheckpoint, INSPECTIONS } = require('../scripts/seed-demo-workflow.cjs');
  const spec = INSPECTIONS.find(x => x.code === 'DEMO-INSP-CAM-RESOLVED');
  const closed = INSPECTIONS.find(x => x.code === 'DEMO-INSP-CAM-CLOSED');
  const systemId = randomUUID(), deviceId = randomUUID(), areaId = randomUUID(), techId = randomUUID();
  const template = { id: randomUUID(), revision: 1, items: [{ code: 'INSTALL', title: 'Lắp đặt', instruction: 'Kiểm tra lắp đặt', sortOrder: 1 }] };
  const issue = { description: 'Ảnh hoặc nhãn camera demo chưa đạt; cần khắc phục.', assigneeId: techId,
    status: 'OPEN', version: 1, returnReason: null, resolutionNote: null, reviewedAt: null };
  const item = { ...template.items[0], result: 'FAIL', note: 'Kết quả giả định theo phiếu demo.', version: 2, issues: [issue] };
  const sheet = { code: spec.code, title: spec.title, systemId, areaId: null, deviceId,
    templateId: template.id, templateRevision: 1, items: [item] };
  assert.doesNotThrow(() => assertInspectionCheckpoint(sheet, spec, template, systemId, null, deviceId, techId));
  issue.status = 'IN_PROGRESS'; issue.version = 2;
  assert.doesNotThrow(() => assertInspectionCheckpoint(sheet, spec, template, systemId, null, deviceId, techId));
  issue.status = 'RESOLVED'; issue.version = 3; issue.resolutionNote = 'Đã sửa theo mô phỏng và đề nghị kiểm tra lại.';
  assert.doesNotThrow(() => assertInspectionCheckpoint(sheet, spec, template, systemId, null, deviceId, techId));
  assert.throws(() => assertInspectionCheckpoint({ ...sheet, items: [{ ...item, issues: [{ ...issue, description: 'User edit' }] }] },
    spec, template, systemId, null, deviceId, techId), /conflicts/);
  issue.status = 'CLOSED'; issue.version = 4; issue.reviewedAt = new Date().toISOString();
  item.result = 'PASS'; item.version = 3; item.note = 'Đã kiểm tra lại theo kịch bản demo.';
  const closedSheet = { ...sheet, code: closed.code, title: closed.title, areaId, deviceId: null };
  assert.doesNotThrow(() => assertInspectionCheckpoint(closedSheet, closed, template, systemId, areaId, null, techId));
  issue.version = 3;
  assert.throws(() => assertInspectionCheckpoint(closedSheet, closed, template, systemId, areaId, null, techId), /conflicts/);
});

test('workflow preflight rejects an edited fixture before any write, and accepts an empty fresh fixture', async () => {
  const { seedWorkflow, INSPECTIONS } = require('../scripts/seed-demo-workflow.cjs');
  const systemId = randomUUID(), templateId = randomUUID();
  const templates = ['LAN', 'WIFI', 'CAMERA'].map(category => ({ id: category === 'LAN' ? templateId : randomUUID(),
    category, isActive: true, revision: 1, items: [{ code: 'LABEL', title: 'Nhãn', instruction: 'Kiểm tra nhãn', sortOrder: 1 }] }));
  let writes = 0;
  const sheet = { code: INSPECTIONS[0].code, title: 'User edit', systemId, areaId: randomUUID(), deviceId: null,
    templateId, templateRevision: 1, items: [] };
  let inspections = [sheet];
  const asManager = async (method, route) => {
    if (method !== 'GET') { writes++; throw new Error('unexpected write'); }
    if (route === '/checklist-templates') return templates;
    if (route.endsWith('/inspections')) return inspections;
    if (route.endsWith('/acceptances') || route.endsWith('/tasks')) return [];
    throw new Error(`unexpected read: ${route}`);
  };
  const input = { root: '/projects/demo', project: { code: 'CT-DEMO-ELV-01' },
    areas: [{ code: 'T01-SANH', id: sheet.areaId }], systems: [{ code: 'LAN-BUILDING', id: systemId }],
    devices: [], manager: { user: { id: randomUUID() } }, technician: { user: { id: randomUUID() } },
    asManager, asTechnician: () => { writes++; }, preflightOnly: true };
  await assert.rejects(seedWorkflow(input), /Inspection .*conflicts/);
  assert.equal(writes, 0);
  inspections = [];
  await assert.doesNotReject(seedWorkflow(input));
  assert.equal(writes, 0);
});

test('evidence fixture comparison includes bytes, media metadata, target and uploader', () => {
  const { matchesEvidence, PNG } = require('../scripts/seed-demo-workflow.cjs');
  const { createHash } = require('node:crypto');
  const taskId = randomUUID(), uploaderId = randomUUID();
  const row = { sha256: createHash('sha256').update(PNG).digest('hex'), sizeBytes: PNG.length,
    mimeType: 'image/png', caption: 'Minh chứng giả định cho công trình demo', taskId, uploadedBy: { id: uploaderId } };
  assert.equal(matchesEvidence(row, PNG, 'image/png', 'taskId', taskId, uploaderId), true);
  for (const changed of [{ sizeBytes: PNG.length + 1 }, { mimeType: 'application/pdf' },
    { caption: 'User edit' }, { taskId: randomUUID() }, { uploadedBy: { id: randomUUID() } }]) {
    assert.equal(matchesEvidence({ ...row, ...changed }, PNG, 'image/png', 'taskId', taskId, uploaderId), false);
  }
});
