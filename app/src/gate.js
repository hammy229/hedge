// The act-or-ask gate that runs inside Forge.
//
// The threshold and weights come from ml/ (see docs/PLAN.md). The gate fails closed:
// with no calibrated policy, a policy trained on other features or another retriever, or
// any missing feature, the ticket goes to a person.

import { FEATURE_SCHEMA, RETRIEVER } from './features.js';

export const RUNTIME = Object.freeze({ featureSchema: FEATURE_SCHEMA, retriever: RETRIEVER });

export function score(features, model) {
  let z = model.bias;
  for (const [name, weight] of Object.entries(model.weights)) {
    z += weight * (Object.hasOwn(features, name) ? features[name] : NaN);
  }
  return 1 / (1 + Math.exp(-z));
}

const isNumber = (x) => typeof x === 'number' && Number.isFinite(x);

// Why a policy cannot be trusted, or null if it can. Every check here guards a way a
// malformed policy file would otherwise act: a null threshold compares as 0, an empty
// weight map needs no features, a string bias concatenates.
export function policyProblem(policy, runtime = RUNTIME) {
  if (policy?.calibrated !== true) return 'No calibrated policy is installed yet, so every ticket goes to a person.';
  if (policy.featureSchema !== runtime.featureSchema) {
    return (
      `The policy was trained on feature schema ${policy.featureSchema}, but this app computes ` +
      `schema ${runtime.featureSchema}.`
    );
  }
  if (policy.retriever !== runtime.retriever) {
    return (
      `The policy was calibrated on scores from ${policy.retriever}, but this app retrieves ` +
      `with ${runtime.retriever}.`
    );
  }
  if (!isNumber(policy.threshold) || policy.threshold <= 0 || policy.threshold > 1) {
    return 'The policy threshold is not a probability in (0, 1].';
  }
  if (!Number.isInteger(policy.minWindow) || policy.minWindow < 0) {
    return 'The policy has no valid minimum window.';
  }
  const model = policy.model;
  const weights = model?.weights;
  if (!isNumber(model?.bias) || !weights || typeof weights !== 'object' || Array.isArray(weights)) {
    return 'The policy model is malformed.';
  }
  const names = Object.keys(weights);
  if (names.length === 0 || !names.every((n) => isNumber(weights[n]))) {
    return 'The policy model has no usable weights.';
  }
  return null;
}

function ask(reason, extra = {}) {
  return { decision: 'ask', reason, ...extra };
}

export function decide(features, policy, runtime = RUNTIME) {
  try {
    return decideOrThrow(features, policy, runtime);
  } catch {
    return ask('The gate hit an unexpected error, so this ticket goes to a person.');
  }
}

function decideOrThrow(features, policy, runtime) {
  const problem = policyProblem(policy, runtime);
  if (problem) return ask(problem);
  const names = Object.keys(policy.model.weights);
  const f = features && typeof features === 'object' ? features : {};
  const missing = names.filter((name) => !(Object.hasOwn(f, name) && isNumber(f[name])));
  if (missing.length > 0) {
    return ask(`Missing features: ${missing.join(', ')}.`);
  }
  const s = score(f, policy.model);
  if (!isNumber(s)) return ask('The confidence score is not a finite number.');
  const facts = { score: s, threshold: policy.threshold };
  if (s >= policy.threshold) {
    return {
      decision: 'act',
      reason: `Confidence ${s.toFixed(3)} is at or above the calibrated threshold ${policy.threshold.toFixed(3)}.`,
      ...facts,
    };
  }
  return ask(
    `Confidence ${s.toFixed(3)} is below the calibrated threshold ${policy.threshold.toFixed(3)}.`,
    facts,
  );
}

export function describePolicy(policy) {
  if (!policy?.calibrated) {
    return { calibrated: false, guarantee: 'None yet. Hedge asks a person about every ticket.' };
  }
  const { alpha, delta, calibrationSize, minWindow } = policy;
  const history = Number.isInteger(minWindow) && minWindow > 0
    ? ` It asks about every ticket whose project has fewer than ${minWindow} earlier issues.`
    : '';
  return {
    calibrated: true,
    alpha,
    delta,
    calibrationSize,
    minWindow,
    guarantee:
      `Among tickets Hedge acts on, at most ${(alpha * 100).toFixed(1)}% are wrong, ` +
      `with probability ${((1 - delta) * 100).toFixed(0)}% over a calibration set of ` +
      `${calibrationSize} tickets, assuming new tickets look like the calibration set.${history}`,
  };
}
