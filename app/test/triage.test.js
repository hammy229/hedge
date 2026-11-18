import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRIEVER } from '../src/bm25.js';
import installed from '../src/policy.js';
import { RUNTIME, policyProblem } from '../src/gate.js';
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

// Gates that never act, so each test turns on only the gate it is about.
const closed = (action) => ({ action, calibrated: false });
const policies = { link: closed('link'), clear: closed('clear') };

const window = [
  issue('P-1', 'Login page crashes on submit', '2024-01-01T00:00:00.000+0000'),
  issue('P-2', 'Dark mode colors are wrong', '2024-01-02T00:00:00.000+0000'),
];
const ticket = issue('P-3', 'Crash when submitting the login page', '2024-01-03T00:00:00.000+0000');

test('closed policies always ask, and the candidates are still shown', () => {
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

test('equal word counts in a different order tie exactly, so the older issue wins', async () => {
  // Before terms were summed in one fixed order, 16 of these 200 pairs differed in the last
  // bits, so the newer issue could outrank an identical older one.
  const { windowScores, topK } = await import('../src/bm25.js');
  const w = ['crash', 'login', 'cache', 'leak', 'render', 'thread', 'timeout', 'null', 'api'];
  for (let t = 0; t < 200; t += 1) {
    const doc = Array.from({ length: 9 + (t % 5) }, (_, i) => w[(i * 5 + t * 3) % w.length]);
    const rotated = [...doc.slice(t % doc.length), ...doc.slice(0, t % doc.length)].reverse();
    const s = windowScores([doc.join(' '), rotated.join(' '), 'x y'], w.join(' '));
    assert.equal(s[0], s[1]);
    assert.deepEqual(topK(s).slice(0, 2), [0, 1]);
  }
});

test('stored window issues keep only the scored part of the description', async () => {
  const long = issue('P-1', 'a', '2024-01-01T00:00:00.000+0000', 'x'.repeat(50000));
  const { window: w } = await collectWindow(pages([long], 10), ticket);
  assert.equal(w[0].fields.description.length, 1000);
});

test('a read past the deadline is incomplete, so the caller asks', async () => {
  const all = Array.from({ length: 5 }, (_, i) => issue(`P-${i}`, 'a', `2024-01-0${i + 1}T00:00:00.000+0000`));
  const late = issue('P-9', 'x', '2024-01-09T00:00:00.000+0000');
  const { complete } = await collectWindow(pages(all, 1), late, 1000, Date.now() - 1);
  assert.equal(complete, false);
});

test('the installed policies match this build, and only clear is certified', () => {
  assert.equal(installed.link.calibrated, false);
  assert.equal(installed.clear.calibrated, true);
  assert.equal(installed.clear.action, 'clear');
  assert.equal(policyProblem(installed.clear, RUNTIME), null);
  assert.ok(installed.clear.alpha <= 0.05, 'the shipped clear budget is strict');
});

test('the installed clear gate clears a ticket unlike anything in its window', () => {
  const lonely = issue('P-4', 'Add a keyboard shortcut to export the zebra report', '2024-01-04T00:00:00.000+0000');
  assert.equal(triage({ issue: lonely, window, policies: installed }).decision, 'clear');
});

test('a copy of a window issue is never cleared, because copies were not calibrated', () => {
  const open = gate('clear', { top1: 0 }, 5); // would clear anything
  const copy = issue('P-5', 'LOGIN page crashes, on submit!', '2024-01-05T00:00:00.000+0000');
  const out = triage({ issue: copy, window, policies: { link: closed('link'), clear: open } });
  assert.equal(out.decision, 'ask');
  assert.equal(out.copyOf, 'P-1');
  assert.match(out.gates.clear.reason, /repeats the text of P-1/);
  const fresh = issue('P-6', 'Login page crashes on submit with a long password', '2024-01-06T00:00:00.000+0000');
  assert.equal(triage({ issue: fresh, window, policies: { link: closed('link'), clear: open } }).decision, 'clear');
});
