// Plain-data views for the UI Kit screens, kept out of the JSX so node:test can check them.

const LOZENGE = {
  link: { text: 'Linked as duplicate', appearance: 'moved' },
  clear: { text: 'Cleared as new', appearance: 'success' },
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
  const headline =
    decision === 'link'
      ? `Hedge linked this as a duplicate of ${result.duplicateOf}.`
      : decision === 'clear'
        ? 'Hedge cleared this as a new report, so nobody needs to check it for duplicates.'
        : 'Hedge is not sure enough to act, so a person should check this ticket.';
  const lines = [];
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
