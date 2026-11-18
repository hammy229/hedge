import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_SCHEMA, gateFeatures, scoreFeatures } from '../src/features.js';

const contract = JSON.parse(
  readFileSync(new URL('../../fixtures/features.json', import.meta.url), 'utf8'),
);

for (const c of contract.cases) {
  test(`matches the Python features: ${c.name}`, () => {
    const issue = { fields: { summary: c.summary, description: c.descriptionAdf } };
    const got = gateFeatures(issue, c.scores, c.context);
    assert.deepEqual(Object.keys(got).sort(), [...contract.featureNames].sort());
    for (const name of contract.featureNames) {
      assert.ok(
        Math.abs(got[name] - c.expected[name]) <= 1e-12,
        `${name}: js ${got[name]} vs python ${c.expected[name]}`,
      );
    }
  });
}

test('scoreFeatures rejects k below 2 and does not mutate its input', () => {
  assert.throws(() => scoreFeatures([1, 2], 1), RangeError);
  const scores = [1, 3, 2];
  scoreFeatures(scores);
  assert.deepEqual(scores, [1, 3, 2]);
});

test('the app computes the schema version the fixture was generated under', () => {
  assert.equal(FEATURE_SCHEMA, contract.featureSchema);
});

test('broken scores give NaN features, like Python', () => {
  for (const scores of [[5, 4, NaN, ...Array(10).fill(1)], [Infinity, 1], [null, 1], ['3', 1]]) {
    const f = scoreFeatures(scores);
    assert.ok(Object.values(f).every(Number.isNaN), JSON.stringify(scores));
  }
  assert.throws(() => scoreFeatures([1, 2], 2.5), RangeError);
});
