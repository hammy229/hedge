// The sample data a judge seeds, replayed through the app's own triage in creation order.
// The numbers here are the ones docs/TESTING.md tells a judge to expect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import seed from '../src/seed.js';
import policies from '../src/policy.js';
import { activePolicies } from '../src/settings.js';
import { triage } from '../src/triage.js';

const T0 = Date.parse('2026-12-01T00:00:00Z');
// Seeded issues are created a few seconds apart, in order.
const issues = seed.issues.map((s, i) => ({
  key: `DEMO-${i + 1}`,
  fields: { summary: s.summary, description: s.description, created: new Date(T0 + i * 2000).toISOString().replace('Z', '+0000') },
}));

function replay(clear) {
  const active = activePolicies(policies, { link: policies.link.alpha, clear });
  const counts = { link: 0, clear: 0, ask: 0 };
  const wrongClears = [];
  const asked = [];
  issues.forEach((issue, i) => {
    const out = triage({ issue, window: issues.slice(0, i), projectKeys: ['DEMO'], policies: active });
    counts[out.decision] += 1;
    if (seed.issues[i].duplicateOf.length > 0) (out.decision === 'clear' ? wrongClears : asked).push(issue.key);
  });
  return { counts, wrongClears, asked };
}

test('the seed is 150 attributed issues with five in-span duplicates', () => {
  assert.equal(issues.length, 150);
  assert.match(seed.attribution, /CC BY 4\.0/);
  assert.equal(seed.issues.filter((s) => s.duplicateOf.length > 0).length, 5);
  for (const s of seed.issues) {
    assert.ok(s.summary.length > 0 && s.summary.length <= 255, s.source);
    assert.ok(s.duplicateOf.every((j) => Number.isInteger(j) && j >= 0 && j < seed.issues.indexOf(s)), s.source);
  }
});

test('at the default 3% budget Hedge clears 119 and misses 3 of the 5 duplicates', () => {
  const r = replay(0.03);
  assert.deepEqual(r.counts, { link: 0, clear: 119, ask: 31 });
  assert.deepEqual(r.wrongClears, ['DEMO-37', 'DEMO-50', 'DEMO-51']);
  assert.deepEqual(r.asked, ['DEMO-15', 'DEMO-29']);
});

test('tightening the dial to 2.5% sends five more tickets to a person but no extra duplicate', () => {
  const r = replay(0.025);
  assert.deepEqual(r.counts, { link: 0, clear: 114, ask: 36 });
  assert.deepEqual(r.wrongClears, ['DEMO-37', 'DEMO-50', 'DEMO-51']);
});

test('at 2% nothing was certified, so every sample ticket is asked about', () => {
  assert.deepEqual(replay(0.02).counts, { link: 0, clear: 0, ask: 150 });
});

test('the first 30 seeded issues are always asked about', () => {
  const active = activePolicies(policies, { link: policies.link.alpha, clear: 0.035 });
  for (let i = 0; i < 30; i += 1) {
    assert.equal(triage({ issue: issues[i], window: issues.slice(0, i), projectKeys: ['DEMO'], policies: active }).decision, 'ask');
  }
});
