import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_SIZE, entryFor, readLog, record } from '../src/log.js';

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), list: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([, v]) => v), m };
};

const result = {
  issueKey: 'PROJ-7',
  summary: 'Crash on save',
  decision: 'clear',
  reason: 'Confidence 0.981 is at or above the calibrated threshold 0.964.',
  searched: 412,
  candidates: [{ key: 'PROJ-2', score: 3.1 }],
  gates: { link: { decision: 'ask', score: 0.01 }, clear: { decision: 'act', score: 0.981, threshold: 0.964 } },
};

test('an entry keeps what an auditor needs and nothing else', () => {
  const e = entryFor(result, { budgets: { link: 0.03, clear: 0.03 }, via: 'panel', at: '2026-11-19T12:00:00.000Z' });
  assert.deepEqual(e, {
    at: '2026-11-19T12:00:00.000Z',
    issueKey: 'PROJ-7',
    decision: 'clear',
    reason: result.reason,
    score: 0.981,
    threshold: 0.964,
    budget: 0.03,
    via: 'panel',
    applied: null,
  });
  assert.equal('summary' in e, false); // ticket text stays in Jira
});

test('a trigger entry says whether the decision was carried out', () => {
  const at = '2026-11-21T12:00:00.000Z';
  const done = entryFor({ ...result, applied: { applied: true, label: 'hedge-cleared' } }, { via: 'trigger', at });
  assert.equal(done.applied, true);
  const failed = entryFor({ ...result, applied: { applied: false, error: 'Jira returned 403' } }, { via: 'trigger', at });
  assert.equal(failed.applied, false);
  assert.equal(entryFor({ ...result, applied: 'yes' }, { via: 'trigger', at }).applied, null);
});

test('ask decisions log the highest gate score and no threshold', () => {
  const e = entryFor({ ...result, decision: 'ask' }, { budgets: { clear: 0.03 }, via: 'mcp', at: 'x' });
  assert.equal(e.decision, 'ask');
  assert.equal(e.score, 0.981);
  assert.equal(e.threshold, null);
  assert.equal(e.budget, null);
});

const T = Date.parse('2026-11-23T00:00:00Z');

test('records newest first and keeps only the latest entries', async () => {
  const store = memory();
  for (let i = 0; i < LOG_SIZE + 5; i++) {
    await record(store, { ...result, issueKey: `PROJ-${i}` }, { budgets: {}, via: 'panel', at: new Date(T + i * 1000).toISOString() });
  }
  const log = await readLog(store, T);
  assert.equal(log.length, LOG_SIZE);
  assert.equal(log[0].issueKey, `PROJ-${LOG_SIZE + 4}`);
});

test('a broken store never breaks triage', async () => {
  const broken = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } };
  await record(broken, result, { budgets: {}, via: 'panel' });
  assert.deepEqual(await readLog(broken), []);
});

test('malformed stored entries are left out', async () => {
  const store = memory();
  for (const [i, bad] of [null, 'x', 7, { at: 'never' }].entries()) store.m.set(`entry:${i}`, bad);
  assert.deepEqual(await readLog({ list: async () => ({ not: 'a list' }) }), []);
  assert.deepEqual(await readLog(store), []);
});

test('reopening a ticket with the same outcome does not add a second entry', async () => {
  const store = memory();
  const meta = { budgets: { clear: 0.03 }, via: 'panel' };
  await record(store, result, { ...meta, at: '2026-11-23T00:00:01.000Z' });
  await record(store, result, { ...meta, at: '2026-11-23T00:00:02.000Z' });
  assert.equal((await readLog(store, T)).length, 1);
  // A new outcome, a new budget or a different caller is a new entry.
  await record(store, { ...result, decision: 'ask' }, { ...meta, at: '2026-11-23T00:00:03.000Z' });
  await record(store, result, { budgets: { clear: 0.025 }, via: 'panel', at: '2026-11-23T00:00:04.000Z' });
  await record(store, result, { ...meta, via: 'mcp', at: '2026-11-23T00:00:05.000Z' });
  assert.equal((await readLog(store, T)).length, 4);
});

test('a call the trigger could not carry out keeps the cause, so the admin sees the fix', () => {
  const e = entryFor({ issueKey: 'DEMO-9', decision: 'clear', gates: {}, applied: { applied: false, error: 'No Labels field.' } }, { via: 'trigger' });
  assert.equal(e.applied, false);
  assert.equal(e.appliedError, 'No Labels field.');
  const ok = entryFor({ issueKey: 'DEMO-9', decision: 'clear', gates: {}, applied: { applied: true } }, { via: 'trigger' });
  assert.equal(ok.appliedError, undefined);
});

test('two triages finishing at the same moment both stay in the log', async () => {
  const store = memory();
  await Promise.all([1, 2, 3].map((i) => record(store, { ...result, issueKey: `PROJ-${i}` }, { via: 'trigger', at: new Date(T).toISOString() })));
  assert.equal((await readLog(store, T)).length, 3);
});

test('entries and decisions are stored with an expiry, and an expired entry is not shown', async () => {
  const store = memory();
  const ttls = {};
  const set = store.set;
  store.set = async (k, v, o) => { ttls[k.split(':')[0]] = o?.ttl; return set(k, v); };
  await record(store, result, { via: 'trigger', at: new Date(T).toISOString() });
  assert.deepEqual(ttls, { decision: { value: 180, unit: 'DAYS' }, entry: { value: 30, unit: 'DAYS' } });
  assert.equal((await readLog(store, T + 29 * 86400000)).length, 1);
  assert.equal((await readLog(store, T + 31 * 86400000)).length, 0);
});
