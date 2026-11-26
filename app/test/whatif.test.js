import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIf } from '../src/whatif.js';
import { whatIfView } from '../src/view.js';
import { entryFor, readLog, record } from '../src/log.js';
import { guardCopies } from '../src/copies.js';
import { triage } from '../src/triage.js';
import { activePolicies } from '../src/settings.js';
import installed from '../src/policy.js';

const policy = {
  budgets: [
    { alpha: 0.03, calibrated: true, threshold: 0.9 },
    { alpha: 0.02, calibrated: false, threshold: null },
    { alpha: 0.05, calibrated: true, threshold: 0.5 },
  ],
};
const entry = (issueKey, clearScore, day = 1) => ({ issueKey, clearScore, at: `2026-11-0${day}T00:00:00.000Z` });
const acts = (log) => whatIf(log, policy).rows.map((r) => r.acts);

test('each budget acts on the tickets at or above its threshold, and an uncertified one on none', () => {
  const out = whatIf([entry('P-1', 0.95), entry('P-2', 0.9), entry('P-3', 0.6), entry('P-4', null)], policy);
  assert.equal(out.tickets, 4);
  assert.deepEqual(out.rows, [{ alpha: 0.02, acts: 0 }, { alpha: 0.03, acts: 2 }, { alpha: 0.05, acts: 3 }]);
});

test('a ticket counts once, by its newest call, in any order', () => {
  const log = [entry('P-1', 0.95, 1), entry('P-1', 0.1, 2)];
  assert.deepEqual(acts(log), [0, 0, 0]);
  assert.deepEqual(acts([...log].reverse()), [0, 0, 0]);
  assert.equal(whatIf(log, policy).tickets, 1);
});

test('entries with no recorded score are left out, and bad input is empty', () => {
  assert.equal(whatIf([{ issueKey: 'P-1', at: '2026-11-01T00:00:00.000Z' }, entry('', 0.9), { ...entry('P-2', 0.9), at: 'x' }, null], policy).tickets, 0);
  assert.deepEqual(whatIf(null, null), { tickets: 0, rows: [] });
});

const t = (n) => new Date(Date.UTC(2024, 0, 1, 0, n)).toISOString().replace('Z', '+0000');
const issue = (key, summary, n) => ({ key, fields: { summary, description: 'Something about it.', created: t(n) } });
const words = ['login', 'export', 'search', 'billing', 'theme', 'upload', 'invite', 'report'];
const window = Array.from({ length: 40 }, (_, i) => issue(`P-${i + 1}`, `${words[i % 8]} ${words[(i * 3 + 1) % 8]} number ${i}`, i));
// The installed policy with its 2% row uncertified, as it was before the v2 retriever.
const no2 = {
  ...installed,
  clear: { ...installed.clear, budgets: installed.clear.budgets.map((b) => (b.alpha === 0.02 ? { ...b, calibrated: false, threshold: null } : b)) },
};
const at = (budget, w = window, ticket = issue('P-99', 'Zebra stripes appear on the kiosk', 500), policies = no2) =>
  triage({ issue: ticket, window: w, policies: activePolicies(policies, { link: 0.03, clear: budget }) });

test('the score is kept at every budget, even one that certified nothing, and agrees with the gate', () => {
  const now = at(0.03);
  assert.ok(Number.isFinite(now.clearScore));
  assert.equal(now.clearScore, now.gates.clear.score);
  assert.equal(at(0.02).gates.clear.score, undefined);
  assert.equal(at(0.02).clearScore, now.clearScore);
});

test('a ticket no budget could clear has no score: little history, a copy, or an older copy', async () => {
  assert.equal(at(0.03, window.slice(0, 5)).clearScore, null);
  assert.equal(at(0.03, window, { ...window[3], key: 'P-99', fields: { ...window[3].fields, created: t(500) } }).clearScore, null);
  const late = await guardCopies({ decision: 'clear', clearScore: 0.99, gates: {} }, async () => ({ copy: 'P-1', complete: true }));
  assert.equal(late.clearScore, null);
});

test('the log keeps the score, and a triage that failed has none', () => {
  assert.equal(entryFor({ ...at(0.03), issueKey: 'P-99' }, { via: 'panel' }).clearScore, at(0.03).clearScore);
  assert.equal('clearScore' in entryFor({ issueKey: 'P-9', decision: 'ask', failed: true }, { via: 'panel' }), false);
});

test('the admin page marks the current budget and says nothing with no tickets', () => {
  const v = whatIfView(whatIf([entry('P-1', 0.95), entry('P-2', 0.6)], policy), 0.03);
  assert.match(v.text, /the 2 tickets in the recent log/);
  assert.deepEqual(v.rows.map((r) => [r.label, r.value, r.current]), [
    ['2%', 'acts on 0 of 2', false], ['3%', 'acts on 1 of 2', true], ['5%', 'acts on 2 of 2', false],
  ]);
  assert.equal(whatIfView({ tickets: 0, rows: [] }, 0.03), null);
  assert.equal(whatIfView(undefined, 0.03), null);
  assert.match(whatIfView(whatIf([entry('P-1', 0.95)], policy), 0.03).text, /the one ticket in the recent log/);
});

test('a new score on the same call replaces the logged one, and an unfinished copy check leaves none', async () => {
  const m = new Map();
  const store = { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), list: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([, v]) => v) };
  const meta = { via: 'panel', at: new Date().toISOString() };
  const ask = { issueKey: 'P-1', decision: 'ask', reason: 'r', gates: {} };
  await record(store, ask, meta); // logged before scores were kept
  await record(store, { ...ask, clearScore: 0.8 }, meta);
  assert.equal((await readLog(store))[0].clearScore, 0.8);
  const unknown = await guardCopies({ decision: 'clear', clearScore: 0.99, gates: {} }, async () => ({ copy: null, complete: false }));
  assert.equal('clearScore' in entryFor({ ...unknown, issueKey: 'P-1' }, meta), false);
});
