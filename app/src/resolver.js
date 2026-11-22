// Backend for the issue panel and the admin page (UI Kit, src/frontend/).
import ResolverModule from '@forge/resolver';
import { budgetOptions } from './budget.js';
import { feedbackSummary, readFeedback, saveFeedback } from './feedback.js';
import { describePolicy } from './gate.js';
import { runTriage, seedProgress, seedProject, store } from './index.js';
import { readLog } from './log.js';
import policies from './policy.js';
import { ACTIONS, activePolicies, readActProjects, readAutoAct, readBudgets, saveActProjects, saveAutoAct, saveBudget } from './settings.js';

export const ADMIN_MODULE = 'hedge-admin';

// @forge/resolver is CommonJS: Node's ESM loader wraps it, the Forge bundler does not.
const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();

export const handlers = {
  // The panel triages the issue it is shown on, as the viewing user.
  triage: ({ context }) => runTriage(context?.extension?.issue?.key, 'panel'),
  // A verdict on the call shown in the panel. The issue comes from Jira's context, not the
  // payload, so a viewer can only review the ticket they are looking at.
  feedback: async ({ payload, context } = {}) => {
    const issueKey = context?.extension?.issue?.key;
    if (typeof issueKey !== 'string' || issueKey === '') throw new Error('Verdicts can only be given from an issue.');
    return saveFeedback(store, { issueKey, verdict: payload?.verdict, accountId: context?.accountId });
  },
  // Verdicts span every project, like the log, so only the admin page may read them.
  feedbackSummary: async ({ context } = {}) => {
    adminOnly(context, 'Verdicts can only be read from the admin page.');
    return feedbackSummary(await readFeedback(store));
  },
  settings,
  setBudget,
  autoAct: () => readAutoAct(store),
  // Turning acting on lets Hedge edit every new issue, so only the admin page may.
  setAutoAct: async ({ payload, context } = {}) => {
    adminOnly(context, 'Acting on new issues can only be switched from the admin page.');
    return saveAutoAct(store, payload?.on);
  },
  actProjects: () => readActProjects(store),
  // The list decides where Hedge edits issues, so only the admin page may change it.
  setActProjects: async ({ payload, context } = {}) => {
    adminOnly(context, 'The projects Hedge acts in can only be changed from the admin page.');
    return saveActProjects(store, payload?.text);
  },
  // The log names tickets from every project, so only the admin page may read it.
  log: ({ context } = {}) => {
    adminOnly(context, 'The decision log can only be read from the admin page.');
    return readLog(store);
  },
  // Sample data writes issues, so only the admin page may start it.
  seed: ({ payload, context } = {}) => {
    adminOnly(context, 'Sample data can only be added from the admin page.');
    return seedProject(payload?.projectKey);
  },
  seedStatus: ({ payload, context } = {}) => {
    adminOnly(context, 'Sample data can only be added from the admin page.');
    return seedProgress(payload?.projectKey);
  },
};

function adminOnly(context, message) {
  if (context?.moduleKey !== ADMIN_MODULE) throw new Error(message);
}

for (const [name, fn] of Object.entries(handlers)) resolver.define(name, fn);

async function settings() {
  const budgets = await readBudgets(store, policies);
  const active = activePolicies(policies, budgets);
  return Object.fromEntries(
    ACTIONS.map((a) => [
      a,
      { budget: budgets[a], options: budgetOptions(policies[a]), guarantee: describePolicy(active[a]).guarantee, minWindow: policies[a]?.minWindow },
    ]),
  );
}

// Only the admin page, which Jira shows to site admins alone, may move the dial.
async function setBudget({ payload, context }) {
  adminOnly(context, 'The budget can only be changed from the admin page.');
  await saveBudget(store, policies, payload?.action, payload?.alpha);
  return readBudgets(store, policies);
}

export const handler = resolver.getDefinitions();
