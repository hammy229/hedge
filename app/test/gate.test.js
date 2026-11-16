import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME, decide, describePolicy, score } from '../src/gate.js';
import { adfToText, featurize } from '../src/features.js';
import placeholder from '../src/policy.js';

const calibrated = {
  calibrated: true,
  featureSchema: 1,
  retriever: 'bm25-v1',
  alpha: 0.03,
  delta: 0.1,
  calibrationSize: 2000,
  threshold: 0.8,
  model: { bias: -1, weights: { margin: 4 } },
};

test('placeholder policy always asks', () => {
  const out = decide({ summaryWords: 9, hasDescription: 1 }, placeholder);
  assert.equal(out.decision, 'ask');
  assert.match(out.reason, /No calibrated policy/);
});

test('acts at or above the threshold and asks below it', () => {
  assert.equal(decide({ margin: 1 }, calibrated).decision, 'act'); // sigmoid(3) = 0.95
  assert.equal(decide({ margin: 0.2 }, calibrated).decision, 'ask'); // sigmoid(-0.2) = 0.45
});

test('missing or non-numeric features fail closed', () => {
  assert.equal(decide({}, calibrated).decision, 'ask');
  assert.equal(decide({ margin: NaN }, calibrated).decision, 'ask');
  assert.equal(decide(undefined, calibrated).decision, 'ask');
  assert.match(decide({}, calibrated).reason, /margin/);
});

test('score is a logistic function', () => {
  assert.equal(score({ margin: 0.25 }, calibrated.model), 0.5);
});

test('policy description states the guarantee', () => {
  assert.match(describePolicy(calibrated).guarantee, /at most 3\.0% are wrong/);
  assert.equal(describePolicy(placeholder).calibrated, false);
});

test('adfToText flattens Atlassian Document Format', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Login ' }, { type: 'text', text: 'fails' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'on Safari' }] },
    ],
  };
  assert.equal(adfToText(doc), 'Login fails\non Safari\n');
  assert.equal(adfToText(null), '');
});

test('featurize handles a bare issue', () => {
  assert.deepEqual(featurize({ fields: { summary: 'Crash on save', description: null } }), {
    summaryWords: 3,
    hasDescription: 0,
  });
});

test('a policy from another feature schema or retriever fails closed', () => {
  const features = { margin: 1 }; // would act under a matching policy
  const oldSchema = decide(features, { ...calibrated, featureSchema: 0 });
  assert.equal(oldSchema.decision, 'ask');
  assert.match(oldSchema.reason, /feature schema 0/);
  const otherRetriever = decide(features, { ...calibrated, retriever: 'bge-small-v1' });
  assert.equal(otherRetriever.decision, 'ask');
  assert.match(otherRetriever.reason, /bge-small-v1/);
  const noBinding = { ...calibrated };
  delete noBinding.retriever;
  assert.equal(decide(features, noBinding).decision, 'ask');
  assert.equal(decide(features, calibrated, { ...RUNTIME }).decision, 'act');
});
