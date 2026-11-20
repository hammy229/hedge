// The error budget an admin picked for each action, kept in Forge storage.
//
// Only a budget the calibration certified can be saved (budget.budgetOptions), and a
// stored value that stops matching the shipped table, say after a new policy, falls back
// to the policy's default instead of guessing a threshold.

import { atBudget, budgetOptions } from './budget.js';

export const ACTIONS = Object.freeze(['link', 'clear']);
const key = (action) => `budget:${action}`;

const offered = (policies, action) => budgetOptions(policies?.[action]).map((o) => o.alpha);

export async function readBudgets(store, policies) {
  const out = {};
  for (const action of ACTIONS) {
    let saved;
    try {
      saved = await store.get(key(action));
    } catch {
      saved = undefined;
    }
    out[action] = offered(policies, action).includes(saved) ? saved : policies?.[action]?.alpha;
  }
  return out;
}

export async function saveBudget(store, policies, action, alpha) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action ${action}.`);
  if (!offered(policies, action).includes(alpha)) {
    throw new Error(`A ${alpha} budget was not certified for ${action}.`);
  }
  await store.set(key(action), alpha);
  return alpha;
}

export function activePolicies(policies, budgets) {
  return Object.fromEntries(ACTIONS.map((a) => [a, atBudget(policies?.[a], budgets?.[a])]));
}
