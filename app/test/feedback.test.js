import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackSummary, readFeedback, saveFeedback } from '../src/feedback.js';
import { record } from '../src/log.js';

const memory = () => {
  const m = new Map();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    list: async (prefix) => [...m].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v),
    m,
  };
};

async function logged(store, issueKey, decision, via = 'panel', applied = null) {
  const result = { issueKey, decision, reason: 'r', gates: {} };
  if (applied !== null) result.applied = { applied };
  await record(store, result, { via, at: '2026-11-21T00:00:00.000Z' });
}

test('a verdict is stored against the decision Hedge logged, with who gave it', async () => {
  const store = memory();
  await logged(store, 'DEMO-50', 'clear', 'trigger', true);
  const saved = await saveFeedback(store, { issueKey: 'DEMO-50', verdict: 'wrong', accountId: 'u1', at: 't1' });
  assert.deepEqual(saved, { issueKey: 'DEMO-50', decision: 'clear', via: 'trigger', applied: true, verdict: 'wrong', accountId: 'u1', at: 't1' });
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

test('a new verdict on the same ticket replaces the old one', async () => {
  const store = memory();
  await logged(store, 'DEMO-7', 'clear', 'trigger', true);
  await saveFeedback(store, { issueKey: 'DEMO-7', verdict: 'right' });
  await saveFeedback(store, { issueKey: 'DEMO-7', verdict: 'wrong' });
  const all = await readFeedback(store);
  assert.equal(all.length, 1);
  assert.equal(all[0].verdict, 'wrong');
});

test('a panel view after the trigger does not replace what the trigger did', async () => {
  const store = memory();
  await logged(store, 'DEMO-8', 'clear', 'trigger', true);
  await logged(store, 'DEMO-8', 'ask', 'panel');
  const saved = await saveFeedback(store, { issueKey: 'DEMO-8', verdict: 'right' });
  assert.equal(saved.decision, 'clear');
  assert.equal(saved.via, 'trigger');
});

test('a verdict still finds a decision that has left the capped log', async () => {
  const store = memory();
  await logged(store, 'DEMO-1', 'clear');
  for (let i = 100; i < 200; i += 1) await logged(store, `DEMO-${i}`, 'ask');
  const saved = await saveFeedback(store, { issueKey: 'DEMO-1', verdict: 'wrong', at: 't' });
  assert.equal(saved.decision, 'clear');
});

test('only applied actions count against the budget; asks and shown-only calls count apart', () => {
  const s = feedbackSummary([
    { decision: 'clear', applied: true, verdict: 'right' },
    { decision: 'clear', applied: true, verdict: 'wrong' },
    { decision: 'link', applied: true, verdict: 'right' },
    { decision: 'clear', applied: true, verdict: 'right' },
    { decision: 'clear', applied: false, verdict: 'wrong' },
    { decision: 'ask', applied: true, verdict: 'wrong' },
    null,
  ]);
  assert.deepEqual(s, { reviewed: 4, wrong: 1, rate: 0.25, asks: 1, shownOnly: 1 });
  assert.deepEqual(feedbackSummary(null), { reviewed: 0, wrong: 0, rate: null, asks: 0, shownOnly: 0 });
});

test('broken storage reads as no feedback', async () => {
  const broken = { list: async () => { throw new Error('down'); } };
  assert.deepEqual(await readFeedback(broken), []);
});
