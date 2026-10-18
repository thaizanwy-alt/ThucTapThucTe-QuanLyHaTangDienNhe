// Host-local API smoke for Task/Issue A→B ownership and evidence.
// Creates uniquely named records in an explicitly selected non-demo Project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) throw new Error('backend/.env is required; no credentials were read');
const local = dotenv.parse(fs.readFileSync(envPath));
const api = (process.env.REASSIGNMENT_API_URL || `http://127.0.0.1:${local.PORT || 3000}`).replace(/\/$/, '');
const web = (process.env.REASSIGNMENT_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
const projectCode = (process.env.REASSIGNMENT_PROJECT_CODE || '').trim().toUpperCase();
const runId = (process.env.REASSIGNMENT_RUN_ID || `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`)
  .toUpperCase().replace(/[^A-Z0-9-]/g, '-');
if (!/^[A-Z0-9-]{1,32}$/.test(runId)) throw new Error('REASSIGNMENT_RUN_ID must be 1–32 letters, digits or hyphens');
if (!projectCode) throw new Error('Set REASSIGNMENT_PROJECT_CODE to an existing trial Project code before running');
if (projectCode === 'CT-DEMO-ELV-01') throw new Error('Refusing to write smoke data into CT-DEMO-ELV-01');

const credentials = {
  manager: { email: local.DEMO_MANAGER_EMAIL || 'manager.demo@example.local', password: local.DEMO_MANAGER_PASSWORD },
  a: { email: local.DEMO_TECHNICIAN_EMAIL || 'technician.demo@example.local', password: local.DEMO_TECHNICIAN_PASSWORD },
  b: { email: local.DEMO_SECOND_TECHNICIAN_EMAIL, password: local.DEMO_SECOND_TECHNICIAN_PASSWORD },
};
for (const [role, value] of Object.entries(credentials)) {
  if (!value.email || !value.password) throw new Error(`Missing local ${role} credentials in backend/.env`);
}

const taskCode = `SMOKE-AB-${runId}-T`;
const inspectionCode = `SMOKE-AB-${runId}-I`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let phase = 'preflight';
let project;
let browser;
let chromium;
let taskFixture;
let inspectionFixture;
let issueFixture;
const uploadedEvidence = [];
let writesStarted = false;

async function request(method, route, { token, body, expected = 200, binary = false } = {}) {
  let response;
  try {
    response = await fetch(`${api}${route}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body instanceof FormData ? {} : body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`${method} ${route}: request failed (${error.name})`);
  }
  if (response.status !== expected) throw new Error(`${method} ${route}: expected HTTP ${expected}, received ${response.status}`);
  if (response.status === 204) return null;
  if (binary) return Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

async function login(value) {
  const result = await request('POST', '/auth/login', { body: value, expected: 201 });
  assert.equal(typeof result.accessToken, 'string');
  return result.accessToken;
}

async function who(token, role) {
  const user = await request('GET', '/auth/me', { token });
  assert.equal(user.role, role);
  assert.equal(user.isActive, true);
  assert.equal(user.mustChangePassword, false, `${role} must have completed forced password change`);
  return user;
}

async function upload(token, target, name, caption) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), name);
  form.append('caption', caption);
  const response = await fetch(`${api}${target}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    body: form, signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 201) throw new Error(`POST ${target}: expected HTTP 201, received ${response.status}`);
  return response.json();
}

async function uploadTracked(token, target, name, caption) {
  const evidence = await upload(token, target, name, caption);
  uploadedEvidence.push({ id: evidence.id, originalName: evidence.originalName || name, state: 'active' });
  return evidence;
}

function markEvidenceDeleted(evidence) {
  const tracked = uploadedEvidence.find(item => item.id === evidence.id);
  if (tracked) tracked.state = 'soft-deleted';
}

async function fileStatus(token, evidenceId, kind, expected) {
  return request('GET', `/projects/${project.id}/evidence/${evidenceId}/${kind}`, { token, expected, binary: expected === 200 });
}

async function assertDeniedMutation(token, evidence) {
  await request('PATCH', `/projects/${project.id}/evidence/${evidence.id}`, {
    token, body: { expectedVersion: evidence.version, caption: 'forbidden smoke edit' }, expected: 403,
  });
  await request('DELETE', `/projects/${project.id}/evidence/${evidence.id}`, {
    token, body: { expectedVersion: evidence.version, reason: 'forbidden smoke delete' }, expected: 403,
  });
}

async function browserChecks(users, records) {
  if (!browser) return null;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const signIn = async user => {
    await page.goto(web);
    await page.getByLabel('Email', { exact: true }).fill(user.credentials.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(user.credentials.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.locator('.project-row').filter({ hasText: project.code }).click();
  };
  const section = async name => page.locator('.overview-links').getByRole('button', { name: new RegExp(name) }).click();

  phase = 'browser A visibility';
  await signIn(users.a);
  await section('Công việc');
  assert.equal(await page.locator('.task-row').filter({ hasText: records.task.code }).count(), 0, 'A must not see reassigned Task');
  await page.getByRole('button', { name: /Kiểm tra/ }).click();
  const issueTab = page.getByRole('button', { name: 'Lỗi khắc phục', exact: true });
  if (await issueTab.count()) await issueTab.click();
  assert.equal(await page.locator('.inspection-issue').filter({ hasText: records.inspection.code }).count(), 0, 'A must not see reassigned Issue');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();

  phase = 'browser B Task visibility/start';
  await signIn(users.b);
  await page.reload();
  await page.locator('.project-row').filter({ hasText: project.code }).click();
  await section('Công việc');
  const taskRow = page.locator('.task-row').filter({ hasText: records.task.code });
  assert.equal(await taskRow.count(), 1, 'B must see Task');
  const taskStart = page.waitForResponse(response => response.url().endsWith(`/tasks/${records.task.id}/start`) && response.status() === 200);
  await taskRow.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await taskStart;
  await page.getByRole('button', { name: 'Về tổng quan', exact: true }).click();
  await section('Kiểm tra');
  const issueRow = page.locator('.inspection-issue').filter({ hasText: records.inspection.code });
  assert.equal(await issueRow.count(), 1, 'B must see Issue');
  const issueStart = page.waitForResponse(response => response.url().endsWith(`/issues/${records.issue.id}/start`) && response.status() === 200);
  await issueRow.getByRole('button', { name: 'Bắt đầu sửa', exact: true }).click();
  await issueStart;
  console.log('PASS browser 390px: A cannot see reassigned records; B sees and starts Task/Issue.');
  return page;
}

async function browserEvidenceCrud(page, targetKind, record, ownEvidence, oldEvidence, description) {
  if (!page) return false;
  if (targetKind === 'task') {
    await page.getByRole('button', { name: 'Về tổng quan', exact: true }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Công việc/ }).click();
    const row = page.locator('.task-row').filter({ hasText: record.code });
    await row.getByRole('button', { name: 'Xem chi tiết', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Về tổng quan', exact: true }).click();
    await page.locator('.overview-links').getByRole('button', { name: /Kiểm tra/ }).click();
    const tab = page.getByRole('button', { name: 'Lỗi khắc phục', exact: true });
    if (await tab.count()) await tab.click();
    await page.locator('.inspection-issue').filter({ hasText: description }).getByRole('button').first().click();
  }
  const panel = page.locator('.evidence-panel');
  await panel.waitFor();
  for (const evidence of oldEvidence) {
    const oldRow = panel.locator('.evidence-row').filter({ hasText: evidence.originalName });
    assert.equal(await oldRow.getByRole('button', { name: 'Sửa chú thích', exact: true }).count(), 0);
    assert.equal(await oldRow.getByRole('button', { name: 'Xóa minh chứng', exact: true }).count(), 0);
  }
  const ownRow = panel.locator('.evidence-row').filter({ hasText: ownEvidence.originalName });
  assert.equal(await ownRow.getByRole('button', { name: 'Sửa chú thích', exact: true }).count(), 1);
  assert.equal(await ownRow.getByRole('button', { name: 'Xóa minh chứng', exact: true }).count(), 1);
  await ownRow.getByRole('button', { name: 'Sửa chú thích', exact: true }).click();
  await panel.getByLabel('Chú thích minh chứng', { exact: true }).fill(`${targetKind} caption from browser`);
  await panel.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.waitForFunction(name => [...document.querySelectorAll('.evidence-row')].some(row => row.textContent.includes(name) && row.textContent.includes('caption from browser')), ownEvidence.originalName);
  const updatedRow = panel.locator('.evidence-row').filter({ hasText: ownEvidence.originalName });
  await updatedRow.getByRole('button', { name: 'Xóa minh chứng', exact: true }).click();
  await panel.getByLabel('Lý do xóa minh chứng', { exact: true }).fill('A→B browser smoke; soft delete own file');
  await panel.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.waitForFunction(name => ![...document.querySelectorAll('.evidence-row')].some(row => row.textContent.includes(name)), ownEvidence.originalName);
  markEvidenceDeleted(ownEvidence);
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  return true;
}

async function prepareBrowser() {
  if (!process.env.PLAYWRIGHT_MODULE) {
    console.log('LIMIT UI smoke not run: set PLAYWRIGHT_MODULE to an existing external Playwright module; API smoke will still run.');
    return;
  }
  try {
    ({ chromium } = require(process.env.PLAYWRIGHT_MODULE));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const response = await fetch(web, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('web endpoint unavailable');
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    throw new Error(`Browser preflight failed (${error.name}); no fixture was created`);
  }
}

async function run() {
  phase = 'health and authentication preflight';
  const health = await request('GET', '/health');
  assert.equal(health.status, 'ok');
  assert.equal(health.database, 'connected');
  const managerToken = await login(credentials.manager);
  const aToken = await login(credentials.a);
  const bToken = await login(credentials.b);
  const [manager, a, b] = await Promise.all([
    who(managerToken, 'MANAGER'), who(aToken, 'TECHNICIAN'), who(bToken, 'TECHNICIAN'),
  ]);
  assert.notEqual(a.id.toLowerCase(), b.id.toLowerCase(), 'A and B must be different Users');
  assert.equal(a.email.toLowerCase(), credentials.a.email.toLowerCase());
  assert.equal(b.email.toLowerCase(), credentials.b.email.toLowerCase());
  const activeTechnicians = await request('GET', '/users/technicians', { token: managerToken });
  assert.ok(activeTechnicians.some(user => user.id === a.id));
  assert.ok(activeTechnicians.some(user => user.id === b.id));

  const projects = await request('GET', '/projects', { token: managerToken });
  project = projects.find(item => item.code.toUpperCase() === projectCode);
  assert.ok(project, `Project code ${projectCode} was not found`);
  const [systems, templates, tasks, inspections] = await Promise.all([
    request('GET', `/projects/${project.id}/systems`, { token: managerToken }),
    request('GET', '/checklist-templates', { token: managerToken }),
    request('GET', `/projects/${project.id}/tasks`, { token: managerToken }),
    request('GET', `/projects/${project.id}/inspections`, { token: managerToken }),
  ]);
  const system = systems.find(item => templates.some(template => template.category === item.category && template.isActive && template.items?.length));
  assert.ok(system, 'Selected Project needs a System with an active checklist template');
  const template = templates.find(item => item.category === system.category && item.isActive && item.items?.length);
  assert.ok(template);
  assert.ok(!tasks.some(item => item.code === taskCode), 'Task code collision; no writes performed');
  assert.ok(!inspections.some(item => item.code === inspectionCode), 'Inspection code collision; no writes performed');
  await prepareBrowser();

  const runUsers = { manager: { ...manager, credentials: credentials.manager }, a: { ...a, credentials: credentials.a }, b: { ...b, credentials: credentials.b } };
  phase = 'create Task and inspection fixtures';
  writesStarted = true;
  const task = taskFixture = await request('POST', `/projects/${project.id}/tasks`, {
    token: managerToken, expected: 201,
    body: { code: taskCode, title: `Smoke giao A sang B ${runId}`, systemId: system.id, assigneeId: a.id, description: 'Fixture smoke A→B; không phải dữ liệu công trình thật.' },
  });
  const inspection = inspectionFixture = await request('POST', `/projects/${project.id}/inspections`, {
    token: managerToken, expected: 201,
    body: { code: inspectionCode, title: `Smoke giao lỗi A sang B ${runId}`, systemId: system.id, templateId: template.id },
  });
  assert.ok(inspection.items?.length);
  const item = await request('PUT', `/projects/${project.id}/inspections/${inspection.id}/items/${inspection.items[0].id}/result`, {
    token: managerToken,
    body: { expectedVersion: inspection.items[0].version, result: 'FAIL', note: 'Fixture smoke giao A→B.', issue: { description: `Smoke Issue A→B ${runId}`, assigneeId: a.id } },
  });
  assert.equal(item.activeIssue.status, 'OPEN');
  const issue = issueFixture = item.activeIssue;

  phase = 'upload A and Manager evidence';
  const taskTarget = `/projects/${project.id}/tasks/${task.id}/evidence`;
  const issueTarget = `/projects/${project.id}/issues/${issue.id}/evidence`;
  const evidence = {
    taskA: await uploadTracked(aToken, taskTarget, `${runId}-task-a.png`, 'Task uploader A'),
    taskManager: await uploadTracked(managerToken, taskTarget, `${runId}-task-manager.png`, 'Task uploader MANAGER'),
    issueA: await uploadTracked(aToken, issueTarget, `${runId}-issue-a.png`, 'Issue uploader A'),
    issueManager: await uploadTracked(managerToken, issueTarget, `${runId}-issue-manager.png`, 'Issue uploader MANAGER'),
  };

  phase = 'reassign A to B';
  const reassignedTask = await request('PATCH', `/projects/${project.id}/tasks/${task.id}`, { token: managerToken, body: { assigneeId: b.id } });
  const reassignedIssue = await request('PATCH', `/projects/${project.id}/issues/${issue.id}/assignee`, { token: managerToken, body: { expectedVersion: issue.version, assigneeId: b.id } });
  taskFixture = reassignedTask;
  issueFixture = reassignedIssue;
  assert.equal(reassignedTask.assigneeId.toLowerCase(), b.id.toLowerCase());
  assert.equal(reassignedTask.status, 'ASSIGNED');
  assert.equal(reassignedIssue.assigneeId.id?.toLowerCase?.() || reassignedIssue.assigneeId.toLowerCase(), b.id.toLowerCase());
  assert.equal(reassignedIssue.status, 'OPEN');

  phase = 'old-owner denial and new-owner read';
  for (const id of [task.id, issue.id]) {
    const route = id === task.id ? `/projects/${project.id}/tasks/${id}` : `/projects/${project.id}/issues/${id}`;
    await request('GET', route, { token: aToken, expected: 404 });
  }
  await request('GET', taskTarget, { token: aToken, expected: 404 });
  await request('GET', issueTarget, { token: aToken, expected: 404 });
  for (const row of [evidence.taskA, evidence.taskManager, evidence.issueA, evidence.issueManager]) {
    for (const kind of ['content', 'preview']) await fileStatus(aToken, row.id, kind, 404);
    const onTask = row.taskId === task.id;
    const target = onTask ? taskTarget : issueTarget;
    const bRows = await request('GET', target, { token: bToken });
    assert.ok(bRows.some(current => current.id === row.id), 'B must see prior active evidence');
    assert.equal((await fileStatus(bToken, row.id, 'content', 200)).byteLength, row.sizeBytes);
    assert.equal((await fileStatus(bToken, row.id, 'preview', 200)).byteLength, row.sizeBytes);
    await assertDeniedMutation(bToken, row);
  }

  phase = 'browser ownership and B start';
  const uiPage = await browserChecks(runUsers, { task, inspection, issue });
  if (!uiPage) {
    await request('POST', `/projects/${project.id}/tasks/${task.id}/start`, { token: bToken, expected: 200 });
    await request('POST', `/projects/${project.id}/issues/${issue.id}/start`, {
      token: bToken, body: { expectedVersion: reassignedIssue.version }, expected: 200,
    });
  }
  const currentTask = await request('GET', `/projects/${project.id}/tasks/${task.id}`, { token: bToken });
  taskFixture = currentTask;
  assert.equal(currentTask.status, 'IN_PROGRESS');
  const currentIssue = await request('GET', `/projects/${project.id}/issues/${issue.id}`, { token: bToken });
  issueFixture = currentIssue;
  assert.equal(currentIssue.status, 'IN_PROGRESS');

  phase = 'B manages own evidence';
  const ownTaskEvidence = await uploadTracked(bToken, taskTarget, `${runId}-task-b.png`, 'Task uploader B');
  const editedTaskEvidence = await request('PATCH', `/projects/${project.id}/evidence/${ownTaskEvidence.id}`, { token: bToken, body: { expectedVersion: ownTaskEvidence.version, caption: 'Task B caption updated' } });
  const ownIssueEvidence = await uploadTracked(bToken, issueTarget, `${runId}-issue-b.png`, 'Issue uploader B');
  const editedIssueEvidence = await request('PATCH', `/projects/${project.id}/evidence/${ownIssueEvidence.id}`, { token: bToken, body: { expectedVersion: ownIssueEvidence.version, caption: 'Issue B caption updated' } });
  if (uiPage) {
    await browserEvidenceCrud(uiPage, 'issue', issue, ownIssueEvidence, [evidence.issueA, evidence.issueManager], issue.description);
    await browserEvidenceCrud(uiPage, 'task', task, ownTaskEvidence, [evidence.taskA, evidence.taskManager]);
  } else {
    await request('DELETE', `/projects/${project.id}/evidence/${ownTaskEvidence.id}`, { token: bToken, body: { expectedVersion: editedTaskEvidence.version, reason: 'A→B smoke: soft-delete evidence uploaded by B' }, expected: 204 });
    markEvidenceDeleted(ownTaskEvidence);
    await fileStatus(bToken, ownTaskEvidence.id, 'content', 404);
    await request('DELETE', `/projects/${project.id}/evidence/${ownIssueEvidence.id}`, { token: bToken, body: { expectedVersion: editedIssueEvidence.version, reason: 'A→B smoke: soft-delete evidence uploaded by B' }, expected: 204 });
    markEvidenceDeleted(ownIssueEvidence);
    await fileStatus(bToken, ownIssueEvidence.id, 'content', 404);
  }
  phase = 'complete workflow and recheck';
  const submittedTask = await request('POST', `/projects/${project.id}/tasks/${task.id}/submit`, { token: bToken, body: { completionNote: 'A→B smoke: B đã hoàn tất xử lý.' }, expected: 200 });
  taskFixture = submittedTask;
  taskFixture = await request('POST', `/projects/${project.id}/tasks/${task.id}/approve`, { token: managerToken, expected: 200 });
  const beforeResolve = await request('GET', `/projects/${project.id}/issues/${issue.id}`, { token: bToken });
  const resolvedIssue = await request('POST', `/projects/${project.id}/issues/${issue.id}/resolve`, { token: bToken, body: { expectedVersion: beforeResolve.version, resolutionNote: 'A→B smoke: B đã khắc phục.' }, expected: 200 });
  issueFixture = resolvedIssue;
  const closedIssue = await request('POST', `/projects/${project.id}/issues/${issue.id}/recheck`, {
    token: managerToken, expected: 200,
    body: { expectedVersion: resolvedIssue.version, expectedItemVersion: resolvedIssue.item.version, result: 'PASS', note: 'A→B smoke: MANAGER xác nhận.' },
  });
  issueFixture = closedIssue;
  assert.equal(submittedTask.status, 'SUBMITTED');
  assert.equal(closedIssue.status, 'CLOSED');

  phase = 'final ownership/read access';
  for (const row of [evidence.taskA, evidence.taskManager, evidence.issueA, evidence.issueManager]) {
    assert.equal((await fileStatus(bToken, row.id, 'content', 200)).byteLength, row.sizeBytes);
    await request('PATCH', `/projects/${project.id}/evidence/${row.id}`, { token: bToken, body: { expectedVersion: row.version, caption: 'locked smoke edit' }, expected: 409 });
    await request('DELETE', `/projects/${project.id}/evidence/${row.id}`, { token: bToken, body: { expectedVersion: row.version, reason: 'locked smoke delete' }, expected: 409 });
    await fileStatus(aToken, row.id, 'content', 404);
  }
  console.log(`PASS API A→B: distinct active technicians; Task ${taskCode} approved; Issue ${inspectionCode} closed; old-owner resource/content/preview denied; B read prior evidence and managed own evidence.`);
  console.log(`Fixture retained (no Task/Inspection DELETE API): Project ${project.code} (${project.id}), Task ${task.id}, Inspection ${inspection.id}, Issue ${issue.id}; run ${runId}.`);
  console.log('Evidence uploaded by A/MANAGER remains active for read-only handoff checks; B evidence is soft-deleted; disk files are retained by design.');
}

run().catch(error => {
  console.error(`A→B smoke stopped during ${phase}: ${error.message}`);
  if (writesStarted) {
    console.error(`Partial fixture may remain in Project ${project?.code || projectCode}; Task ${taskFixture?.id || taskCode} (last observed: ${taskFixture?.status || 'creation response not confirmed'}), Inspection ${inspectionFixture?.id || inspectionCode}, Issue ${issueFixture?.id || `description “Smoke Issue A→B ${runId}”`}, run ID ${runId}.`);
    if (uploadedEvidence.length) {
      console.error(`Evidence confirmed by upload response: ${uploadedEvidence.map(item => `${item.originalName} (${item.id}, ${item.state})`).join('; ')}.`);
    }
    console.error(`If failure occurred during an upload whose response was not received, check the predictable run-ID filenames ${runId}-task-a.png, ${runId}-task-manager.png, ${runId}-issue-a.png, ${runId}-issue-manager.png, ${runId}-task-b.png and ${runId}-issue-b.png before retrying; the server may have committed them.`);
    console.error('No automatic cleanup is attempted; Task/Inspection/Issue have no DELETE API and evidence files are retained by design.');
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
});
