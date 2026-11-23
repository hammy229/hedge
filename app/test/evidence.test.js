import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALSE_ALARM, evidence } from '../src/evidence.js';

const run = (n, wrong, budget = 0.03) => Array.from({ length: n }, (_, i) => ({ wrong: i < wrong, budget }));

// mulberry32, so the simulation gives the same counts on every machine.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Share of simulated sites whose evidence crossed the limit at any of `steps` checks.
function crossed(rate, budgetAt, { sites = 1000, steps = 200, seed = 7 } = {}) {
  const random = rng(seed);
  let hits = 0;
  for (let s = 0; s < sites; s += 1) {
    const seen = [];
    for (let i = 0; i < steps; i += 1) {
      const budget = budgetAt(i);
      seen.push({ wrong: random() < rate(budget), budget });
      if (evidence(seen).over) {
        hits += 1;
        break;
      }
    }
  }
  return hits / sites;
}

test('no verdicts is no evidence', () => {
  for (const none of [[], null, undefined, [null, { wrong: 'yes', budget: 0.03 }, { wrong: true }]]) {
    const e = evidence(none);
    assert.ok(Math.abs(e.log) < 1e-12);
    assert.deepEqual([e.reviewed, e.wrong, e.over], [0, 0, false]);
  }
});

test('one wrong call never crosses a 3% budget, two in a row do', () => {
  assert.equal(evidence(run(1, 1)).over, false);
  assert.equal(evidence(run(2, 2)).over, true);
  assert.equal(evidence(run(100, 3)).over, false);
  assert.equal(evidence(run(100, 15)).over, true);
});

test('verdict order does not matter and right calls lower the evidence', () => {
  const v = run(20, 2);
  assert.ok(Math.abs(evidence(v).log - evidence([...v].reverse()).log) < 1e-9);
  assert.ok(evidence(run(40, 2)).log < evidence(run(20, 2)).log);
});

test('a very long run of wrong calls stays finite', () => {
  assert.ok(Number.isFinite(evidence(run(5000, 5000)).log));
});

test('checked after every verdict, a site exactly at its budget alarms at most 5% of the time', () => {
  const share = crossed((b) => b, () => 0.03);
  assert.ok(share > 0 && share <= FALSE_ALARM, `${share}`);
});

test('the bound holds when the admin moves the dial between calls', () => {
  const share = crossed((b) => b, (i) => [0.025, 0.03, 0.035, 0.05][i % 4]);
  assert.ok(share > 0 && share <= FALSE_ALARM, `${share}`);
});

test('a site at five times its budget is caught', () => {
  const share = crossed(() => 0.15, () => 0.03);
  assert.ok(share >= 0.95, `${share}`);
});

test('a site at twice its budget is caught less than half the time, as ADR 9 says', () => {
  const share = crossed(() => 0.06, () => 0.03);
  assert.ok(Math.abs(share - 0.417) < 0.01, `${share}`);
});
