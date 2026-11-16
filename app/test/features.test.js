import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateFeatures, scoreFeatures } from '../src/features.js';

const contract = JSON.parse(
  readFileSync(new URL('../../fixtures/features.json', import.meta.url), 'utf8'),
);

for (const c of contract.cases) {
  test(`matches the Python features: ${c.name}`, () => {
    const issue = { fields: { summary: c.summary, description: c.descriptionAdf } };
    const got = gateFeatures(issue, c.scores);
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
