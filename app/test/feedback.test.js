import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_SIZE, feedbackSummary, readFeedback, saveFeedback } from '../src/feedback.js';
import { record } from '../src/log.js';

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m };
};

async function logged(store, issueKey, decision) {
  await record(store, { issueKey, decision, reason: 'r', gates: {} }, { via: 'panel', at: '2026-11-21T00:00:00.000Z' });
}

test('a verdict is stored against the decision Hedge logged, not one the caller names', async () => {
  const store = memory();
  await logged(store, 'DEMO-50', 'clear');
  const saved = await saveFeedback(store, { issueKey: 'DEMO-50', verdict: 'wrong', at: 't1' });
  assert.deepEqual(saved, { issueKey: 'DEMO-50', decision: 'clear', verdict: 'wrong', at: 't1' });
  assert.deepEqual(await readFeedback(store), [saved]);
});

test('a ticket Hedge never decided on, or a verdict other than right or wrong, is refused', async () => {
  const store = memory();
  await assert.rejects(saveFeedback(store, { issueKey: 'DEMO-1', verdict: 'right' }), /no decision/);
  await logged(store, 'DEMO-1', 'ask');
  for (const verdict of ['maybe', '', null, true]) {
    await assert.rejects(saveFeedback(store, { issueKey: 'DEMO-1', verdict }), /right or wrong/);
  }
  assert.deepEqual(await readFeedback(store), []);
});

test('a new verdict on the same ticket replaces the old one, newest first, capped', async () => {
  const store = memory();
  for (let i = 0; i < FEEDBACK_SIZE + 5; i += 1) {
    await logged(store, `DEMO-${i}`, 'clear');
    await saveFeedback(store, { issueKey: `DEMO-${i}`, verdict: 'right', at: `t${i}` });
  }
  await saveFeedback(store, { issueKey: `DEMO-${FEEDBACK_SIZE + 4}`, verdict: 'wrong', at: 'later' });
  const all = await readFeedback(store);
  assert.equal(all.length, FEEDBACK_SIZE);
  assert.equal(all[0].verdict, 'wrong');
  assert.equal(all.filter((f) => f.issueKey === `DEMO-${FEEDBACK_SIZE + 4}`).length, 1);
});

test('the summary counts wrong actions among reviewed actions, and asks apart', () => {
  const s = feedbackSummary([
    { decision: 'clear', verdict: 'right' },
    { decision: 'clear', verdict: 'wrong' },
    { decision: 'link', verdict: 'right' },
    { decision: 'clear', verdict: 'right' },
    { decision: 'ask', verdict: 'wrong' },
  ]);
  assert.deepEqual(s, { reviewed: 4, wrong: 1, rate: 0.25, asks: 1 });
  assert.deepEqual(feedbackSummary(null), { reviewed: 0, wrong: 0, rate: null, asks: 0 });
});

test('a verdict still finds a decision that has left the capped log', async () => {
  const store = memory();
  await logged(store, 'DEMO-1', 'clear');
  for (let i = 100; i < 200; i += 1) await logged(store, `DEMO-${i}`, 'ask');
  const saved = await saveFeedback(store, { issueKey: 'DEMO-1', verdict: 'wrong', at: 't' });
  assert.equal(saved.decision, 'clear');
});

test('broken storage reads as no feedback', async () => {
  const broken = { get: async () => { throw new Error('down'); } };
  assert.deepEqual(await readFeedback(broken), []);
});
