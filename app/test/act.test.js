import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, applyDecision, requeue } from '../src/act.js';

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

test('a project whose edit screen has no Labels field gets a fix, not Jira\'s text', async () => {
  const jira = async () => {
    const e = new Error('Jira returned 400: {"errorMessages":[],"errors":{"labels":"Field \'labels\' cannot be set. It is not on the appropriate screen, or unknown."}}');
    e.jiraBody = { errorMessages: [], errors: { labels: "Field 'labels' cannot be set. It is not on the appropriate screen, or unknown." } };
    e.status = 400;
    throw e;
  };
  const out = await applyDecision({ issueKey: 'DEMO-40', decision: 'clear' }, jira, plain);
  assert.equal(out.applied, false);
  assert.match(out.error, /Labels field/);
  assert.doesNotMatch(out.error, /appropriate screen/);
});

test('any other write failure reports only the status', async () => {
  const jira = async () => {
    const e = new Error('Jira returned 403: secret project text');
    e.jiraBody = { errorMessages: ['secret project text'] };
    e.status = 403;
    throw e;
  };
  const out = await applyDecision({ issueKey: 'DEMO-40', decision: 'clear' }, jira, plain);
  assert.deepEqual(out, { applied: false, error: 'Jira returned 403' });
});

const route = (s, ...v) => String.raw({ raw: s }, ...v);

test('a call marked wrong swaps its label for hedge-ask', async () => {
  const sent = [];
  const out = await requeue({ issueKey: 'DEMO-9', decision: 'clear', applied: true, verdict: 'wrong' }, async (path, o) => void sent.push([path, JSON.parse(o.body)]), route);
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(sent, [['/rest/api/2/issue/DEMO-9', { update: { labels: [{ remove: 'hedge-cleared' }, { add: 'hedge-ask' }] } }]]);
});

test('right verdicts, asks and calls Hedge only showed move nothing', async () => {
  const never = async () => assert.fail('wrote to Jira');
  const base = { issueKey: 'DEMO-9', decision: 'clear', applied: true, verdict: 'wrong' };
  for (const over of [{ verdict: 'right' }, { decision: 'ask' }, { applied: false }, { decision: 'x' }]) {
    assert.equal(await requeue({ ...base, ...over }, never, route), null);
  }
});

test('a person who may not edit the issue gets the status, not an error', async () => {
  const out = await requeue({ issueKey: 'DEMO-9', decision: 'clear', applied: true, verdict: 'wrong' }, async () => { throw Object.assign(new Error('secret'), { status: 403 }); }, route);
  assert.deepEqual(out, { ok: false, error: 'Jira returned 403' });
});
