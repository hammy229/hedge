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

// Whether Hedge acts on new issues by itself (the issue trigger), or only answers the
// panel and agents. Off until an admin turns it on: a fresh install never edits tickets,
// and anything stored that is not exactly true reads as off.
const AUTO_KEY = 'auto:act';

export async function readAutoAct(store) {
  try {
    return (await store.get(AUTO_KEY)) === true;
  } catch {
    return false;
  }
}

export async function saveAutoAct(store, on) {
  if (typeof on !== 'boolean') throw new Error('Acting on new issues must be true or false.');
  await store.set(AUTO_KEY, on);
  return on;
}
