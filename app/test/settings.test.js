import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activePolicies, actsIn, readActProjects, readAutoAct, readBudgets, saveActProjects, saveAutoAct, saveBudget } from '../src/settings.js';
import policies from '../src/policy.js';

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m };
};

test('with nothing saved, each action runs at its certified default', async () => {
  const budgets = await readBudgets(memory(), policies);
  assert.deepEqual(budgets, { link: policies.link.alpha, clear: policies.clear.alpha });
});

test('a saved certified budget is read back and applied', async () => {
  const store = memory();
  const alpha = policies.clear.budgets.find((b) => b.calibrated && b.alpha !== policies.clear.alpha).alpha;
  await saveBudget(store, policies, 'clear', alpha);
  const active = activePolicies(policies, await readBudgets(store, policies));
  assert.equal(active.clear.alpha, alpha);
  assert.equal(active.clear.threshold, policies.clear.budgets.find((b) => b.alpha === alpha).threshold);
  assert.deepEqual(active.link, policies.link);
});

test('saving a budget outside the table is refused and stores nothing', async () => {
  const store = memory();
  for (const [action, alpha] of [['clear', 0.04], ['clear', '0.03'], ['route', 0.03], ['clear', NaN]]) {
    await assert.rejects(saveBudget(store, policies, action, alpha), /budget|action/);
  }
  assert.equal(store.m.size, 0);
});

test('a stored value that no longer matches the table falls back to the default', async () => {
  const store = memory();
  store.m.set('budget:clear', 0.0421);
  store.m.set('budget:link', 'junk');
  const budgets = await readBudgets(store, policies);
  assert.deepEqual(budgets, { link: policies.link.alpha, clear: policies.clear.alpha });
});

test('a storage failure falls back to the defaults instead of throwing', async () => {
  const broken = { get: async () => { throw new Error('kvs down'); } };
  const budgets = await readBudgets(broken, policies);
  assert.equal(budgets.clear, policies.clear.alpha);
});

test('acting on new issues is off until an admin turns it on', async () => {
  const store = memory();
  assert.equal(await readAutoAct(store), false);
  assert.equal(await saveAutoAct(store, true), true);
  assert.equal(await readAutoAct(store), true);
  assert.equal(await saveAutoAct(store, false), false);
  assert.equal(await readAutoAct(store), false);
});

test('only a real boolean turns acting on, and broken storage reads as off', async () => {
  const store = memory();
  for (const value of ['true', 1, null, undefined, {}]) {
    await assert.rejects(saveAutoAct(store, value), /true or false/);
  }
  store.m.set('auto:act', 'yes');
  assert.equal(await readAutoAct(store), false);
  const broken = { get: async () => { throw new Error('down'); }, set: async () => {} };
  assert.equal(await readAutoAct(broken), false);
});

test('with no projects saved, acting covers every project', async () => {
  const store = memory();
  assert.deepEqual(await readActProjects(store), []);
  assert.equal(actsIn([], 'DEMO'), true);
});

test('saved project keys are cleaned, deduplicated and limit acting to those projects', async () => {
  const store = memory();
  const saved = await saveActProjects(store, ' demo, Ops ,DEMO,,');
  assert.deepEqual(saved, ['DEMO', 'OPS']);
  assert.deepEqual(await readActProjects(store), ['DEMO', 'OPS']);
  assert.equal(actsIn(saved, 'OPS'), true);
  assert.equal(actsIn(saved, 'WEB'), false);
  assert.equal(actsIn(saved, undefined), false);
});

test('a malformed project key is refused and stores nothing', async () => {
  const store = memory();
  for (const bad of ['DEMO, 9X', 'de mo', 'A', 42, null]) {
    await assert.rejects(saveActProjects(store, bad), /project key/i);
  }
  assert.equal(store.m.size, 0);
});

test('a project list that cannot be read or makes no sense stops acting, not widens it', async () => {
  const store = memory();
  store.m.set('auto:projects', 'DEMO');
  assert.equal(await readActProjects(store), null);
  store.m.set('auto:projects', [7, 'not a key']);
  assert.equal(await readActProjects(store), null);
  store.m.set('auto:projects', ['DEMO', 7]);
  assert.deepEqual(await readActProjects(store), ['DEMO']);
  const broken = { get: async () => { throw new Error('storage down'); } };
  assert.equal(await readActProjects(broken), null);
  assert.equal(actsIn(null, 'DEMO'), false);
});
