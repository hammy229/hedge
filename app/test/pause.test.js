import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePolicy } from '../src/gate.js';
import { checkEvidence, counted, pauseReason, readPauses, resume, withPauses } from '../src/pause.js';
import policies from '../src/policy.js';
import seed from '../src/seed.js';
import { triage } from '../src/triage.js';

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m };
};
const call = (verdict, over = {}) => ({ decision: 'clear', applied: true, verdict, budget: 0.03, decidedAt: '2026-11-23T10:00:00.000Z', ...over });

test('two wrong clears in a row pause clearing, and a right one later does not lift it', async () => {
  const store = memory();
  assert.equal((await checkEvidence(store, [call('wrong')], 'clear')).paused, false);
  const p = await checkEvidence(store, [call('wrong'), call('wrong')], 'clear', 't');
  assert.deepEqual(p, { paused: true, at: 't', reviewed: 2, wrong: 2, budget: 0.03 });
  const many = [call('wrong'), call('wrong'), ...Array(200).fill(call('right'))];
  assert.equal((await checkEvidence(store, many, 'clear')).paused, true);
  const now = await readPauses(store);
  assert.equal(now.clear.paused, true);
  assert.equal(now.link.paused, false);
});

test('only calls the trigger carried out, with a known time, count', () => {
  const list = [call('wrong'), call('wrong', { applied: false }), call('wrong', { decision: 'ask' }), call('wrong', { decidedAt: undefined }), null];
  assert.deepEqual(counted(list, 'clear'), [{ wrong: true, budget: 0.03 }]);
  assert.deepEqual(counted(null, 'clear'), []);
});

test('resuming starts the evidence over, even if an old call gets a new verdict', async () => {
  const store = memory();
  await checkEvidence(store, [call('wrong'), call('wrong')], 'clear');
  const after = await resume(store, 'clear', '2026-11-24T00:00:00.000Z');
  assert.equal(after.clear.paused, false);
  assert.equal((await checkEvidence(store, [call('wrong'), call('wrong'), call('wrong')], 'clear')).paused, false);
  const fresh = [1, 2].map(() => call('wrong', { decidedAt: '2026-11-24T09:00:00.000Z' }));
  assert.equal((await checkEvidence(store, fresh, 'clear')).paused, true);
  await assert.rejects(resume(store, 'ask'), /Unknown action/);
});

test('a pause that cannot be read counts as paused', async () => {
  const broken = { get: async () => { throw new Error('down'); } };
  assert.equal((await readPauses(broken)).clear.paused, true);
  const store = memory();
  for (const bad of ['yes', 1, {}, { paused: 'no' }]) {
    store.m.set('pause:clear', bad);
    assert.equal((await readPauses(store)).clear.paused, true);
  }
  assert.match(describePolicy(withPauses(policies, undefined).clear).guarantee, /could not read/);
});

test('a paused action asks about every ticket and says why', () => {
  const issues = seed.issues.slice(0, 120).map((s, i) => ({
    key: `DEMO-${i + 1}`,
    fields: { summary: s.summary, description: s.description, created: new Date(Date.parse('2026-12-01T00:00:00Z') + i * 2000).toISOString().replace('Z', '+0000') },
  }));
  const replay = (p) => issues.map((issue, i) => triage({ issue, window: issues.slice(0, i), projectKeys: ['DEMO'], policies: p }));
  assert.ok(replay(policies).some((r) => r.decision === 'clear'));
  const pauses = { clear: { paused: true, reviewed: 2, wrong: 2, budget: 0.03 }, link: { paused: false } };
  const paused = replay(withPauses(policies, pauses));
  assert.ok(paused.every((r) => r.decision === 'ask'));
  assert.match(paused[119].reason, /Hedge paused itself: people marked 2 of the 2 clear calls they reviewed wrong/);
});

test('mixed budgets are not named in the reason', async () => {
  const store = memory();
  const p = await checkEvidence(store, [call('wrong'), call('wrong', { budget: 0.025 })], 'clear');
  assert.equal(p.paused, true);
  assert.match(pauseReason('clear', p), /too many for its error budget\.$/);
});

test('a storage error is thrown, so the verdict can be retried', async () => {
  const store = { get: async () => undefined, set: async () => { throw new Error('down'); } };
  await assert.rejects(checkEvidence(store, [call('wrong'), call('wrong')], 'clear'), /down/);
});
