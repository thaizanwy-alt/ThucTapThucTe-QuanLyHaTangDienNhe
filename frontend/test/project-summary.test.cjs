const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const file = path.resolve(__dirname, relative), loaded = new Module(file, module);
  loaded.paths = module.paths;
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  return loaded.exports;
}
const { taskGroups, issueGroups, inspectionGroup, inspectionGroups, acceptanceGroups, summaryView } = load('../src/summary-navigation.ts');

test('summary work groups include every unfinished status without changing enum filters', () => {
  for (const status of ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED']) {
    assert.equal(taskGroups[0].matches({ status }), status !== 'APPROVED');
  }
  for (const status of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
    assert.equal(issueGroups[0].matches({ status }), status !== 'CLOSED');
  }
  assert.equal(summaryView('notClosed'), 'checks');
  for (const group of acceptanceGroups) assert.equal(summaryView(group.value), 'acceptances');
});

test('inspection groups are disjoint, use server passed, and include empty sheets in pending', () => {
  const sheet = (passed, total, notChecked, openIssues) => ({ passed, summary: { total, notChecked, openIssues } });
  const rows = [sheet(true, 3, 0, 0), sheet(false, 3, 3, 0), sheet(false, 3, 2, 0), sheet(false, 0, 0, 0), sheet(false, 3, 3, 1)];
  assert.deepEqual(rows.map(inspectionGroup), ['passed', 'notChecked', 'pendingOrFailed', 'pendingOrFailed', 'pendingOrFailed']);
  for (const row of rows) assert.equal(inspectionGroups.filter(group => group.matches(row)).length, 1);
});

test('acceptance groups respect confirmed replacement chains and leave drafts separate', () => {
  const rows = [{ status: 'DRAFT', replacedById: null }, { status: 'CONFIRMED', replacedById: null },
    { status: 'CONFIRMED', replacedById: 'next' }, { status: 'CONFIRMED', replacedById: 'latest' }];
  assert.deepEqual(acceptanceGroups.map(group => rows.filter(group.matches).length), [1, 1, 2]);
});

test('summary API forwards only Project, token and abort signal, preserving omitted role fields', async () => {
  const calls = [], value = { projectId: 'A/B', tasks: { total: 0 }, acceptances: { confirmedCurrent: 0, superseded: 0 } };
  const { getProjectSummary } = load('../src/api/project-summary.ts', {
    './client': { apiRequest: async (...args) => { calls.push(args); return value; } },
  });
  const controller = new AbortController();
  assert.equal(await getProjectSummary('in-memory-fixture', 'A/B', controller.signal), value);
  assert.deepEqual(calls, [['/projects/A%2FB/summary', { token: 'in-memory-fixture', signal: controller.signal }]]);
  assert.equal('inspections' in value, false); assert.equal('draft' in value.acceptances, false);
});
