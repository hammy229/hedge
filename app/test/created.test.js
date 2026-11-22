import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onCreated } from '../src/created.js';

function deps({ on = true, decision = 'clear', applied = { applied: true, label: 'hedge-cleared' }, handled = false, seeding = false, failed = false, labels = null } = {}) {
  const calls = { triage: [], apply: [], seeding: [] };
  return {
    calls,
    readAutoAct: async () => on,
    alreadyHandled: async () => handled,
    seeding: async (projectKey) => {
      calls.seeding.push(projectKey);
      return seeding;
    },
    triage: async (key, via, as, after) => {
      calls.triage.push({ key, via, as });
      const result = { issueKey: key, decision };
      if (failed) result.failed = true;
      if (labels) result.labels = labels;
      result.applied = await after(result);
      return result;
    },
    apply: async (result) => {
      calls.apply.push(result);
      return applied;
    },
  };
}

test('a new issue is triaged as the app and the decision applied when acting is on', async () => {
  const d = deps();
  const out = await onCreated({ issue: { key: 'DEMO-77' } }, d);
  assert.deepEqual(d.calls.triage, [{ key: 'DEMO-77', via: 'trigger', as: 'app' }]);
  assert.equal(d.calls.apply.length, 1);
  assert.equal(out.decision, 'clear');
  assert.deepEqual(out.applied, { applied: true, label: 'hedge-cleared' });
});

test('with acting off, a new issue is not even triaged', async () => {
  const d = deps({ on: false });
  const out = await onCreated({ issue: { key: 'DEMO-77' } }, d);
  assert.deepEqual(out, { skipped: 'Acting on new issues is off.' });
  assert.equal(d.calls.triage.length, 0);
  assert.equal(d.calls.apply.length, 0);
});

test('an event without an issue key does nothing', async () => {
  for (const event of [{}, { issue: {} }, null, undefined]) {
    const d = deps();
    const out = await onCreated(event, d);
    assert.ok(out.skipped);
    assert.equal(d.calls.triage.length, 0);
  }
});

test('a triage that failed to read Jira is not applied', async () => {
  const d = deps();
  d.triage = async (key, via, as, after) => {
    const result = { error: 'issueKey must look like PROJ-123.' };
    return result;
  };
  const out = await onCreated({ issue: { key: 'bad' } }, d);
  assert.equal(d.calls.apply.length, 0);
  assert.ok(out.error);
});

test('sample issues, subtasks, seeding projects and handled issues are skipped untriaged', async () => {
  const cases = [
    [{ issue: { key: 'DEMO-9', fields: { labels: ['hedge-sample'] } } }, {}, /Sample issues/],
    [{ issue: { key: 'DEMO-9', fields: { issuetype: { subtask: true } } } }, {}, /Subtasks/],
    [{ issue: { key: 'DEMO-9', fields: { project: { key: 'DEMO' } } } }, { seeding: true }, /Sample data is being added/],
    [{ issue: { key: 'DEMO-9' } }, { handled: true }, /already handled/],
  ];
  for (const [event, opts, why] of cases) {
    const d = deps(opts);
    const out = await onCreated(event, d);
    assert.match(out.skipped, why);
    assert.equal(d.calls.triage.length, 0);
  }
});

test('the seeding check uses the project key, from the event or the issue key', async () => {
  const d = deps();
  await onCreated({ issue: { key: 'ABC_2-14' } }, d);
  await onCreated({ issue: { key: 'X-1', fields: { project: { key: 'OTHER' } } } }, d);
  assert.deepEqual(d.calls.seeding, ['ABC_2', 'OTHER']);
});

test('a triage that could not read Jira changes nothing on the issue', async () => {
  const d = deps({ decision: 'ask', failed: true });
  const out = await onCreated({ issue: { key: 'DEMO-77' } }, d);
  assert.equal(d.calls.apply.length, 0);
  assert.equal(out.applied.applied, false);
});

test('a sample issue whose event had no labels is still left alone once triage reads them', async () => {
  const d = deps({ labels: ['hedge-sample'] });
  const out = await onCreated({ issue: { key: 'DEMO-100' } }, d);
  assert.equal(d.calls.triage.length, 1);
  assert.equal(d.calls.apply.length, 0);
  assert.match(out.applied.error, /Sample issues/);
});
