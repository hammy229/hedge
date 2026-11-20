import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atBudget, budgetOptions } from '../src/budget.js';
import { decide } from '../src/gate.js';
import { RETRIEVER } from '../src/features.js';
import policies from '../src/policy.js';

const row = (alpha, threshold, coverage) => ({
  alpha,
  calibrated: threshold !== null,
  threshold,
  calibrationCoverage: coverage,
  calibrationActed: Math.round(coverage * 1000),
  calibrationErrors: Math.round(coverage * 1000 * alpha * 0.5),
});

const policy = {
  action: 'clear',
  calibrated: true,
  featureSchema: 2,
  retriever: RETRIEVER,
  alpha: 0.03,
  delta: 0.1,
  calibrationSize: 1000,
  threshold: 0.9,
  calibrationCoverage: 0.5,
  model: { bias: -1, weights: { margin: 4 } },
  budgets: [row(0.01, null, 0), row(0.03, 0.9, 0.5), row(0.05, 0.6, 0.8)],
};

test('the default budget returns the policy as certified', () => {
  assert.deepEqual(atBudget(policy, 0.03), policy);
  assert.deepEqual(atBudget(policy, undefined), policy);
});

test('another budget swaps in its own threshold and facts', () => {
  const p = atBudget(policy, 0.05);
  assert.equal(p.threshold, 0.6);
  assert.equal(p.alpha, 0.05);
  assert.equal(p.calibrationCoverage, 0.8);
  assert.equal(p.model, policy.model);
  // sigmoid(-1 + 4 * 0.3) = 0.55: asks at 3%, still asks at 5%; 0.5 margin acts only at 5%
  assert.equal(decide({ margin: 0.5 }, atBudget(policy, 0.03)).decision, 'ask');
  assert.equal(decide({ margin: 0.5 }, atBudget(policy, 0.05)).decision, 'act');
});

test('an uncertified budget closes the gate', () => {
  const p = atBudget(policy, 0.01);
  assert.equal(p.calibrated, false);
  assert.equal(decide({ margin: 9 }, p).decision, 'ask');
});

test('a budget that is not in the table closes the gate instead of guessing', () => {
  for (const alpha of [0.04, '0.05', NaN, null, 0.050000001]) {
    assert.equal(atBudget(policy, alpha).calibrated, false, String(alpha));
  }
});

test('a malformed table row closes the gate', () => {
  for (const bad of [{ threshold: '0.6' }, { threshold: 1.5 }, { threshold: 0 }, { calibrated: 'yes' }]) {
    const broken = { ...policy, budgets: [policy.budgets[1], { ...policy.budgets[2], ...bad }] };
    assert.equal(decide({ margin: 9 }, atBudget(broken, 0.05)).decision, 'ask', JSON.stringify(bad));
  }
});

test('a policy without a table only offers its default budget', () => {
  const { budgets, ...plain } = policy;
  assert.equal(budgets.length, 3);
  assert.deepEqual(atBudget(plain, 0.03), plain);
  assert.equal(atBudget(plain, 0.05).calibrated, false);
  assert.deepEqual(budgetOptions(plain).map((o) => o.alpha), [0.03]);
});

test('options list every row, marking the ones that never act', () => {
  const opts = budgetOptions(policy);
  assert.deepEqual(opts.map((o) => [o.alpha, o.certified]), [[0.01, false], [0.03, true], [0.05, true]]);
  assert.equal(opts[1].isDefault, true);
  assert.match(opts[1].label, /3%/);
  assert.match(opts[1].label, /50\.0% of tickets/);
});

test('the shipped clear policy offers its budgets in order', () => {
  const alphas = budgetOptions(policies.clear).map((o) => o.alpha);
  assert.ok(alphas.includes(policies.clear.alpha));
  assert.deepEqual(alphas, [...alphas].sort((a, b) => a - b));
});
