import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, applyDecision } from '../src/act.js';

const plain = (strings, ...values) => String.raw({ raw: strings }, ...values.map(encodeURIComponent));

function fakeJira(fail = null) {
  const calls = [];
  const jira = async (path, options) => {
    calls.push({ path, method: options?.method, body: JSON.parse(options?.body ?? 'null') });
    if (fail && path.includes(fail)) throw new Error('Jira returned 400');
    return {};
  };
  return { jira, calls };
}

test('clearing a ticket adds the cleared label and nothing else', async () => {
  const { jira, calls } = fakeJira();
  const out = await applyDecision({ issueKey: 'DEMO-40', decision: 'clear' }, jira, plain);
  assert.deepEqual(out, { applied: true, label: LABELS.clear });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/api/2/issue/DEMO-40');
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { update: { labels: [{ add: 'hedge-cleared' }] } });
});

test('asking labels the ticket for the review queue', async () => {
  const { jira, calls } = fakeJira();
  const out = await applyDecision({ issueKey: 'DEMO-3', decision: 'ask' }, jira, plain);
  assert.deepEqual(out, { applied: true, label: 'hedge-ask' });
  assert.deepEqual(calls[0].body, { update: { labels: [{ add: 'hedge-ask' }] } });
});

test('a duplicate call is labelled for a person to link, and the app writes no link', async () => {
  const { jira, calls } = fakeJira();
  const out = await applyDecision({ issueKey: 'DEMO-90', decision: 'link', duplicateOf: 'DEMO-12' }, jira, plain);
  assert.deepEqual(out, { applied: true, label: 'hedge-duplicate', duplicateOf: 'DEMO-12' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/api/2/issue/DEMO-90');
  assert.deepEqual(calls[0].body, { update: { labels: [{ add: 'hedge-duplicate' }] } });
});

test('a link without a target, an error or an unknown decision changes nothing', async () => {
  for (const result of [
    { issueKey: 'DEMO-1', decision: 'link' },
    { issueKey: 'DEMO-1', decision: 'close' },
    { error: 'issueKey must look like PROJ-123.' },
    { decision: 'clear' },
    null,
  ]) {
    const { jira, calls } = fakeJira();
    const out = await applyDecision(result, jira, plain);
    assert.equal(out.applied, false);
    assert.equal(calls.length, 0);
  }
});

test('a Jira failure is reported, not thrown', async () => {
  const label = fakeJira('/issue/');
  const out = await applyDecision({ issueKey: 'DEMO-40', decision: 'clear' }, label.jira, plain);
  assert.equal(out.applied, false);
  assert.match(out.error, /400/);
});
