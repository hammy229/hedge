import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRIEVER } from '../src/bm25.js';
import policies from '../src/policy.js';
import { triage } from '../src/triage.js';
import { collectWindow, windowJql } from '../src/window.js';

const issue = (key, summary, created, description = '') => ({ key, fields: { summary, description, created } });

const gate = (action, weights, bias, threshold = 0.5) => ({
  action,
  calibrated: true,
  featureSchema: 1,
  retriever: RETRIEVER,
  alpha: 0.03,
  delta: 0.1,
  calibrationSize: 1000,
  threshold,
  model: { bias, weights },
});

const window = [
  issue('P-1', 'Login page crashes on submit', '2024-01-01T00:00:00.000+0000'),
  issue('P-2', 'Dark mode colors are wrong', '2024-01-02T00:00:00.000+0000'),
];
const ticket = issue('P-3', 'Crash when submitting the login page', '2024-01-03T00:00:00.000+0000');

test('placeholder policies always ask, and the candidates are still shown', () => {
  const out = triage({ issue: ticket, window, policies });
  assert.equal(out.decision, 'ask');
  assert.equal(out.candidates[0].key, 'P-1');
  assert.equal(out.searched, 2);
});

test('a confident link gate links to the top candidate', () => {
  const out = triage({ issue: ticket, window, policies: { link: gate('link', { margin: 10 }, 0), clear: policies.clear } });
  assert.equal(out.decision, 'link');
  assert.equal(out.duplicateOf, 'P-1');
});

test('a clear gate clears a ticket that matches nothing', () => {
  const lonely = issue('P-4', 'Unrelated zebra request', '2024-01-04T00:00:00.000+0000');
  const out = triage({ issue: lonely, window, policies: { link: policies.link, clear: gate('clear', { top1: -10 }, 5) } });
  assert.equal(out.decision, 'clear');
  assert.equal(out.candidates.length, 0);
});

test('both gates acting is a contradiction and goes to a person', () => {
  const out = triage({ issue: ticket, window, policies: { link: gate('link', { margin: 0 }, 5), clear: gate('clear', { margin: 0 }, 5) } });
  assert.equal(out.decision, 'ask');
  assert.match(out.reason, /contradicts/);
});

test('a policy certified for one action never gates the other', () => {
  const out = triage({ issue: ticket, window, policies: { link: gate('clear', { margin: 0 }, 5), clear: policies.clear } });
  assert.equal(out.decision, 'ask');
});

test('the gate reads the stripped summary, as in calibration', () => {
  const keyed = issue('P-5', 'HADOOP-12 HADOOP-13 crash', '2024-01-05T00:00:00.000+0000');
  const words = gate('link', { summaryWords: 1 }, -1.5); // acts only with two or more words
  const out = triage({ issue: keyed, window, projectKeys: ['HADOOP'], policies: { link: words, clear: policies.clear } });
  assert.equal(out.gates.link.decision, 'ask'); // one word left after stripping, not three
});

function pages(all, size) {
  // Newest first, like ORDER BY created DESC.
  const sorted = [...all].sort((a, b) => Date.parse(b.fields.created) - Date.parse(a.fields.created));
  return async (token) => {
    const start = token ? Number(token) : 0;
    const end = start + size;
    return { issues: sorted.slice(start, end), nextPageToken: end < sorted.length ? String(end) : undefined };
  };
}

test('the window is the latest earlier issues, oldest first, ties settled by key', async () => {
  const t = (d) => `2024-01-0${d}T00:00:00.000+0000`;
  const all = [
    issue('P-1', 'a', t(1)), issue('P-3', 'b', t(2)), issue('P-2', 'c', t(2)),
    issue('P-4', 'd', t(3)), issue('P-5', 'same time as ticket', t(4)), issue('P-6', 'later', t(5)),
  ];
  const me = issue('P-9', 'ticket', t(4));
  const { window: w, complete } = await collectWindow(pages(all, 2), me, 3);
  assert.ok(complete);
  // Earlier than the ticket: P-1, P-2, P-3 (tied, by key), P-4. The latest three, oldest first:
  assert.deepEqual(w.map((x) => x.key), ['P-2', 'P-3', 'P-4']);
});

test('a window cut through a tie reads past the page and still settles by key', async () => {
  const t = (d) => `2024-01-0${d}T00:00:00.000+0000`;
  const all = [issue('P-1', 'a', t(1)), issue('P-3', 'b', t(2)), issue('P-2', 'c', t(2))];
  const { window: w } = await collectWindow(pages(all, 1), issue('P-9', 'x', t(5)), 1);
  assert.deepEqual(w.map((x) => x.key), ['P-3']); // Python's last row in (time, key) order
});

test('windowJql bounds the search safely and refuses odd project ids', () => {
  assert.equal(windowJql('10000', ticket), 'project = 10000 AND created < "2024-01-05" ORDER BY created DESC');
  assert.throws(() => windowJql('1 OR 1=1', ticket));
  return assert.rejects(collectWindow(async () => ({ issues: [] }), issue('P-1', 'x', 'not a date')));
});
