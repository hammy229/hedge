import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerSummary, readAnswer, saveAnswer } from '../src/answers.js';
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

test('an unknown answer touches nothing', async () => {
  const never = async () => assert.fail('wrote to Jira');
  await assert.rejects(saveAnswer(memory(asked), never, { issueKey: 'DEMO-9', answer: 'maybe' }), /new or duplicate/);
});

test('a ticket labeled by hand can be answered, and the answer is found again', async () => {
  const store = memory();
  assert.equal(await readAnswer(store, 'DEMO-9'), null);
  await saveAnswer(store, ok, { issueKey: 'DEMO-9', answer: 'new' });
  assert.equal((await readAnswer(store, 'DEMO-9')).answer, 'new');
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

test('a named duplicate is linked before it leaves the queue, and the answer keeps the name', async () => {
  const store = memory(asked);
  const order = [];
  const out = await saveAnswer(store, async () => { order.push('leave'); return { ok: true }; }, { issueKey: 'DEMO-9', answer: 'duplicate', duplicateOf: 'DEMO-2' }, async (a, b) => { order.push(`${a} ${b}`); return { ok: true }; });
  assert.deepEqual(order, ['DEMO-9 DEMO-2', 'leave']);
  assert.equal(out.duplicateOf, 'DEMO-2');
  assert.equal((await readAnswer(store, 'DEMO-9')).duplicateOf, 'DEMO-2');
});

test('a refused link leaves the ticket in the queue with no answer', async () => {
  const store = memory(asked);
  const stay = async () => assert.fail('left the queue');
  await assert.rejects(saveAnswer(store, stay, { issueKey: 'DEMO-9', answer: 'duplicate', duplicateOf: 'DEMO-2' }, async () => ({ ok: false, error: 'no link type' })), /no link type/);
  await assert.rejects(saveAnswer(store, stay, { issueKey: 'DEMO-9', answer: 'duplicate', duplicateOf: 'DEMO-2' }), /cannot be written/);
  assert.equal(await readAnswer(store, 'DEMO-9'), null);
});

test('a new report cannot name an earlier issue', async () => {
  const never = async () => assert.fail('wrote to Jira');
  await assert.rejects(saveAnswer(memory(asked), never, { issueKey: 'DEMO-9', answer: 'new', duplicateOf: 'DEMO-2' }, never), /Only a duplicate/);
});
