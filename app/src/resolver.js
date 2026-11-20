// Backend for the issue panel and the admin page (UI Kit, src/frontend/).
import ResolverModule from '@forge/resolver';
import { budgetOptions } from './budget.js';
import { describePolicy } from './gate.js';
import { runTriage, store } from './index.js';
import { readLog } from './log.js';
import policies from './policy.js';
import { ACTIONS, activePolicies, readBudgets, saveBudget } from './settings.js';

export const ADMIN_MODULE = 'hedge-admin';

// @forge/resolver is CommonJS: Node's ESM loader wraps it, the Forge bundler does not.
const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();

export const handlers = {
  // The panel triages the issue it is shown on, as the viewing user.
  triage: ({ context }) => runTriage(context?.extension?.issue?.key, 'panel'),
  settings,
  setBudget,
  log: () => readLog(store),
};

for (const [name, fn] of Object.entries(handlers)) resolver.define(name, fn);

async function settings() {
  const budgets = await readBudgets(store, policies);
  const active = activePolicies(policies, budgets);
  return Object.fromEntries(
    ACTIONS.map((a) => [a, { budget: budgets[a], options: budgetOptions(policies[a]), guarantee: describePolicy(active[a]).guarantee }]),
  );
}

// Only the admin page, which Jira shows to site admins alone, may move the dial.
async function setBudget({ payload, context }) {
  if (context?.moduleKey !== ADMIN_MODULE) throw new Error('The budget can only be changed from the admin page.');
  await saveBudget(store, policies, payload?.action, payload?.alpha);
  return readBudgets(store, policies);
}

export const handler = resolver.getDefinitions();
