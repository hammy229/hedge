// Local preview page. The words and structure of the panel and the dial come from
// src/view.js, the same module the Jira app renders, so this page cannot drift from it.
import { ACTION_TEXT, CHART_NOTE, PANEL_TEXT, dialView, panelView, verdictStatus } from '/src/view.js';

const state = { view: 'issues', budget: null, data: null, settings: null, selected: 'DEMO-50', filter: 'all', verdicts: {} };
const app = document.getElementById('app');

// h('div.card', { onclick }, child, ...) with text set through textContent only.
function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
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
const decisionOf = (issue) => issue.result.decision;

// Static JSON per budget (preview/build.js writes it; preview/server.js serves the same
// paths live), so the page can be hosted anywhere.
const json = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error(`${path} returned ${r.status}`);
  return r.json();
});

async function load(budget) {
  const b = budget ?? (await json('/data/index.json')).default;
  const [data, settings] = await Promise.all([json(`/data/replay-${b}.json`), json(`/data/settings-${b}.json`)]);
  state.data = data;
  state.settings = settings;
  state.budget = data.budget;
  render();
}

function lozenge(decision) {
  const v = panelView({ decision });
  return h(`span.lozenge.${decision}`, {}, v.lozenge.text);
}

function select(key) {
  state.selected = key;
  state.view = 'issues';
  render();
  document.querySelector('.issue')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const FILTERS = [
  ['all', 'All'],
  ['clear', 'New report'],
  ['ask', 'Needs a person'],
  ['dup', 'Known duplicates'],
];

function issueList() {
  const shown = state.data.issues.filter((i) =>
    state.filter === 'all' ? true : state.filter === 'dup' ? i.knownDuplicateOf.length > 0 : decisionOf(i) === state.filter,
  );
  return h(
    'section.card.list',
    { 'aria-label': 'Sample issues' },
    h(
      'div.filters',
      {},
      FILTERS.map(([id, label]) =>
        h('button.chip', { type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; render(); } }, label),
      ),
    ),
    h(
      'ul.rows',
      {},
      shown.map((i) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', 'aria-current': String(i.key === state.selected), onclick: () => select(i.key) },
            h('span.key', {}, i.key),
            h('span.sum', { title: i.summary }, i.summary),
            lozenge(decisionOf(i)),
          ),
        ),
      ),
    ),
  );
}

function verdict(key, counts) {
  const s = verdictStatus(state.verdicts[key] ?? 'idle', counts, null);
  if (s.done) return h('p.thanks', {}, s.text);
  const mark = (v) => () => { state.verdicts[key] = v; render(); };
  return h(
    'div.verdict',
    {},
    h('b', {}, PANEL_TEXT.verdictQuestion),
    h('button.btn', { type: 'button', onclick: mark('right') }, 'Right'),
    h('button.btn', { type: 'button', onclick: mark('wrong') }, 'Wrong'),
  );
}

function truth(issue) {
  const dup = issue.knownDuplicateOf;
  const d = decisionOf(issue);
  if (dup.length === 0) {
    return h('div.truth', {}, h('p.eyebrow', {}, 'Known answer'), 'Not marked as a duplicate in the dataset.');
  }
  const wrong = d === 'clear';
  return h(
    `div.truth${wrong ? '.bad' : ''}`,
    {},
    h('p.eyebrow', {}, 'Known answer'),
    `The dataset links this as a duplicate of ${dup.join(', ')}. `,
    wrong
      ? h('span', {}, h('span.lozenge.wrong', {}, 'Hedge was wrong'), ' It cleared a duplicate. The budget bounds how often this happens; it does not promise never.')
      : h('span', {}, 'Hedge asked a person instead of acting, which is the safe outcome.'),
  );
}

function issueDetail() {
  const issue = state.data.issues.find((i) => i.key === state.selected) ?? state.data.issues[0];
  const v = panelView(issue.result);
  return h(
    'article.card.issue',
    {},
    h('div.meta', {}, h('span', {}, issue.key), h('span', {}, '·'), h('span', {}, `from ${issue.source}`)),
    h('h1', {}, issue.summary),
    h('div.desc', {}, issue.description || 'No description.'),
    h(
      'section.panel',
      { 'aria-label': 'Hedge panel' },
      h('div.panel-title', {}, 'Hedge', h('small', {}, 'PANEL')),
      h(`div.call.${v.decision}`, {}, lozenge(v.decision), h('h2', {}, v.headline), v.carriedOut ? h('p', {}, v.carriedOut) : null),
      v.budget ? h('div.budget', {}, h('strong', {}, v.budget.value), h('div', {}, h('p.eyebrow', {}, PANEL_TEXT.budgetTitle), h('p', {}, v.budget.text))) : null,
      v.nextStep ? h('div.next', {}, h('b', {}, PANEL_TEXT.nextStepTitle), v.nextStep) : null,
      v.reasons.length ? h('div.why', {}, h('p.eyebrow', {}, PANEL_TEXT.whyTitle), v.reasons.map((r) => h('p', {}, r.label ? h('b', {}, `${r.label}: `) : null, r.text))) : null,
      v.candidates.length
        ? h(
            'div',
            {},
            h('p.eyebrow', {}, PANEL_TEXT.candidatesTitle),
            h(
              'ul.card.cands',
              {},
              v.candidates.map((c) =>
                h(
                  'li',
                  {},
                  h('span', {}, h('button', { type: 'button', onclick: () => select(c.key) }, c.key), ' ', c.isMatch ? h('span.lozenge.link', {}, PANEL_TEXT.match) : null),
                  h('span.score', {}, c.score),
                ),
              ),
            ),
            h('p.note', {}, PANEL_TEXT.candidatesNote),
          )
        : null,
      v.notes.map((n) => h('p.note', {}, n)),
      truth(issue),
      verdict(issue.key, v.verdictCounts),
    ),
  );
}

function adminView() {
  const { counts, missed, issues } = state.data;
  const dups = issues.filter((i) => i.knownDuplicateOf.length > 0);
  const clear = state.settings.clear;
  const dial = dialView(clear);
  const max = Math.max(...dial.bars.map((b) => b.coverage), 1);
  const cleared = counts.clear;
  return h(
    'div',
    {},
    h(
      'section.hero',
      {},
      h('p.eyebrow', {}, 'Calibrated triage'),
      h('h1', {}, 'Hedge acts only inside the error rate you set, and asks a person about the rest.'),
      h('p', {}, 'Each certified budget below was checked on held-out tickets with 90% confidence. Pick one and the sample project is replayed at that budget.'),
    ),
    h(
      'div.tiles',
      {},
      [
        ['Budget', clear.options.find((o) => o.alpha === state.budget)?.certified ? pct(state.budget) : 'Always asks', ''],
        ['Cleared as new', String(cleared), ''],
        ['Sent to a person', String(counts.ask), ''],
        ['Duplicates cleared by mistake', `${missed.length} of ${dups.length}`, 'spark'],
        ['Wrong among clears', cleared ? pct(missed.length / cleared) : 'none', ''],
      ].map(([label, value, cls]) => h('div.card.tile', {}, h('p.eyebrow', {}, label), h(`div.v${cls ? `.${cls}` : ''}`, {}, value))),
    ),
    h(
      'section.card.section',
      {},
      h('h2', {}, ACTION_TEXT.clear.title),
      h('p', {}, `${ACTION_TEXT.clear.blurb} ${dial.current}`),
      h(
        'div.bars',
        { role: 'img', 'aria-label': 'Share of held-out tickets Hedge acts on at each budget' },
        dial.bars.map((b, i) =>
          h(`div.bar${dial.choices[i]?.value === dial.selected ? '.on' : ''}`, {}, h('span', {}, `${b.coverage}%`), h('i', { style: `height:${(b.coverage / max) * 85}%` })),
        ),
      ),
      h('div.axis', {}, dial.bars.map((b) => h('span', {}, b.budget))),
      h('p.note', {}, CHART_NOTE),
      h(
        'div.radios',
        { role: 'radiogroup', 'aria-label': 'Error budget' },
        dial.choices.map((c) =>
          h(
            'label',
            {},
            h('input', { type: 'radio', name: 'budget', value: c.value, checked: c.value === dial.selected, onchange: () => load(Number(c.value)) }),
            c.label,
          ),
        ),
      ),
    ),
    h(
      'section.card.section',
      {},
      h('h2', {}, ACTION_TEXT.link.title),
      h('p', {}, state.settings.link.guarantee),
    ),
    h(
      'section.card.section',
      {},
      h('h2', {}, 'Where Hedge was wrong'),
      h('p', {}, `The sample has ${dups.length} known duplicates. At this budget Hedge cleared ${missed.length} of them by mistake and asked a person about the rest.`),
      h(
        'ul.misses',
        {},
        dups.map((i) =>
          h(
            'li',
            {},
            h('button', { type: 'button', onclick: () => select(i.key) }, i.key),
            ` duplicates ${i.knownDuplicateOf.join(', ')}: `,
            lozenge(decisionOf(i)),
            missed.includes(i.key) ? h('span', {}, ' ', h('span.lozenge.wrong', {}, 'wrong')) : null,
          ),
        ),
      ),
    ),
  );
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  app.replaceChildren(state.view === 'issues' ? h('div.split', {}, issueList(), issueDetail()) : adminView());
  document.getElementById('foot').textContent = state.data.attribution;
}

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    render();
    window.scrollTo({ top: 0 });
  }),
);

load(null).catch((e) => {
  app.replaceChildren(h('p.muted', {}, `The preview server did not answer (${e.message}). Run npm run preview in app/.`));
});
