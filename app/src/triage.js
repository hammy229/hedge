// One triage decision: score the ticket against its window, then ask both gates.
//
// Two actions, each with its own certified policy (ml/hedge/calibrate.py ACTIONS):
//   link   link the ticket as a duplicate of the top candidate
//   clear  mark it as a new report, so nobody checks it for duplicates
// When neither gate lets the agent act, or both do (contradictory evidence), a person
// decides. Text goes through the same stripping and cut as calibration, so the features
// are the ones the threshold was certified on.

import { K, topK, windowScores } from './bm25.js';
import { contextFeatures, featurize, scoreFeatures } from './features.js';
import { RUNTIME, decide, policyProblem } from './gate.js';
import { copyKey, retrievalParts, retrievalText } from './text.js';

const SHOWN = 3;

export function triage({ issue, window, projectKeys = [], policies, runtime = RUNTIME }) {
  const q = retrievalParts(issue?.fields?.summary, issue?.fields?.description, projectKeys);
  const texts = window.map((w) => retrievalText(w?.fields?.summary, w?.fields?.description, projectKeys));
  const scores = windowScores(texts, `${q.summary}\n${q.description}`);
  const top = topK(scores, K);
  const best = top.length > 0 ? window[top[0]] : null;
  const features = {
    ...scoreFeatures(top.map((i) => scores[i]), K),
    ...featurize({ fields: { summary: q.summary, description: q.description } }),
    ...contextFeatures({
      window: window.length,
      summary: q.summary,
      topSummary: best ? retrievalParts(best.fields?.summary, '', projectKeys).summary : null,
      ageSeconds: best ? jiraSeconds(issue?.fields?.created) - jiraSeconds(best.fields?.created) : null,
    }),
  };
  const candidates = top.slice(0, SHOWN).map((i) => ({ key: window[i].key, score: scores[i] }));
  const copy = copyOf(texts, `${q.summary}\n${q.description}`, projectKeys);
  // Every feature must be a finite number, not only the ones a policy weighs: a policy
  // that happens to give a feature no weight must not let a broken input through.
  const broken = Object.keys(features).filter((name) => !Number.isFinite(features[name]));
  const refuse = (reason) => ({ decision: 'ask', reason });
  const guard = (action) => {
    if (broken.length > 0) return refuse(`Missing features: ${broken.join(', ')}.`);
    if (copy !== -1) {
      return refuse(
        `This ticket repeats the text of ${window[copy].key}. Copies were left out of calibration, so ${action === 'link' ? 'linking' : 'clearing'} it is not covered.`,
      );
    }
    const policy = checked(policies?.[action], action);
    // Below the minimum window the gate extrapolates past what calibration covered, so the
    // policy certified asking there (ADR 8). A broken policy is reported by decide() instead.
    if (!policyProblem(policy, runtime) && window.length < policy.minWindow) {
      return refuse(
        `This project has ${window.length} earlier issue${window.length === 1 ? '' : 's'}. Hedge needs at least ${policy.minWindow} to compare against before it acts.`,
      );
    }
    return decide(features, policy, runtime);
  };
  const link = guard('link');
  const clear = guard('clear');
  const facts = { searched: window.length, candidates, gates: { link, clear } };
  if (copy !== -1) facts.copyOf = window[copy].key;

  if (link.decision === 'act' && clear.decision === 'act') {
    return { decision: 'ask', reason: 'Both gates would act, which contradicts itself, so a person decides.', ...facts };
  }
  if (link.decision === 'act' && candidates.length > 0) {
    return { decision: 'link', duplicateOf: candidates[0].key, reason: link.reason, ...facts };
  }
  if (clear.decision === 'act') {
    return { decision: 'clear', reason: clear.reason, ...facts };
  }
  return { decision: 'ask', reason: `Link: ${link.reason} Clear: ${clear.reason}`, ...facts };
}

// Jira timestamps, e.g. 2024-01-01T00:00:00.000+0000, in seconds. Anything else is NaN:
// Date.parse alone would read 5 or '2024' as a date.
const JIRA_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)$/;
function jiraSeconds(created) {
  return typeof created === 'string' && JIRA_TIME.test(created) ? Date.parse(created) / 1000 : NaN;
}

// Index of the first window issue whose text the ticket copies, or -1.
function copyOf(texts, queryText, projectKeys) {
  const q = copyKey(queryText, projectKeys);
  return q ? texts.findIndex((t) => copyKey(t, projectKeys) === q) : -1;
}

// A policy certified for one action must never gate the other.
function checked(policy, action) {
  if (policy?.calibrated === true && policy.action !== action) {
    return { calibrated: false, closedBecause: 'The installed policy was certified for another action.' };
  }
  return policy;
}
