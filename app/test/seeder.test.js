import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL, issueFields, pickIssueType, seedStatus, seedStep } from '../src/seeder.js';

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m };
};

const items = Array.from({ length: 5 }, (_, i) => ({ summary: `issue ${i}`, description: `body ${i}`, duplicateOf: [] }));

function fakeJira({ failOn = () => null } = {}) {
  const created = [];
  const jira = async (path, options) => {
    if (path === '/rest/api/2/project/DEMO') {
      return { id: '10000', issueTypes: [{ id: '3', name: 'Task', subtask: false }, { id: '5', name: 'Sub-task', subtask: true }] };
    }
    if (path === '/rest/api/2/issue' && options?.method === 'POST') {
      const { fields } = JSON.parse(options.body);
      const err = failOn(fields, created.length);
      if (err) throw new Error(err);
      created.push(fields);
      return { key: `DEMO-${created.length}` };
    }
    throw new Error(`Jira returned 404 for ${path}`);
  };
  return { jira, created };
}

test('creates every item in order with the label, then reports done', async () => {
  const { jira, created } = fakeJira();
  const store = memory();
  const out = await seedStep({ jira, store, projectKey: 'demo', items });
  assert.deepEqual(out, { projectKey: 'DEMO', created: 5, total: 5, done: true });
  assert.deepEqual(created.map((f) => f.summary), items.map((i) => i.summary));
  assert.ok(created.every((f) => f.project.id === '10000' && f.issuetype.id === '3' && f.labels[0] === LABEL));
  const again = await seedStep({ jira, store, projectKey: 'DEMO', items });
  assert.equal(again.done, true);
  assert.equal(created.length, 5, 'a finished project is never seeded twice');
});

test('stops at the deadline and resumes where it stopped', async () => {
  const { jira, created } = fakeJira();
  const store = memory();
  let clock = 0;
  const slow = async (path, options) => {
    clock += 1;
    return jira(path, options);
  };
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const first = await seedStep({ jira: slow, store, projectKey: 'DEMO', items, deadline: 3 });
    assert.equal(first.done, false);
    assert.ok(first.created > 0 && first.created < 5);
    const second = await seedStep({ jira: slow, store, projectKey: 'DEMO', items, deadline: Infinity });
    assert.equal(second.done, true);
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(created.map((f) => f.summary), items.map((i) => i.summary));
});

test('a project without a Labels field is seeded without the label', async () => {
  const { jira, created } = fakeJira({ failOn: (f) => (f.labels ? 'Jira returned 400: Field labels cannot be set' : null) });
  const store = memory();
  const out = await seedStep({ jira, store, projectKey: 'DEMO', items });
  assert.equal(out.done, true);
  assert.equal(created.length, 5);
  assert.ok(created.every((f) => !('labels' in f)));
});

test('any other create error stops the step and keeps the progress', async () => {
  const { jira } = fakeJira({ failOn: (f, n) => (n === 2 ? 'Jira returned 403' : null) });
  const store = memory();
  await assert.rejects(seedStep({ jira, store, projectKey: 'DEMO', items }), /403/);
  assert.deepEqual(await seedStatus(store, 'DEMO'), { projectKey: 'DEMO', created: 2, total: 150, done: false });
});

test('bad project keys and projects without a usable type are refused', async () => {
  const { jira } = fakeJira();
  for (const projectKey of ['', 'D', '1ABC', 'DE MO', 'DEMO/../x', undefined]) {
    await assert.rejects(seedStep({ jira, store: memory(), projectKey, items }), /project key/);
  }
  await assert.rejects(seedStep({ jira, store: memory(), projectKey: 'NOPE', items }), /404/);
  const onlySubtasks = async () => ({ id: '1', issueTypes: [{ id: '5', name: 'Sub-task', subtask: true }] });
  await assert.rejects(seedStep({ jira: onlySubtasks, store: memory(), projectKey: 'DEMO', items }), /no issue type/);
});

test('issue type preference is Bug, then Task, then Story, then any standard type', () => {
  const t = (name, subtask = false) => ({ id: name, name, subtask });
  assert.equal(pickIssueType([t('Story'), t('Task'), t('Bug')]).name, 'Bug');
  assert.equal(pickIssueType([t('Story'), t('Task')]).name, 'Task');
  assert.equal(pickIssueType([t('Epic'), t('Story')]).name, 'Story');
  assert.equal(pickIssueType([t('Sub-task', true), t('Epic')]).name, 'Epic');
  assert.equal(pickIssueType([t('Sub-task', true)]), null);
  assert.equal(pickIssueType(undefined), null);
});

test('fields carry the summary and the plain-text description that v2 scores', () => {
  const f = issueFields({ summary: 's', description: 'd' }, 7, 3);
  assert.deepEqual(f, { project: { id: '7' }, issuetype: { id: '3' }, summary: 's', description: 'd', labels: [LABEL] });
  assert.ok(!('labels' in issueFields({ summary: 's', description: 'd' }, 7, 3, false)));
});

test('Jira errors keep a short, single-line body so the label fallback can see the field', async () => {
  const { jiraError } = await import('../src/index.js');
  const res = (status, text) => ({ status, text: async () => text });
  assert.equal(await jiraError(res(400, '{"errors":\n{"labels":"Field \'labels\' cannot be set."}}')), 'Jira returned 400: {"errors": {"labels":"Field \'labels\' cannot be set."}}');
  assert.equal((await jiraError(res(500, 'x'.repeat(1000)))).length, 'Jira returned 500: '.length + 200);
  assert.equal(await jiraError(res(404, '')), 'Jira returned 404');
  assert.equal(await jiraError({ status: 502, text: async () => { throw new Error('gone'); } }), 'Jira returned 502');
});
