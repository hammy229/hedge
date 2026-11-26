import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { K, RETRIEVER, SUMMARY_WEIGHT, WINDOW, topK, weighted, windowScores } from '../src/bm25.js';
import { MAX_DESCRIPTION, codePointPrefix, copyKey, retrievalText } from '../src/text.js';
import { scoreFeatures } from '../src/features.js';

const contract = JSON.parse(readFileSync(new URL('../../fixtures/bm25.json', import.meta.url), 'utf8'));

test('constants match the Python retriever', () => {
  assert.equal(RETRIEVER, contract.retriever);
  assert.equal(WINDOW, contract.window);
  assert.equal(K, contract.k);
  assert.equal(SUMMARY_WEIGHT, contract.summaryWeight);
  assert.equal(MAX_DESCRIPTION, contract.maxDescription);
});

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

for (const c of contract.cases) {
  test(`matches the Python retriever: ${c.name}`, () => {
    const texts = [...c.window, c.query].map((d) => retrievalText(d.summary, d.description, contract.projectKeys));
    assert.deepEqual(texts, c.expected.texts);
    const scores = windowScores(texts.slice(0, -1), texts.at(-1));
    assert.equal(scores.length, c.expected.scores.length);
    scores.forEach((s, i) => assert.ok(close(s, c.expected.scores[i]), `score ${i}: js ${s} vs python ${c.expected.scores[i]}`));
    const top = topK(scores, contract.k);
    assert.deepEqual(top, c.expected.top);
    const features = scoreFeatures(top.map((i) => scores[i]), contract.k);
    for (const [name, want] of Object.entries(c.expected.features)) {
      assert.ok(close(features[name], want), `${name}: js ${features[name]} vs python ${want}`);
    }
    const q = copyKey(texts.at(-1), contract.projectKeys);
    const copies = texts.slice(0, -1).flatMap((t, i) => (q && copyKey(t, contract.projectKeys) === q ? [i] : []));
    assert.deepEqual(copies, c.expected.copies);
  });
}

test('codePointPrefix counts code points, not UTF-16 units', () => {
  assert.equal(codePointPrefix('😀😀😀', 2), '😀😀');
  assert.equal(codePointPrefix('ab', 5), 'ab');
});

test('weighted repeats only the summary, as window.py does', () => {
  assert.equal(weighted('npe login\nstack trace', 3), 'npe login\nnpe login\nnpe login\nstack trace');
  assert.equal(weighted('npe login\nstack', 1), 'npe login\nstack');
  assert.equal(weighted('only a summary', 2), 'only a summary\nonly a summary\n');
  assert.throws(() => weighted('x', 0), /at least 1/);
});
