// Hedge demo page. The panel's words come from src/view.js, the module the Jira app
// renders, so this page cannot drift from it. Data is the sample project replayed at each
// budget (preview/replay.js), loaded as static JSON.
import { LIMIT, evidence } from '/src/evidence.js';
import { ACTION_TEXT, PANEL_TEXT, dialView, panelView, verdictStatus } from '/src/view.js';

const state = { budget: null, budgets: [], data: null, settings: null, selected: 'DEMO-50', filter: 'all', verdicts: {} };

// h('div.card', { onclick }, child, ...) with text set through textContent only.
function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElementNS(name === 'svg' || name === 'rect' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', name);
  if (classes.length) el.setAttribute('class', classes.join(' '));
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const pct = (x) => `${+(x * 100).toFixed(2)}%`;
const json = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  return r.json();
});

async function load(budget) {
  if (!state.budgets.length) {
    const index = await json('/data/index.json');
    state.budgets = index.budgets;
    budget ??= index.default;
  }
  const [data, settings] = await Promise.all([json(`/data/replay-${budget}.json`), json(`/data/settings-${budget}.json`)]);
  Object.assign(state, { data, settings, budget: data.budget });
  render();
}

// What a square, a row or a lozenge is: the call, and whether the dataset says it was wrong.
function kindOf(issue) {
  const d = issue.result.decision;
  if (d === 'clear' && issue.knownDuplicateOf.length > 0) return 'wrong';
  return d;
}

function lozenge(decision) {
  return h(`span.lozenge.${decision}`, {}, panelView({ decision }).lozenge.text);
}

function budgetSwitch(label) {
  const certified = new Set(state.settings.clear.options.filter((o) => o.certified).map((o) => o.alpha));
  return h(
    'div.switch',
    { role: 'radiogroup', 'aria-label': label },
    state.budgets.map((b) =>
      h(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': String(b === state.budget), title: certified.has(b) ? `${pct(b)} budget` : `${pct(b)}: nothing certified`, onclick: () => load(b) },
        pct(b),
      ),
    ),
  );
}

function select(key, scroll = true) {
  state.selected = key;
  renderExplorer();
  document.querySelector('.rows [aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  if (scroll) document.getElementById('try').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- hero: one square per sample issue ---------- */
const KIND_TEXT = { clear: 'cleared as new', ask: 'sent to a person', link: 'called a duplicate', wrong: 'cleared, but it is a duplicate' };

function renderField() {
  const { issues, counts, missed } = state.data;
  const readout = h('p.field-readout', { 'aria-live': 'polite' }, 'Point at a square to see the issue. Click to open it.');
  const show = (i) => {
    readout.replaceChildren(h('span.k', {}, i.key), ` ${KIND_TEXT[kindOf(i)]}: `, h('span.s', {}, i.summary));
  };
  const grid = h(
    'div.squares',
    {},
    issues.map((i) =>
      h('button', {
        type: 'button',
        class: `sq ${kindOf(i)}`,
        'aria-label': `${i.key}, ${KIND_TEXT[kindOf(i)]}`,
        onmouseenter: () => show(i),
        onfocus: () => show(i),
        onclick: () => select(i.key),
      }),
    ),
  );
  document.getElementById('field').replaceChildren(
    budgetSwitch('Error budget for the grid'),
    grid,
    h(
      'figcaption',
      {},
      h(
        'ul.legend',
        {},
        h('li', {}, h('i.sq.clear'), `${counts.clear - missed.length} cleared`),
        h('li', {}, h('i.sq.ask'), `${counts.ask} sent to a person`),
        h('li', {}, h('i.sq.wrong'), `${missed.length} wrong`),
      ),
      readout,
      h('p.field-note', {}, 'The first 30 always go to a person: below 30 earlier issues, Hedge has too little history to compare against.'),
    ),
  );
}

/* ---------- try it: list and panel ---------- */
const FILTERS = [['all', 'All'], ['clear', 'New report'], ['ask', 'Needs a person'], ['dup', 'Known duplicates']];

function issueList() {
  const shown = state.data.issues.filter((i) =>
    state.filter === 'all' ? true : state.filter === 'dup' ? i.knownDuplicateOf.length > 0 : i.result.decision === state.filter,
  );
  return h(
    'section.list',
    { 'aria-label': 'Sample issues' },
    h('div.filters', {}, FILTERS.map(([id, label]) =>
      h('button.chip', { type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; renderExplorer(); } }, label))),
    h('ul.rows', {}, shown.map((i) =>
      h('li', {}, h('button', { type: 'button', 'aria-current': String(i.key === state.selected), onclick: () => select(i.key, false) },
        h('span.key', {}, i.key), h('span.sum', { title: i.summary }, i.summary),
        kindOf(i) === 'wrong' ? h('span.lozenge.wrong', {}, 'Wrong') : lozenge(i.result.decision))))),
  );
}

function verdict(key, counts) {
  const s = verdictStatus(state.verdicts[key] ?? 'idle', counts, null);
  if (s.done) return h('p.thanks', {}, s.text);
  const mark = (v) => () => { state.verdicts[key] = v; renderExplorer(); };
  return h('div.verdict', {}, h('b', {}, PANEL_TEXT.verdictQuestion),
    h('button.btn', { type: 'button', onclick: mark('right') }, 'Right'),
    h('button.btn', { type: 'button', onclick: mark('wrong') }, 'Wrong'));
}

function truth(issue) {
  const dup = issue.knownDuplicateOf;
  if (dup.length === 0) return h('div.truth', {}, h('b', {}, 'Known answer. '), 'Not marked as a duplicate in the dataset.');
  const wrong = issue.result.decision === 'clear';
  return h(`div.truth${wrong ? '.bad' : ''}`, {}, h('b', {}, 'Known answer. '), `The dataset links this as a duplicate of ${dup.join(', ')}. `,
    wrong ? 'Hedge cleared it anyway: one of the mistakes the budget allows.' : 'Hedge asked a person instead of acting, the safe outcome.');
}

function issueDetail() {
  const issue = state.data.issues.find((i) => i.key === state.selected) ?? state.data.issues[0];
  const v = panelView(issue.result);
  return h('article.issue', {},
    h('p.meta', {}, `${issue.key} · from ${issue.source}`),
    h('h3', {}, issue.summary),
    h('div.desc', {}, issue.description || 'No description.'),
    h('section.panel', { 'aria-label': 'Hedge panel' },
      h(`div.call.${v.decision}`, {}, lozenge(v.decision), h('p.headline', {}, v.headline)),
      v.budget ? h('div.budget', {}, h('strong', {}, v.budget.value), h('p', {}, v.budget.text)) : null,
      v.nextStep ? h('div.next', {}, h('b', {}, `${PANEL_TEXT.nextStepTitle}. `), v.nextStep) : null,
      v.reasons.length ? h('div.why', {}, h('p.label', {}, PANEL_TEXT.whyTitle), v.reasons.map((r) => h('p', {}, r.label ? h('b', {}, `${r.label}: `) : null, r.text))) : null,
      v.candidates.length ? h('div', {}, h('p.label', {}, PANEL_TEXT.candidatesTitle),
        h('ul.cands', {}, v.candidates.map((c) => h('li', {},
          h('span', {}, h('button', { type: 'button', onclick: () => select(c.key, false) }, c.key), c.isMatch ? h('span.lozenge.link', {}, PANEL_TEXT.match) : null),
          h('span.score', {}, c.score)))),
        h('p.note', {}, PANEL_TEXT.candidatesNote)) : null,
      v.notes.map((n) => h('p.note', {}, n)),
      truth(issue),
      verdict(issue.key, v.verdictCounts)));
}

function renderExplorer() {
  document.getElementById('explorer').replaceChildren(h('div.explorer', {}, issueList(), issueDetail()));
}

/* ---------- the dial ---------- */
function bars(caption, rows) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return h('figure.hbars', {},
    h('figcaption', {}, caption),
    h('dl', {}, rows.map((r) => h(`div${r.on ? '.on' : ''}`, {},
      h('dt', {}, r.name),
      h('dd', {}, h(`span.bar${r.baseline ? '.is-baseline' : ''}`, { style: `width:${Math.max((r.value / max) * 100, 0.6)}%` }), h('span.v', {}, r.label))))));
}

function renderDial() {
  const { counts, missed, issues } = state.data;
  const dups = issues.filter((i) => i.knownDuplicateOf.length > 0);
  const clear = state.settings.clear;
  const dial = dialView(clear);
  const rows = clear.options.map((o) => ({
    name: `${pct(o.alpha)} budget`,
    value: o.coverage,
    label: o.certified ? `${(o.coverage * 100).toFixed(1)}%` : 'nothing certified',
    on: o.alpha === state.budget,
  }));
  document.getElementById('dial').replaceChildren(
    budgetSwitch('Error budget'),
    h('dl.facts.facts-tight', {},
      h('div', {}, h('dt', {}, String(counts.clear - missed.length)), h('dd', {}, 'sample issues cleared correctly')),
      h('div', {}, h('dt', {}, String(counts.ask)), h('dd', {}, 'sent to a person, with the reason')),
      h('div', {}, h('dt.bad', {}, `${missed.length} of ${dups.length}`), h('dd', {}, 'known duplicates cleared by mistake')),
      h('div', {}, h('dt', {}, counts.clear ? pct(missed.length / counts.clear) : 'none'), h('dd', {}, `of clears wrong, against a ${pct(state.budget)} budget`))),
    bars(`${ACTION_TEXT.clear.title}: share of held-out calibration tickets Hedge acts on at each budget`, rows),
    h('p.foot', {}, `${dial.current} Each bar is a budget you can pick; its length is the share of held-out calibration tickets Hedge would clear at that budget. Linking duplicates: ${state.settings.link.guarantee.charAt(0).toLowerCase()}${state.settings.link.guarantee.slice(1)}`),
  );
}

/* ---------- the breaker: verdicts against the budget ---------- */
const BREAKER_BUDGET = 0.03;
const review = { verdicts: [], paused: null };

function addVerdict(wrong) {
  if (review.paused) return;
  review.verdicts.push({ wrong, budget: BREAKER_BUDGET });
  const e = evidence(review.verdicts);
  if (e.over) review.paused = e;
}

function simulate(rate) {
  Object.assign(review, { verdicts: [], paused: null });
  for (let i = 0; i < 200 && !review.paused; i += 1) addVerdict(Math.random() < rate);
  renderBreaker();
}

function renderBreaker() {
  const e = evidence(review.verdicts);
  const value = Math.exp(e.log);
  const width = Math.max(0, Math.min(100, (e.log / Math.log(LIMIT)) * 100));
  const shown = value >= 1000 ? 'over 1,000' : value.toFixed(value < 10 ? 2 : 0);
  const press = (wrong) => () => { addVerdict(wrong); renderBreaker(); };
  const status = review.paused
    ? `Paused after ${e.reviewed} verdicts, ${e.wrong} of them wrong. Hedge now asks about every ticket.`
    : e.reviewed === 0
      ? 'No verdicts yet. Mark some calls, or simulate 200 of them.'
      : `${e.reviewed} verdict${e.reviewed === 1 ? '' : 's'}, ${e.wrong} wrong (${pct(e.wrong / e.reviewed)}). Hedge keeps acting.`;
  document.getElementById('breaker').replaceChildren(
    h('div.breaker', {},
      h('p.label', {}, `Budget ${pct(BREAKER_BUDGET)}. Was this call right?`),
      h('div.breaker-row', {},
        h('button.btn', { type: 'button', disabled: !!review.paused, onclick: press(false) }, 'Right'),
        h('button.btn', { type: 'button', disabled: !!review.paused, onclick: press(true) }, 'Wrong')),
      h('div.meter', { role: 'meter', 'aria-label': 'Evidence that Hedge is over budget', 'aria-valuemin': '0', 'aria-valuemax': String(LIMIT), 'aria-valuenow': String(Math.min(value, LIMIT).toFixed(2)) },
        h(`span${review.paused ? '.over' : ''}`, { style: `width:${width}%` })),
      h('p.note', {}, `Evidence ${shown}. Hedge pauses at ${LIMIT}. The bar fills on a log scale and is empty at 1 or less.`),
      h(`p.breaker-status${review.paused ? '.bad' : ''}`, { 'aria-live': 'polite' }, status),
      h('div.breaker-row', {},
        h('button.chip', { type: 'button', onclick: () => simulate(BREAKER_BUDGET) }, 'Simulate 200 calls, 3% wrong'),
        h('button.chip', { type: 'button', onclick: () => simulate(0.15) }, 'Simulate 200 calls, 15% wrong'),
        h('button.chip', { type: 'button', onclick: () => { Object.assign(review, { verdicts: [], paused: null }); renderBreaker(); } }, 'Start over'))),
  );
}

function renderResults() {
  document.getElementById('results-bars').replaceWith(
    Object.assign(bars('Risk-coverage area on test tickets with every tracker included, lower is better', [
      { name: 'Hedge gate', value: 0.066, label: '0.066' },
      { name: 'Raw top BM25 score', value: 0.133, label: '0.133', baseline: true },
    ]), { id: 'results-bars' }),
  );
}

function render() {
  renderField();
  renderExplorer();
  renderDial();
  document.getElementById('foot').textContent = state.data.attribution;
}

/* ---------- rail: the section in the middle of the window is current ---------- */
const links = [...document.querySelectorAll('.rail li a')];
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    for (const a of links) a.toggleAttribute('aria-current', a.getAttribute('href') === `#${e.target.id}`);
    for (const a of links) if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'location');
  }
}, { rootMargin: '-45% 0px -50% 0px' });
for (const a of links) {
  const section = document.querySelector(a.getAttribute('href'));
  if (section) observer.observe(section);
}

renderResults();
renderBreaker();
load(null).catch((e) => {
  document.getElementById('field').replaceChildren(h('p.muted', {}, `The demo data did not load (${e.message}).`));
});
