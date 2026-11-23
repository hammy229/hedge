import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_ACT_TEXT, FEW_REVIEWS, TONE, actProjectsSaved, autoActSaved, budgetSaved, dialView, logRows, panelFailure, panelView, summaryView, verdictStatus, verdictView,
  ASK_QUEUE_HREF, answerStatus, answersText, pauseViews, resumed,
} from '../src/view.js';

test('a cleared ticket shows its budget and what was searched', () => {
  const v = panelView({
    decision: 'clear',
    reason: 'Confidence 0.981 is at or above the calibrated threshold 0.964.',
    searched: 412,
    candidates: [{ key: 'P-1', score: 3.14159 }],
    budgets: { clear: 0.03 },
  });
  assert.equal(v.kind, 'decided');
  assert.equal(v.lozenge.appearance, 'inprogress');
  assert.equal(v.budget.value, '3%');
  assert.match(v.budget.text, /At most 3% of the tickets Hedge clears/);
  assert.match(v.notes[0], /412/);
  assert.deepEqual(v.candidates, [{ key: 'P-1', score: '3.14', href: '/browse/P-1', isMatch: false }]);
  assert.match(v.headline, /^Hedge's call: a new report/);
  assert.deepEqual(v.reasons, [{ label: null, text: 'Confidence 0.981 is at or above the calibrated threshold 0.964.' }]);
  assert.equal(v.carriedOut, null);
  assert.equal(v.nextStep, null);
});

test('the panel says a call was carried out only when the issue has its label', () => {
  const base = { decision: 'clear', reason: 'r', searched: 50, budgets: { clear: 0.03 } };
  assert.match(panelView({ ...base, labels: ['ui', 'hedge-cleared'] }).carriedOut, /carried this out.*hedge-cleared/);
  assert.doesNotMatch(panelView({ ...base, labels: ['hedge-ask'] }).carriedOut, /carried/);
  const link = panelView({ decision: 'link', duplicateOf: 'P-2', reason: 'r', labels: ['hedge-duplicate'], candidates: [{ key: 'P-2', score: 9 }, { key: 'P-3', score: 4 }] });
  assert.match(link.headline, /duplicate of P-2/);
  assert.match(link.carriedOut, /added the label hedge-duplicate/);
  assert.match(link.carriedOut, /did not link/);
  assert.match(link.nextStep, /Open P-2/);
  assert.equal(panelView({ decision: 'link', duplicateOf: 'P-2', labels: ['hedge-linked'] }).carriedOut, null);
  assert.deepEqual(link.candidates.map((c) => c.isMatch), [true, false]);
  const ask = panelView({ decision: 'ask', labels: ['hedge-ask'] });
  assert.doesNotMatch(ask.carriedOut, /carried/);
  assert.match(ask.carriedOut, /waiting for a person/);
  assert.equal(panelView({ decision: 'ask' }).carriedOut, null);
});

test('an ask names no budget, since nothing was done, and says what to do next', () => {
  const v = panelView({ decision: 'ask', reason: 'below', searched: 3, budgets: { clear: 0.03 }, copyOf: 'P-9', candidates: [{ key: 'P-9', score: 1 }] });
  assert.equal(v.lozenge.text, 'Needs a person');
  assert.equal(v.budget, null);
  assert.ok(v.notes.some((l) => /P-9/.test(l)));
  assert.match(v.nextStep, /Compare this ticket with the closest earlier issues/);
  assert.match(panelView({ decision: 'ask', reason: 'x' }).nextStep, /no earlier issues/);
});

test('an ask reason is split by gate, and said once when both gates agree', () => {
  const split = panelView({ decision: 'ask', reason: 'Link: Confidence 0.1 is below 0.9. Clear: Confidence 0.5 is below 0.96.' });
  assert.deepEqual(split.reasons, [
    { label: 'Duplicate check', text: 'Confidence 0.1 is below 0.9.' },
    { label: 'New report check', text: 'Confidence 0.5 is below 0.96.' },
  ]);
  const same = 'This project has 3 earlier issues. Hedge needs at least 30 to compare against before it acts.';
  assert.deepEqual(panelView({ decision: 'ask', reason: `Link: ${same} Clear: ${same}` }).reasons, [{ label: null, text: same }]);
  assert.deepEqual(panelView({ decision: 'ask' }).reasons, []);
  const copy = panelView({ decision: 'ask', reason: 'This ticket repeats the text of P-4.', copyOf: 'P-4' });
  assert.equal(copy.notes.some((l) => /P-4/.test(l)), false);
});

test('a link names its own budget', () => {
  const v = panelView({ decision: 'link', duplicateOf: 'P-2', budgets: { clear: 0.03, link: 0.025 } });
  assert.equal(v.budget.value, '2.5%');
  assert.match(v.budget.text, /Hedge links/);
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
  assert.equal(v.current, 'Current budget: 3%. Hedge acts on 59.9% of held-out tickets.');
  const none = dialView({ budget: 0.02, options: [{ alpha: 0.02, certified: false, coverage: 0, label: 'a' }] });
  assert.match(none.current, /Nothing is certified here/);
  assert.equal(none.anyCertified, false);
});

test('the summary shows each budget, the switch and the log size', () => {
  const settings = {
    clear: { budget: 0.03, options: [{ alpha: 0.03, certified: true, coverage: 0.6 }] },
    link: { budget: 0.03, options: [{ alpha: 0.03, certified: false, coverage: 0 }] },
  };
  const v = summaryView(settings, true, [{}, {}]);
  assert.deepEqual(v.tiles.map((t) => t.value), ['3%', 'Always asks', 'On', 'Unknown', '2']);
  assert.equal(v.hint, '');
  assert.match(summaryView(settings, false, []).hint, /No decisions yet/);
  assert.equal(summaryView(null, undefined, null).tiles[2].value, 'Off');
});

test('saving a budget or the switch confirms what is now set', () => {
  const setting = { options: [{ alpha: 0.025, certified: true }, { alpha: 0.02, certified: false }] };
  assert.equal(budgetSaved('clear', { clear: 0.025 }, setting), 'Saved. The new report budget is now 2.5%.');
  assert.match(budgetSaved('clear', { clear: 0.02 }, setting), /asks about every ticket/);
  assert.equal(budgetSaved('link', {}, setting), 'Saved.');
  assert.match(autoActSaved(true), /now acts on each new issue/);
  assert.match(autoActSaved(false), /no longer acts/);
  assert.match(AUTO_ACT_TEXT, /labels likely duplicates hedge-duplicate so a person can link them/);
});

test('log rows format time, score and budget and tolerate gaps', () => {
  const rows = logRows([{ at: '2026-11-19T12:34:56.000Z', issueKey: 'P-1', decision: 'clear', score: 0.98123, budget: 0.025, via: 'mcp' }, { issueKey: 'P-2' }]);
  const r = rows[0];
  assert.deepEqual([r.at, r.issueKey, r.href, r.decision.text, r.score, r.budget, r.via, r.applied.text], ['2026-11-19 12:34', 'P-1', '/browse/P-1', 'New report', '0.981', '2.5%', 'Agent (MCP)', 'Report only']);
  assert.equal(rows[1].score, '');
  assert.equal(rows[1].decision.text, '');
  const applied = logRows([{ issueKey: 'P-3', applied: true, via: 'trigger' }, { issueKey: 'P-4', applied: false, decision: 'odd' }]);
  assert.deepEqual(applied.map((x) => x.applied.text), ['Done', 'Failed']);
  assert.equal(applied[0].via, 'New issue');
  assert.deepEqual(applied[1].decision, { text: 'odd', appearance: 'default' });
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
  assert.match(few.text, /reviewed 10 actions Hedge carried out and marked 1 wrong \(10%\)\. The budget is 3%\./);
  assert.match(few.text, /too few/);
  assert.equal(few.warn, false);
  const many = verdictView({ reviewed: FEW_REVIEWS, wrong: 3 }, 0.03);
  assert.equal(many.warn, true);
  assert.doesNotMatch(many.text, /too few/);
  assert.equal(verdictView({ reviewed: 100, wrong: 2 }, 0.03).warn, false);
  assert.match(verdictView({ reviewed: 1, wrong: 0 }, 0.03).text, /reviewed 1 action Hedge carried out and/);
});

test('errors and unknown decisions render as asks', () => {
  assert.equal(panelView({ error: 'issueKey must look like PROJ-123.' }).headline, 'issueKey must look like PROJ-123.');
  assert.equal(panelView({ decision: 'delete' }).lozenge.text, 'Needs a person');
  assert.equal(panelView(undefined).lozenge.text, 'Needs a person');
  assert.equal(panelView({ error: 'x' }).kind, 'error');
});

test('a failed or timed out call says a person decides', () => {
  assert.equal(panelFailure('Hedge took too long to answer').text, 'Hedge took too long to answer. A person decides this ticket.');
  assert.equal(panelFailure('Boom.').text, 'Boom. A person decides this ticket.');
  assert.match(panelFailure('').text, /^Unknown error\./);
});

test('the verdict control thanks the person and mentions the budget only for applied calls', () => {
  assert.match(verdictStatus('right', true).text, /marked this call right\. The admin page compares/);
  assert.equal(verdictStatus('wrong', false).text, 'Thanks. You marked this call wrong.');
  assert.equal(verdictStatus('failed', true, 'Hedge has no decision on P-1 to review.').error, 'Hedge has no decision on P-1 to review. Try again.');
  assert.equal(verdictStatus('failed', true).error, 'Could not save that. Try again.');
  assert.deepEqual(verdictStatus('idle'), { done: false, error: null });
  const base = { decision: 'clear', budgets: { clear: 0.03 } };
  assert.equal(panelView({ ...base, labels: ['hedge-cleared'] }).verdictCounts, true);
  assert.equal(panelView(base).verdictCounts, false);
  assert.equal(panelView({ decision: 'ask', labels: ['hedge-ask'] }).verdictCounts, false);
  assert.equal(panelView({ error: 'x' }).verdictCounts, false);
});

test('verdicts on calls Hedge only showed are named apart from the budget', () => {
  assert.match(verdictView({ reviewed: 0, shownOnly: 4 }, 0.03).text, /No one has reviewed.*4 more verdicts were on calls Hedge only showed, so they don't count against the budget\./);
  assert.match(verdictView({ reviewed: 40, wrong: 0, shownOnly: 1 }, 0.03).text, /1 more verdict was on calls/);
  assert.doesNotMatch(verdictView({ reviewed: 40, wrong: 0, shownOnly: 0 }, 0.03).text, /only showed/);
  assert.equal(verdictView({ reviewed: 40, wrong: 3, shownOnly: 50 }, 0.03).warn, true);
});

test('every call has its own accent, all from Atlassian tokens', () => {
  for (const tone of Object.values(TONE)) {
    for (const token of Object.values(tone)) assert.match(token, /^color\.(background|border|text)\.accent\./);
  }
  assert.notEqual(TONE.clear.background, TONE.ask.background);
});

test('the saved project list reads back in plain words', () => {
  assert.equal(actProjectsSaved([]), 'Saved. Hedge acts on new issues in every project.');
  assert.equal(actProjectsSaved(['DEMO']), 'Saved. Hedge acts on new issues only in DEMO.');
  assert.equal(actProjectsSaved(['DEMO', 'OPS']), 'Saved. Hedge acts on new issues only in DEMO, OPS.');
});

test('a failed row in the log carries its cause', () => {
  const [row] = logRows([{ at: '2026-11-22T01:00:00Z', issueKey: 'DEMO-9', decision: 'clear', applied: false, appliedError: 'No Labels field.' }]);
  assert.equal(row.applied.text, 'Failed');
  assert.equal(row.applied.why, 'No Labels field.');
});

test('the acting tile names the projects when the admin limited them', () => {
  const tile = (on, projects) => summaryView({}, on, [], projects).tiles.find((t) => t.key === 'auto').value;
  assert.equal(tile(true, ['DEMO', 'OPS']), 'On in DEMO, OPS');
  assert.equal(tile(true, []), 'On');
  assert.equal(tile(true, undefined), 'On');
  assert.equal(tile(false, ['DEMO']), 'Off');
});

test('a paused action gets a banner with the counts, and nothing shows when none is', () => {
  assert.deepEqual(pauseViews({ clear: { paused: false }, link: { paused: false } }), []);
  assert.deepEqual(pauseViews(null), []);
  const [v] = pauseViews({ clear: { paused: true, reviewed: 10, wrong: 3 }, link: { paused: false } });
  assert.equal(v.action, 'clear');
  assert.match(v.title, /clear new reports/);
  assert.match(v.text, /3 of 10/);
  assert.match(pauseViews({ link: { paused: true, unreadable: true } })[0].text, /could not read/);
  assert.match(resumed('clear'), /new report calls again/);
});

test('the verdict line says whether the ticket moved and whether Hedge paused', () => {
  assert.match(verdictStatus('wrong', true, null, { requeued: { ok: true }, paused: true }).text, /hedge-ask.*now paused/);
  assert.match(verdictStatus('wrong', true, null, { requeued: { ok: false, error: 'Jira returned 403' } }).text, /kept its label: Jira returned 403\./);
  assert.doesNotMatch(verdictStatus('right', true, null, { requeued: null, paused: false }).text, /queue|paused/);
});

test('a queued ticket gets an answer control, even when its call is now a clear', () => {
  assert.equal(panelView({ decision: 'ask', reason: 'r', labels: ['hedge-ask'] }).queued, true);
  const marked = panelView({ decision: 'clear', reason: 'r', labels: ['hedge-ask'], budgets: { clear: 0.03 } });
  assert.equal(marked.queued, true);
  assert.equal(marked.verdictCounts, false);
  assert.match(marked.carriedOut, /in the queue/);
  assert.equal(panelView({ decision: 'ask', reason: 'r', labels: [] }).queued, false);
});

test('answers are confirmed and counted in plain words', () => {
  assert.match(answerStatus('duplicate').text, /add the duplicate link yourself/);
  assert.match(answerStatus('failed', 'Jira returned 403').error, /403\. Try again/);
  assert.match(answersText({ fresh: 3, duplicate: 1 }), /4 queued tickets: 3 new, 1 duplicate\./);
  assert.match(answersText(null), /could not be read/);
});

test('the queue tile links to the search and never shows an unknown count as zero', () => {
  const tile = (n) => summaryView({}, true, [], [], n).tiles.find((t) => t.key === 'queue');
  assert.equal(tile(4).value, '4');
  assert.equal(tile(0).value, '0');
  assert.equal(tile(null).value, 'Unknown');
  assert.equal(tile(4).href, ASK_QUEUE_HREF);
  assert.match(decodeURIComponent(ASK_QUEUE_HREF), /labels = hedge-ask AND statusCategory != Done$/);
});
