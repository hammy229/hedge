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

// Which projects the trigger acts in. An empty list means every project, which is what a
// site had before the list existed. Keys are typed by an admin as "DEMO, OPS", so the
// saved form is upper case, deduplicated, in the order typed.
const PROJECTS_KEY = 'auto:projects';
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
const MAX_PROJECTS = 50;

export async function readActProjects(store) {
  let saved;
  try {
    saved = await store.get(PROJECTS_KEY);
  } catch {
    saved = undefined;
  }
  return Array.isArray(saved) ? saved.filter((k) => typeof k === 'string' && PROJECT_KEY.test(k)) : [];
}

export async function saveActProjects(store, text) {
  if (typeof text !== 'string') throw new Error('Project keys must be text, like DEMO, OPS.');
  const keys = [...new Set(text.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean))];
  const bad = keys.find((k) => !PROJECT_KEY.test(k));
  if (bad !== undefined) throw new Error(`${bad} is not a project key. Use keys like DEMO, OPS.`);
  if (keys.length > MAX_PROJECTS) throw new Error(`List at most ${MAX_PROJECTS} project keys.`);
  await store.set(PROJECTS_KEY, keys);
  return keys;
}

export function actsIn(projects, projectKey) {
  if (!Array.isArray(projects) || projects.length === 0) return true;
  return typeof projectKey === 'string' && projects.includes(projectKey);
}
