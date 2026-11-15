// The act-or-ask gate that runs inside Forge.
//
// The threshold and weights come from ml/ (see docs/PLAN.md). The gate fails closed:
// with no calibrated policy, or any missing feature, the ticket goes to a person.

export function score(features, model) {
  let z = model.bias;
  for (const [name, weight] of Object.entries(model.weights)) {
    z += weight * features[name];
  }
  return 1 / (1 + Math.exp(-z));
}

function ask(reason, extra = {}) {
  return { decision: 'ask', reason, ...extra };
}

export function decide(features, policy) {
  if (!policy?.calibrated) {
    return ask('No calibrated policy is installed yet, so every ticket goes to a person.');
  }
  const names = Object.keys(policy.model.weights);
  const missing = names.filter((name) => !Number.isFinite(features?.[name]));
  if (missing.length > 0) {
    return ask(`Missing features: ${missing.join(', ')}.`);
  }
  const s = score(features, policy.model);
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
  const { alpha, delta, calibrationSize } = policy;
  return {
    calibrated: true,
    alpha,
    delta,
    calibrationSize,
    guarantee:
      `Among tickets Hedge acts on, at most ${(alpha * 100).toFixed(1)}% are wrong, ` +
      `with probability ${((1 - delta) * 100).toFixed(0)}% over a calibration set of ` +
      `${calibrationSize} tickets, assuming new tickets look like the calibration set.`,
  };
}
