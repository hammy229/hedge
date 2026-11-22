import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onCreated } from '../src/created.js';

function deps({ on = true, decision = 'clear', applied = { applied: true, label: 'hedge-cleared' } } = {}) {
  const calls = { triage: [], apply: [] };
  return {
    calls,
    readAutoAct: async () => on,
    triage: async (key, via, as, after) => {
      calls.triage.push({ key, via, as });
      const result = { issueKey: key, decision };
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
