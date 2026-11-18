// One triage decision: score the ticket against its window, then ask both gates.
//
// Two actions, each with its own certified policy (ml/hedge/calibrate.py ACTIONS):
//   link   link the ticket as a duplicate of the top candidate
//   clear  mark it as a new report, so nobody checks it for duplicates
// When neither gate lets the agent act, or both do (contradictory evidence), a person
// decides. Text goes through the same stripping and cut as calibration, so the features
// are the ones the threshold was certified on.

import { K, topK, windowScores } from './bm25.js';
import { featurize, scoreFeatures } from './features.js';
import { RUNTIME, decide } from './gate.js';
import { copyKey, retrievalParts, retrievalText } from './text.js';

const SHOWN = 3;

export function triage({ issue, window, projectKeys = [], policies, runtime = RUNTIME }) {
  const q = retrievalParts(issue?.fields?.summary, issue?.fields?.description, projectKeys);
  const texts = window.map((w) => retrievalText(w?.fields?.summary, w?.fields?.description, projectKeys));
  const scores = windowScores(texts, `${q.summary}\n${q.description}`);
  const top = topK(scores, K);
  const features = {
    ...scoreFeatures(top.map((i) => scores[i]), K),
    ...featurize({ fields: { summary: q.summary, description: q.description } }),
  };
  const candidates = top.slice(0, SHOWN).map((i) => ({ key: window[i].key, score: scores[i] }));
  const copy = copyOf(texts, `${q.summary}\n${q.description}`, projectKeys);
  const link = decide(features, checked(policies?.link, 'link'), runtime);
  const clear =
    copy === -1
      ? decide(features, checked(policies?.clear, 'clear'), runtime)
      : {
          decision: 'ask',
          reason: `This ticket repeats the text of ${window[copy].key}. Copies were left out of calibration, so clearing it is not covered.`,
        };
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

// Index of the first window issue whose text the ticket copies, or -1.
function copyOf(texts, queryText, projectKeys) {
  const q = copyKey(queryText, projectKeys);
  return q ? texts.findIndex((t) => copyKey(t, projectKeys) === q) : -1;
}

// A policy certified for one action must never gate the other.
function checked(policy, action) {
  if (policy?.calibrated === true && policy.action !== action) {
    return { calibrated: false };
  }
  return policy;
}
