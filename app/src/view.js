// Plain-data views for the UI Kit screens, kept out of the JSX so node:test can check them.

import { LABELS } from './act.js';

const LOZENGE = {
  link: { text: 'Duplicate', appearance: 'moved' },
  clear: { text: 'New report', appearance: 'success' },
  ask: { text: 'Needs a person', appearance: 'default' },
};

const trimPct = (x) => `${+(x * 100).toFixed(2)}%`;

// What the issue panel shows for one triage result.
export function panelView(result) {
  if (!result || result.error) {
    return { lozenge: LOZENGE.ask, headline: result?.error ?? 'Hedge did not return a decision.', lines: [], candidates: [] };
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
  const lines = [];
  const labels = Array.isArray(result.labels) ? result.labels : [];
  if (acting && labels.includes(LABELS[acting])) {
    lines.push(`Hedge carried this out when the issue was filed (label ${LABELS[acting]}).`);
  }
  if (acting && Number.isFinite(budgets[acting])) {
    lines.push(`Error budget: at most ${trimPct(budgets[acting])} of these actions are wrong (certified on held-out tickets).`);
  }
  if (Number.isFinite(result.searched)) lines.push(`Searched the ${result.searched} most recent earlier issues in this project.`);
  if (result.copyOf) lines.push(`Repeats the text of ${result.copyOf}.`);
  const candidates = (result.candidates ?? []).map((c) => ({ key: c.key, score: Number(c.score).toFixed(2) }));
  return { lozenge: LOZENGE[decision], headline, reason: result.reason ?? '', lines, candidates };
}

// Bars and choices for one action on the admin page.
export function dialView(setting) {
  const options = setting?.options ?? [];
  return {
    choices: options.map((o) => ({ name: 'budget', value: String(o.alpha), label: o.label })),
    selected: String(setting?.budget ?? ''),
    bars: options.map((o) => ({ budget: trimPct(o.alpha), coverage: +(o.coverage * 100).toFixed(1) })),
    anyCertified: options.some((o) => o.certified),
  };
}

// Rows of the recent-decisions table.
export function logRows(log) {
  return (Array.isArray(log) ? log : []).map((e, i) => ({
    key: `${e.at}-${e.issueKey}-${i}`,
    cells: [
      { key: 'at', content: String(e.at ?? '').replace('T', ' ').slice(0, 16) },
      { key: 'issue', content: e.issueKey },
      { key: 'decision', content: e.decision },
      { key: 'score', content: Number.isFinite(e.score) ? e.score.toFixed(3) : '' },
      { key: 'budget', content: Number.isFinite(e.budget) ? trimPct(e.budget) : '' },
      { key: 'via', content: e.via },
      { key: 'applied', content: e.applied === true ? 'yes' : e.applied === false ? 'failed' : '' },
    ],
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
  if (reviewed === 0) {
    return { text: "No one has reviewed one of Hedge's actions yet. Mark calls right or wrong from the Hedge panel on an issue.", warn: false };
  }
  const rate = wrong / reviewed;
  const plural = reviewed === 1 ? 'action' : 'actions';
  let text = `People reviewed ${reviewed} of Hedge's ${plural} and marked ${wrong} wrong (${trimPct(rate)}).`;
  const over = Number.isFinite(budget) && rate > budget;
  if (Number.isFinite(budget)) text += ` The budget is ${trimPct(budget)}.`;
  if (reviewed < FEW_REVIEWS) text += ` ${reviewed} reviews are too few to tell a ${trimPct(budget ?? 0.03)} budget apart from chance.`;
  return { text, warn: over && reviewed >= FEW_REVIEWS };
}
