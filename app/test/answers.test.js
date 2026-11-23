import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerSummary, saveAnswer } from '../src/answers.js';
import { LABELS, leaveQueue } from '../src/act.js';

const memory = (decision) => {
  const m = new Map(decision ? [[`decision:${decision.issueKey}`, decision]] : []);
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    list: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([, v]) => v),
  };
};
const asked = { issueKey: 'DEMO-9', decision: 'ask', via: 'trigger' };
const ok = async () => ({ ok: true });

test('an answer takes the ticket out of the queue, then is counted', async () => {
  const store = memory(asked);
  const left = [];
  await saveAnswer(store, async (k) => { left.push(k); return { ok: true }; }, { issueKey: 'DEMO-9', answer: 'duplicate', accountId: 'u' });
  assert.deepEqual(left, ['DEMO-9']);
  assert.deepEqual(await answerSummary(store), { fresh: 0, duplicate: 1 });
});

test('a new answer on the same ticket replaces the old one', async () => {
  const store = memory(asked);
  await saveAnswer(store, ok, { issueKey: 'DEMO-9', answer: 'duplicate' });
  await saveAnswer(store, ok, { issueKey: 'DEMO-9', answer: 'new' });
  assert.deepEqual(await answerSummary(store), { fresh: 1, duplicate: 0 });
});

test('when Jira refuses the label edit, no answer is stored', async () => {
  const store = memory(asked);
  await assert.rejects(saveAnswer(store, async () => ({ ok: false, error: 'Jira returned 403' }), { issueKey: 'DEMO-9', answer: 'new' }), /403/);
  assert.deepEqual(await answerSummary(store), { fresh: 0, duplicate: 0 });
});

test('unknown answers and tickets the trigger never handled touch nothing', async () => {
  const never = async () => assert.fail('wrote to Jira');
  await assert.rejects(saveAnswer(memory(asked), never, { issueKey: 'DEMO-9', answer: 'maybe' }), /new or duplicate/);
  for (const store of [memory(), memory({ ...asked, via: 'panel' })]) {
    await assert.rejects(saveAnswer(store, never, { issueKey: 'DEMO-9', answer: 'new' }), /did not put/);
  }
});

test('unreadable answers are unknown, not zero', async () => {
  assert.equal(await answerSummary({ list: async () => { throw new Error('down'); } }), null);
});

test('leaving the queue removes only the hedge-ask label', async () => {
  let body;
  const route = (s, ...v) => String.raw({ raw: s }, ...v);
  await leaveQueue('DEMO-9', async (path, o) => { body = JSON.parse(o.body); }, route);
  assert.deepEqual(body, { update: { labels: [{ remove: LABELS.ask }] } });
});
