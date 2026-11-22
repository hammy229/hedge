import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEW_REVIEWS, dialView, logRows, panelView, verdictView } from '../src/view.js';

test('a cleared ticket shows its budget and what was searched', () => {
  const v = panelView({
    decision: 'clear',
    reason: 'Confidence 0.981 is at or above the calibrated threshold 0.964.',
    searched: 412,
    candidates: [{ key: 'P-1', score: 3.14159 }],
    budgets: { clear: 0.03 },
  });
  assert.equal(v.lozenge.appearance, 'success');
  assert.match(v.lines[0], /at most 3%/);
  assert.match(v.lines[1], /412/);
  assert.deepEqual(v.candidates, [{ key: 'P-1', score: '3.14' }]);
  assert.match(v.headline, /^Hedge's call: a new report/);
  assert.equal(v.lines.some((l) => /carried this out/.test(l)), false);
});

test('the panel says a call was carried out only when the issue has its label', () => {
  const base = { decision: 'clear', reason: 'r', searched: 50, budgets: { clear: 0.03 } };
  assert.ok(panelView({ ...base, labels: ['ui', 'hedge-cleared'] }).lines.some((l) => /carried this out.*hedge-cleared/.test(l)));
  assert.equal(panelView({ ...base, labels: ['hedge-ask'] }).lines.some((l) => /carried/.test(l)), false);
  const link = panelView({ decision: 'link', duplicateOf: 'P-2', reason: 'r', labels: ['hedge-linked'] });
  assert.match(link.headline, /duplicate of P-2/);
  assert.ok(link.lines.some((l) => /hedge-linked/.test(l)));
  assert.equal(panelView({ decision: 'ask', labels: ['hedge-ask'] }).lines.some((l) => /carried/.test(l)), false);
});

test('an ask names no budget, since nothing was done', () => {
  const v = panelView({ decision: 'ask', reason: 'below', searched: 3, budgets: { clear: 0.03 }, copyOf: 'P-9' });
  assert.equal(v.lozenge.text, 'Needs a person');
  assert.equal(v.lines.some((l) => /budget/.test(l)), false);
  assert.ok(v.lines.some((l) => /P-9/.test(l)));
});

test('errors and unknown decisions render as asks', () => {
  assert.equal(panelView({ error: 'issueKey must look like PROJ-123.' }).headline, 'issueKey must look like PROJ-123.');
  assert.equal(panelView({ decision: 'delete' }).lozenge.text, 'Needs a person');
  assert.equal(panelView(undefined).lozenge.text, 'Needs a person');
});

test('the dial lists every budget with its certified coverage', () => {
  const v = dialView({
    budget: 0.03,
    options: [
      { alpha: 0.02, certified: true, coverage: 0.149, label: 'a' },
      { alpha: 0.03, certified: true, coverage: 0.5988, label: 'b' },
    ],
  });
  assert.equal(v.selected, '0.03');
  assert.deepEqual(v.bars, [{ budget: '2%', coverage: 14.9 }, { budget: '3%', coverage: 59.9 }]);
  assert.equal(v.anyCertified, true);
});

test('log rows format time, score and budget and tolerate gaps', () => {
  const rows = logRows([{ at: '2026-11-19T12:34:56.000Z', issueKey: 'P-1', decision: 'clear', score: 0.98123, budget: 0.025, via: 'mcp' }, { issueKey: 'P-2' }]);
  assert.deepEqual(rows[0].cells.map((c) => c.content), ['2026-11-19 12:34', 'P-1', 'clear', '0.981', '2.5%', 'mcp', '']);
  assert.equal(rows[1].cells[3].content, '');
  const applied = logRows([{ issueKey: 'P-3', applied: true }, { issueKey: 'P-4', applied: false }]);
  assert.deepEqual(applied.map((r) => r.cells[6].content), ['yes', 'failed']);
  assert.deepEqual(logRows(null), []);
});

test('seed view reports progress, resumption and completion', async () => {
  const { seedView } = await import('../src/view.js');
  const fresh = seedView({ projectKey: 'DEMO', created: 0, total: 150 });
  assert.equal(fresh.text, '');
  assert.equal(fresh.button, 'Add 150 sample issues');
  const part = seedView({ projectKey: 'DEMO', created: 40, total: 150 });
  assert.equal(part.progress, 40 / 150);
  assert.match(part.text, /40 of 150 sample issues are in DEMO/);
  assert.equal(part.button, 'Continue adding sample issues');
  assert.match(seedView({ projectKey: 'DEMO', created: 40, total: 150 }, true).text, /Creating sample issues in DEMO: 40 of 150/);
  const done = seedView({ projectKey: 'DEMO', created: 150, total: 150 });
  assert.equal(done.done, true);
  assert.equal(done.progress, 1);
  assert.equal(seedView(null).progress, 0);
  assert.equal(seedView({ created: 999, total: 150, projectKey: 'X' }).progress, 1);
});

test('the verdict view compares people\'s verdicts with the budget and flags small samples', () => {
  assert.match(verdictView({ reviewed: 0 }, 0.03).text, /No one has reviewed/);
  assert.match(verdictView(null, 0.03).text, /No one has reviewed/);
  const few = verdictView({ reviewed: 10, wrong: 1 }, 0.03);
  assert.match(few.text, /reviewed 10 of Hedge's actions and marked 1 wrong \(10%\)\. The budget is 3%\./);
  assert.match(few.text, /too few/);
  assert.equal(few.warn, false);
  const many = verdictView({ reviewed: FEW_REVIEWS, wrong: 3 }, 0.03);
  assert.equal(many.warn, true);
  assert.doesNotMatch(many.text, /too few/);
  assert.equal(verdictView({ reviewed: 100, wrong: 2 }, 0.03).warn, false);
  assert.match(verdictView({ reviewed: 1, wrong: 0 }, 0.03).text, /1 of Hedge's action and/);
});
