// The sample project, replayed through the app's own triage with no Jira: the same 150
// issues the admin page seeds, created in order, each scored against the issues before it,
// exactly as test/seed.test.js checks in CI. Each issue also carries the known answer from
// the dataset, so the preview can show where Hedge was wrong.

import { budgetOptions } from '../src/budget.js';
import { describePolicy } from '../src/gate.js';
import policies from '../src/policy.js';
import seed from '../src/seed.js';
import { activePolicies } from '../src/settings.js';
import { triage } from '../src/triage.js';

const T0 = Date.parse('2026-12-01T00:00:00Z');
const PROJECT = 'DEMO';

const issues = seed.issues.map((s, i) => ({
  key: `${PROJECT}-${i + 1}`,
  fields: { summary: s.summary, description: s.description, created: new Date(T0 + i * 2000).toISOString().replace('Z', '+0000') },
}));

const offered = () => budgetOptions(policies.clear).map((o) => o.alpha);
const cache = new Map();

export function replay(clear = policies.clear.alpha) {
  if (!offered().includes(clear)) throw new Error(`${clear} is not a budget the policy offers.`);
  if (cache.has(clear)) return cache.get(clear);
  const budgets = { link: policies.link.alpha, clear };
  const active = activePolicies(policies, budgets);
  const counts = { link: 0, clear: 0, ask: 0 };
  const missed = [];
  const out = issues.map((issue, i) => {
    const result = {
      issueKey: issue.key,
      summary: issue.fields.summary,
      ...triage({ issue, window: issues.slice(0, i), projectKeys: [PROJECT], policies: active }),
      budgets,
    };
    counts[result.decision] += 1;
    const knownDuplicateOf = seed.issues[i].duplicateOf.map((j) => issues[j].key);
    if (knownDuplicateOf.length > 0 && result.decision === 'clear') missed.push(issue.key);
    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description,
      source: seed.issues[i].source,
      knownDuplicateOf,
      result,
    };
  });
  const r = { budget: clear, counts, missed, attribution: seed.attribution, issues: out };
  cache.set(clear, r);
  return r;
}

// What the admin page's settings resolver returns, for the chosen clear budget.
export function settingsFor(clear = policies.clear.alpha) {
  const active = activePolicies(policies, { link: policies.link.alpha, clear });
  return Object.fromEntries(
    ['clear', 'link'].map((a) => [
      a,
      {
        budget: a === 'clear' ? clear : policies.link.alpha,
        options: budgetOptions(policies[a]),
        guarantee: describePolicy(active[a]).guarantee,
        minWindow: policies[a]?.minWindow,
      },
    ]),
  );
}
