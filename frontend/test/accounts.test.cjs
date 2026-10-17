const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(relative, dependencies = {}) {
  const file = path.resolve(__dirname, relative), mod = new Module(file, module);
  mod.require = name => name in dependencies ? dependencies[name] : require(name);
  const source = fs.readFileSync(file, 'utf8').replace('import.meta.env.VITE_API_URL', 'undefined');
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return mod.exports;
}
const client = load('../src/api/client.ts');
const form = load('../src/account-form.ts', { './api/client': client });
test('password policy uses Unicode codepoints/UTF-8 bytes, never trims', () => {
  assert.equal(form.passwordProblem('x'.repeat(72)), '');
  assert.ok(form.passwordProblem('x'.repeat(73)));
  assert.equal(form.passwordProblem('😀'.repeat(18)), '');
  assert.ok(form.passwordProblem('😀'.repeat(19)));
  assert.ok(form.passwordProblem('x'.repeat(11)));
  assert.ok(form.passwordProblem('x'.repeat(12) + '\0'));
  assert.equal(form.passwordProblem(' '.repeat(12)), '');
});
test('account errors distinguish forced password, role, stale version, open-work details', () => {
  const details = { taskCount: 1, issueCount: 0, tasks: [{ id: 'task', projectId: 'project', code: 'TEST', status: 'ASSIGNED' }], issues: [] };
  const error = new client.ApiError(409, 'conflict', 'TECHNICIAN_HAS_OPEN_WORK', details);
  assert.equal(form.openWorkOf(error), details);
  assert.match(form.accountError(error), /chưa hoàn tất/);
  assert.equal(form.openWorkOf(new client.ApiError(409, 'conflict')), null);
  assert.match(form.accountError(new client.ApiError(409, '', 'ACCOUNT_VERSION_CONFLICT')), /nội dung nhập được giữ/);
});
test('API payloads contain explicit versions, status no-op and untrimmed passwords; no secret in URL', async () => {
  const calls = [], api = load('../src/api/users.ts', { './client': { apiRequest: async (url, options) => { calls.push({ url, options }); } } });
  const row = { id: 'fixture', version: 3, isActive: true };
  const value = ' ' + 'x'.repeat(12) + ' ';
  await api.createTechnician('test-only', ' user@example.invalid ', value);
  await api.resetTechnician('test-only', row, value);
  await api.setTechnicianStatus('test-only', row, true);
  await api.changePassword('test-only', 7, value, value);
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'user@example.invalid', temporaryPassword: value });
  assert.deepEqual(JSON.parse(calls[1].options.body), { expectedVersion: 3, temporaryPassword: value });
  assert.deepEqual(JSON.parse(calls[2].options.body), { expectedVersion: 3, isActive: true });
  assert.deepEqual(JSON.parse(calls[3].options.body), { expectedVersion: 7, currentPassword: value, newPassword: value });
  assert.ok(calls.every(c => !c.url.includes(value) && !c.url.includes('test-only')));
});
test('client preserves structured errors and emits session events only for authenticated 401/forced change', async () => {
  const original = global.fetch, events = [];
  client.startSession('test-only');
  const stop = client.onSessionFailure(e => events.push(e));
  try {
    for (const [status, code] of [[403, 'PASSWORD_CHANGE_REQUIRED'], [403, undefined], [401, undefined]]) {
      global.fetch = async () => new Response(JSON.stringify({ code, details: { taskCount: 1 } }), { status });
      await assert.rejects(client.apiRequest('/fixture', { token: 'test-only' }), e => e.status === status && e.code === code && e.details.taskCount === 1);
    }
    assert.deepEqual(events.map(e => e.kind), ['password-required', 'expired']);
    await assert.rejects(client.apiRequest('/auth/login'));
    assert.equal(events.length, 2);
    stop();
    await assert.rejects(client.apiRequest('/fixture', { token: 'test-only' }));
    assert.equal(events.length, 2);
  } finally { stop(); global.fetch = original; }
});
test('session generations distinguish identical JWTs and ignore stale 401 while current 401 invalidates once', () => {
  const jwt = 'same.jwt.value';
  const first = client.startSession(jwt), firstRequestSession = client.sessionIdFor(jwt);
  assert.equal(firstRequestSession, first);
  const second = client.startSession(jwt);
  assert.notEqual(second, first, 'a new login is not identified by JWT text');
  let signOuts = 0;
  const stop = client.onSessionFailure(event => {
    if (client.isCurrentSession(event.sessionId, event.token)) {
      signOuts++;
      client.invalidateSession(event.sessionId);
    }
  });
  try {
    client.reportSessionFailure(jwt, firstRequestSession);
    assert.equal(signOuts, 0, 'late 401 from previous generation cannot sign out current session');
    assert.equal(client.isCurrentSession(second, jwt), true);
    client.reportSessionFailure(jwt, second);
    client.reportSessionFailure(jwt, second);
    assert.equal(signOuts, 1, 'only the active session is invalidated, once');
    assert.equal(client.isCurrentSession(second, jwt), false);
  } finally { stop(); }
});
test('401 in API error events retains request session ID, including evidence and downloads', async () => {
  const original = global.fetch, events = [], jwt = 'same.jwt.value';
  const session = client.startSession(jwt), stop = client.onSessionFailure(e => events.push(e));
  const evidence = load('../src/api/evidence.ts', { './client': client });
  const exports = load('../src/api/exports.ts', { './client': client });
  try {
    global.fetch = async () => new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
    await assert.rejects(client.apiRequest('/old-request', { token: jwt }));
    await assert.rejects(evidence.evidenceRequest(jwt, '/evidence'));
    await assert.rejects(exports.requestExport(jwt, 'project', 'devices', new AbortController().signal));
    assert.equal(events.length, 3);
    assert.ok(events.every(e => e.sessionId === session && e.kind === 'expired'));
  } finally { stop(); global.fetch = original; }
});
test('an in-flight request reports the session ID captured before identical-token re-login', async () => {
  const original = global.fetch, events = [], jwt = 'same.jwt.value';
  const oldSession = client.startSession(jwt), stop = client.onSessionFailure(e => events.push(e));
  let resolveResponse;
  try {
    global.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
    const pending = client.apiRequest('/held', { token: jwt });
    const currentSession = client.startSession(jwt);
    assert.notEqual(oldSession, currentSession);
    resolveResponse(new Response('{}', { status: 401 }));
    await assert.rejects(pending, e => e.status === 401);
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionId, oldSession);
    assert.equal(client.isCurrentSession(currentSession, jwt), true);
  } finally { stop(); global.fetch = original; }
});
test('me validates/whitelists security fields rather than discarding forced-change state', async () => {
  let response = { id: 'fixture', email: 'user@example.invalid', role: 'TECHNICIAN', isActive: true, version: 2, mustChangePassword: true, passwordHash: 'not-returned' };
  const auth = load('../src/api/auth.ts', { './client': { ...client, apiRequest: async () => response } });
  assert.deepEqual(Object.keys(await auth.getMe('test-only')).sort(), ['id', 'email', 'role', 'isActive', 'version', 'mustChangePassword'].sort());
  assert.equal((await auth.getMe('test-only')).mustChangePassword, true);
  response = { ...response, version: undefined };
  await assert.rejects(auth.getMe('test-only'));
});
test('mock browser smoke rejects same-origin configuration before loading Playwright or opening the browser', () => {
  const { spawnSync } = require('node:child_process');
  const origin = 'http://127.0.0.1:5173';
  const result = spawnSync(process.execPath, [path.resolve(__dirname, 'accounts.browser.cjs')], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, ACCOUNT_REAL_SMOKE: '0', ACCOUNT_API_URL: origin, ACCOUNT_WEB_URL: `${origin}/`, PLAYWRIGHT_MODULE: path.join(__dirname, 'must-not-load-playwright.cjs') },
  });
  assert.equal(result.status, 1, 'unsupported mock origins fail');
  assert.match(result.stderr, /Mock mode does not support ACCOUNT_API_URL and ACCOUNT_WEB_URL with the same origin/);
  assert.doesNotMatch(result.stderr, /must-not-load-playwright|Timed out waiting/);
  assert.doesNotMatch(result.stdout, /Account smoke:/, 'no browser stages or requests can start before the preflight');
});
