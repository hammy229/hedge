// Backend for the issue panel and the admin page (UI Kit, src/frontend/).
import ResolverModule from '@forge/resolver';
import { answerSummary, saveAnswer } from './answers.js';
import { budgetOptions } from './budget.js';
import { feedbackSummary, feedbackWith, readFeedback, saveFeedback } from './feedback.js';
import { describePolicy } from './gate.js';
import { leaveQueueAsUser, openPolicies, queueCount, requeueAsUser, runTriage, seedProgress, seedProject, store } from './index.js';
import { readLog } from './log.js';
import { checkEvidence, readPauses, recheck, resume } from './pause.js';
import policies from './policy.js';
import { ACTIONS, readActProjects, readAutoAct, readBudgets, saveActProjects, saveAutoAct, saveBudget } from './settings.js';

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
    const saved = await saveFeedback(store, { issueKey, verdict: payload?.verdict, accountId: context?.accountId });
    const requeued = await requeueAsUser(saved);
    const pause = await checkEvidence(store, await feedbackWith(store, saved), saved.decision);
    return { ...saved, paused: pause.paused && !pause.already, requeued };
  },
  answer: async ({ payload, context } = {}) => {
    const issueKey = context?.extension?.issue?.key;
    if (typeof issueKey !== 'string' || issueKey === '') throw new Error('Answers can only be given from an issue.');
    return saveAnswer(store, leaveQueueAsUser, { issueKey, answer: payload?.answer, accountId: context?.accountId });
  },
  answerSummary: ({ context } = {}) => {
    adminOnly(context, 'Answers can only be read from the admin page.');
    return answerSummary(store);
  },
  // Verdicts span every project, like the log, so only the admin page may read them.
  feedbackSummary: async ({ context } = {}) => {
    adminOnly(context, 'Verdicts can only be read from the admin page.');
    return feedbackSummary(await readFeedback(store));
  },
  pauses: async ({ context } = {}) => {
    adminOnly(context, 'Pauses can only be read from the admin page.');
    // A failed check must not hide the banner; the trigger runs it again before acting.
    await recheck(store).catch(() => {});
    return readPauses(store);
  },
  // Lifting a pause lets Hedge act again, so only the admin page may.
  resume: async ({ payload, context } = {}) => {
    adminOnly(context, 'Hedge can only be resumed from the admin page.');
    return resume(store, payload?.action);
  },
  queue: ({ context } = {}) => {
    adminOnly(context, 'The queue can only be counted from the admin page.');
    return queueCount();
  },
  settings,
  setBudget,
  autoAct: () => readAutoAct(store),
  // Turning acting on lets Hedge edit every new issue, so only the admin page may.
  setAutoAct: async ({ payload, context } = {}) => {
    adminOnly(context, 'Acting on new issues can only be switched from the admin page.');
    return saveAutoAct(store, payload?.on);
  },
  actProjects: async ({ context } = {}) => {
    adminOnly(context, 'The projects Hedge acts in can only be read from the admin page.');
    return readActProjects(store);
  },
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
  const active = await openPolicies(budgets);
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
