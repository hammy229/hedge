// Plain-data views for the UI Kit screens, kept out of the JSX so node:test can check them.

import { LABELS } from './act.js';

// One tint per call, matching the web demo's cobalt / plum / ochre palette as closely as
// Atlassian design tokens allow (so dark mode works): blue for a new report, purple for a
// duplicate, yellow for a ticket a person must decide.
export const TONE = Object.freeze({
  clear: { background: 'color.background.accent.blue.subtlest', border: 'color.border.accent.blue', text: 'color.text.accent.blue' },
  link: { background: 'color.background.accent.purple.subtlest', border: 'color.border.accent.purple', text: 'color.text.accent.purple' },
  ask: { background: 'color.background.accent.yellow.subtlest', border: 'color.border.accent.yellow', text: 'color.text.accent.yellow' },
});

const LOZENGE = {
  link: { text: 'Duplicate', appearance: 'new' },
  clear: { text: 'New report', appearance: 'inprogress' },
  ask: { text: 'Needs a person', appearance: 'moved' },
};

const trimPct = (x) => `${+(x * 100).toFixed(2)}%`;
const sentence = (s) => {
  const t = String(s ?? '').trim();
  return t === '' || /[.!?]$/.test(t) ? t : `${t}.`;
};

// Fixed words on the issue panel.
export const PANEL_TEXT = Object.freeze({
  loading: 'Comparing this ticket with earlier issues in the project.',
  timeout: 'Hedge took too long to answer',
  failedTitle: 'Hedge could not run',
  nextStepTitle: 'What to do next',
  whyTitle: 'Why',
  budgetTitle: 'Error budget',
  candidatesTitle: 'Closest earlier issues',
  candidatesNote: 'Match score is BM25 word overlap with this ticket. Higher means more words in common.',
  match: "Hedge's match",
  verdictQuestion: 'Was this call right?',
  verdictLabel: "Review Hedge's call",
});

// The panel's message when the triage call itself failed or timed out.
export function panelFailure(message) {
  return {
    title: PANEL_TEXT.failedTitle,
    text: `${sentence(message || 'Unknown error')} A person decides this ticket.`,
  };
}

// An ask's reason covers both gates ("Link: ... Clear: ..."). Split it so each reads on
// its own line, and say it once when both gates gave the same reason.
function reasonParts(reason) {
  const text = String(reason ?? '').trim();
  const m = /^Link: (.+?) Clear: (.+)$/s.exec(text);
  if (!m) return text === '' ? [] : [{ label: null, text }];
  if (m[1].trim() === m[2].trim()) return [{ label: null, text: m[1].trim() }];
  return [
    { label: 'Duplicate check', text: m[1].trim() },
    { label: 'New report check', text: m[2].trim() },
  ];
}

// What the issue panel shows for one triage result.
export function panelView(result) {
  if (!result || result.error) {
    return {
      kind: 'error',
      lozenge: LOZENGE.ask,
      headline: result?.error ?? 'Hedge did not return a decision.',
      carriedOut: null,
      budget: null,
      nextStep: 'A person decides this ticket.',
      reasons: [],
      notes: [],
      candidates: [],
      verdictCounts: false,
    };
  }
  const decision = LOZENGE[result.decision] ? result.decision : 'ask';
  const budgets = result.budgets ?? {};
  const acting = decision === 'link' ? 'link' : decision === 'clear' ? 'clear' : null;
  // The panel only reports Hedge's call. It says the call was carried out only when the
  // issue carries the label the trigger adds (act.js), never on its own say-so.
  const headline =
    decision === 'link'
      ? `Hedge's call: a duplicate of ${result.duplicateOf}.`
      : decision === 'clear'
        ? "Hedge's call: a new report, so nobody needs to check it for duplicates."
        : 'Hedge is not sure enough to act, so a person should check this ticket.';
  const labels = Array.isArray(result.labels) ? result.labels : [];
  let carriedOut = null;
  if (acting === 'clear' && labels.includes(LABELS.clear)) {
    carriedOut = `Hedge carried this out when the issue was filed (label ${LABELS.clear}).`;
  } else if (acting === 'link' && labels.includes(LABELS.link)) {
    // The trigger only labels a likely duplicate. A person makes the link.
    carriedOut = `Hedge added the label ${LABELS.link} when the issue was filed. It did not link the issues.`;
  } else if (!acting && labels.includes(LABELS.ask)) {
    carriedOut = `This ticket is in the queue waiting for a person (label ${LABELS.ask}).`;
  }
  let budget = null;
  if (acting && Number.isFinite(budgets[acting])) {
    const pct = trimPct(budgets[acting]);
    const verb = acting === 'link' ? 'links' : 'clears';
    budget = { value: pct, text: `At most ${pct} of the tickets Hedge ${verb} this way are wrong, certified on held-out tickets.` };
  }
  const candidates = (Array.isArray(result.candidates) ? result.candidates : []).map((c) => ({
    key: c.key,
    score: Number(c.score).toFixed(2),
    href: `/browse/${c.key}`,
    isMatch: decision === 'link' && c.key === result.duplicateOf,
  }));
  let nextStep = null;
  if (decision === 'link') {
    nextStep = `Open ${result.duplicateOf} and check that it reports the same problem. If it does, link this ticket to it as a duplicate.`;
  } else if (decision === 'ask') {
    nextStep =
      candidates.length > 0
        ? 'Compare this ticket with the closest earlier issues below. If one reports the same problem, link this ticket as its duplicate. If none does, treat it as a new report.'
        : 'Hedge found no earlier issues to compare with. Check this ticket by hand.';
  }
  const reasons = reasonParts(result.reason);
  const notes = [];
  if (Number.isFinite(result.searched)) notes.push(`Searched the ${result.searched} most recent earlier issues in this project.`);
  if (result.copyOf && !reasons.some((r) => r.text.includes(result.copyOf))) notes.push(`Repeats the text of ${result.copyOf}.`);
  // A verdict counts against the budget only when the trigger applied the call (feedback.js).
  const verdictCounts = acting !== null && carriedOut !== null;
  return { kind: 'decided', decision, lozenge: LOZENGE[decision], headline, carriedOut, budget, nextStep, reasons, notes, candidates, verdictCounts };
}

// The line under the verdict buttons, for the state of the verdict control.
// outcome is what the feedback resolver returned: whether the ticket moved to the queue, and
// whether this verdict paused Hedge.
export function verdictStatus(state, counts, error, outcome = null) {
  if (state === 'right' || state === 'wrong') {
    const extra = counts === true ? ' The admin page compares these verdicts with the error budget.' : '';
    let moved = '';
    if (outcome?.requeued?.ok === true) moved = ` The ticket is now in the queue for a person (label ${LABELS.ask}).`;
    else if (outcome?.requeued?.ok === false) moved = ` The ticket kept its label: ${sentence(outcome.requeued.error)}`;
    const paused = outcome?.paused === true ? ' Hedge is now paused: it asks about every ticket until an admin resumes it.' : '';
    return { done: true, text: `Thanks. You marked this call ${state}.${moved}${paused}${extra}` };
  }
  if (state === 'failed') return { done: false, error: `${sentence(error || 'Could not save that')} Try again.` };
  return { done: false, error: null };
}

// What each action is called on the admin page.
export const ACTION_TEXT = Object.freeze({
  clear: {
    title: 'Clear new reports',
    noun: 'new report',
    blurb: 'Hedge marks a ticket as a new report, so nobody has to check it for duplicates.',
  },
  link: {
    title: 'Link duplicates',
    noun: 'duplicate',
    blurb: 'Hedge links a ticket to the earlier issue it repeats.',
  },
});

export const CHART_NOTE =
  'Each bar is a budget you can pick. Its height is the share of held-out calibration tickets Hedge would act on at that budget. Taller means Hedge acts on more tickets and asks about fewer.';

const selectedOption = (setting) => (setting?.options ?? []).find((o) => o.alpha === setting?.budget) ?? null;

// Bars and choices for one action on the admin page.
export function dialView(setting) {
  const options = setting?.options ?? [];
  const chosen = selectedOption(setting);
  let current = '';
  if (chosen?.certified) {
    current = `Current budget: ${trimPct(chosen.alpha)}. Hedge acts on ${+(chosen.coverage * 100).toFixed(1)}% of held-out tickets.`;
  } else if (Number.isFinite(setting?.budget)) {
    current = `Current budget: ${trimPct(setting.budget)}. Nothing is certified here, so Hedge asks about every ticket.`;
  }
  return {
    choices: options.map((o) => ({ name: 'budget', value: String(o.alpha), label: o.label })),
    selected: String(setting?.budget ?? ''),
    bars: options.map((o) => ({ budget: trimPct(o.alpha), coverage: +(o.coverage * 100).toFixed(1) })),
    anyCertified: options.some((o) => o.certified),
    current,
  };
}

// The value a summary tile shows for one action's budget.
function budgetValue(setting) {
  const chosen = selectedOption(setting);
  if (chosen?.certified) return trimPct(chosen.alpha);
  return 'Always asks';
}

// The tiles at the top of the admin page: what is set right now, at a glance.
export function summaryView(settings, autoAct, log, projects = []) {
  const count = Array.isArray(log) ? log.length : 0;
  return {
    tiles: [
      { key: 'clear', label: 'New report budget', value: budgetValue(settings?.clear) },
      { key: 'link', label: 'Duplicate budget', value: budgetValue(settings?.link) },
      { key: 'auto', label: 'Acting on new issues', value: autoAct !== true ? 'Off' : Array.isArray(projects) && projects.length > 0 ? `On in ${projects.join(', ')}` : 'On' },
      { key: 'log', label: 'Recent decisions', value: String(count) },
    ],
    hint: count === 0 ? 'No decisions yet. Add sample data at the bottom of this page, then open one of its issues.' : '',
  };
}

// The confirmation after a budget is saved, from the budgets setBudget returns.
export function budgetSaved(action, budgets, setting) {
  const alpha = budgets?.[action];
  const name = ACTION_TEXT[action]?.noun ?? action;
  if (!Number.isFinite(alpha)) return 'Saved.';
  const option = (setting?.options ?? []).find((o) => o.alpha === alpha);
  const tail = option && !option.certified ? ' Nothing is certified at this budget, so Hedge asks about every ticket.' : '';
  return `Saved. The ${name} budget is now ${trimPct(alpha)}.${tail}`;
}

// The confirmation after acting on new issues is switched.
export function autoActSaved(on) {
  return on === true
    ? 'Saved. Hedge now acts on each new issue as it is filed.'
    : 'Saved. Hedge no longer acts on new issues. The panel and agents still get its call.';
}

export function actProjectsSaved(projects) {
  return Array.isArray(projects) && projects.length > 0
    ? `Saved. Hedge acts on new issues only in ${projects.join(', ')}.`
    : 'Saved. Hedge acts on new issues in every project.';
}

export const ACT_PROJECTS_HINT = 'Leave empty to act in every project.';

export const AUTO_ACT_TEXT =
  `When this is on, Hedge triages each new issue as it is filed and carries the call out. It labels cleared issues ${LABELS.clear}, labels likely duplicates ${LABELS.link} so a person can link them, and labels the rest ${LABELS.ask}.`;
export const ASK_QUEUE_JQL = `labels = ${LABELS.ask}`;

// The banner for each paused action, shown above everything else on the admin page.
// Resuming throws away the evidence, so the text says what to do first.
export function pauseViews(pauses) {
  return ['clear', 'link']
    .filter((a) => pauses?.[a]?.paused === true)
    .map((action) => {
      const p = pauses[action];
      const title = `Hedge paused: ${ACTION_TEXT[action].title.toLowerCase()}`;
      const text = p.unreadable
        ? 'Hedge could not read whether it is paused, so it asks a person about every ticket. Resume to save a fresh state.'
        : `People marked ${p.wrong} of ${p.reviewed} reviewed calls wrong. If Hedge were inside its budget, evidence this strong would come up in at most 5% of sites, so it now asks a person about every ticket. Look at the wrong calls, pick a tighter budget if they look alike, then resume. Only calls made after that will count.`;
      return { action, title, text };
    });
}

export function resumed(action) {
  return `Resumed. Hedge can act on ${ACTION_TEXT[action]?.noun ?? action} calls again, and the count of reviewed calls starts over.`;
}

const VIA = { panel: 'Issue panel', mcp: 'Agent (MCP)', trigger: 'New issue' };

export const LOG_HEAD = ['Time (UTC)', 'Issue', 'Decision', 'Score', 'Budget', 'Source', 'Carried out'];

// Rows of the recent-decisions table, as plain data the JSX turns into cells.
export function logRows(log) {
  return (Array.isArray(log) ? log : []).map((e, i) => ({
    key: `${e.at}-${e.issueKey}-${i}`,
    at: String(e.at ?? '').replace('T', ' ').slice(0, 16),
    issueKey: String(e.issueKey ?? ''),
    href: e.issueKey ? `/browse/${e.issueKey}` : '',
    decision: LOZENGE[e.decision] ?? { text: String(e.decision ?? ''), appearance: 'default' },
    score: Number.isFinite(e.score) ? e.score.toFixed(3) : '',
    budget: Number.isFinite(e.budget) ? trimPct(e.budget) : '',
    via: VIA[e.via] ?? String(e.via ?? ''),
    // Only the issue trigger carries decisions out; the panel and MCP only report them.
    applied:
      e.applied === true
        ? { text: 'Done', appearance: 'inprogress' }
        : e.applied === false
          ? { text: 'Failed', appearance: 'removed', why: String(e.appliedError ?? '') }
          : { text: 'Report only', appearance: null },
  }));
}

// The sample-data section of the admin page, for a seedStatus or seedStep result.
export function seedView(status, running = false) {
  const total = Number.isInteger(status?.total) && status.total > 0 ? status.total : 0;
  const created = Number.isInteger(status?.created) ? Math.min(Math.max(status.created, 0), total) : 0;
  const done = total > 0 && created >= total;
  let text;
  if (done) text = `All ${total} sample issues are in ${status.projectKey}.`;
  else if (running) text = `Creating sample issues in ${status?.projectKey ?? 'the project'}: ${created} of ${total}.`;
  else if (created > 0) text = `${created} of ${total} sample issues are in ${status.projectKey}. Continue to add the rest.`;
  else text = '';
  return { progress: total > 0 ? created / total : 0, text, done, button: created > 0 && !done ? 'Continue adding sample issues' : `Add ${total || 150} sample issues` };
}

// What people's verdicts say next to the budget, for the admin page. Fewer than 30
// reviews is too few to compare with a budget of a few percent, so it says so.
export const FEW_REVIEWS = 30;

export function verdictView(summary, budget) {
  const reviewed = Number.isInteger(summary?.reviewed) && summary.reviewed > 0 ? summary.reviewed : 0;
  const wrong = Number.isInteger(summary?.wrong) ? Math.min(Math.max(summary.wrong, 0), reviewed) : 0;
  const shown = Number.isInteger(summary?.shownOnly) && summary.shownOnly > 0 ? summary.shownOnly : 0;
  const shownText = shown === 0 ? '' : ` ${shown} more ${shown === 1 ? 'verdict was' : 'verdicts were'} on calls Hedge only showed, so they don't count against the budget.`;
  if (reviewed === 0) {
    return { text: `No one has reviewed an action Hedge carried out yet. Mark calls right or wrong from the Hedge panel on an issue.${shownText}`, warn: false };
  }
  const rate = wrong / reviewed;
  const plural = reviewed === 1 ? 'action' : 'actions';
  let text = `People reviewed ${reviewed} ${plural} Hedge carried out and marked ${wrong} wrong (${trimPct(rate)}).`;
  const over = Number.isFinite(budget) && rate > budget;
  if (Number.isFinite(budget)) text += ` The budget is ${trimPct(budget)}.`;
  if (reviewed < FEW_REVIEWS) text += ` ${reviewed} reviews are too few to tell a ${trimPct(budget ?? 0.03)} budget apart from chance.`;
  text += shownText;
  return { text, warn: over && reviewed >= FEW_REVIEWS };
}
