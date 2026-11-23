// Hedge stops itself. When people's verdicts show an action is over its error budget
// (evidence.js), that action is paused: its gate closes, so the panel, the trigger, the
// Rovo agent and MCP tools all ask a person instead, until an admin resumes it.
//
// A pause is latched. Later right verdicts do not lift it, because the test's false alarm
// rate covers the first crossing, not a race between crossings. Resuming starts the
// evidence over: only calls Hedge makes after the resume count.
//
// Anyone who can open an issue's panel can give verdicts, so anyone can help pause Hedge.
// That is the safe direction; only the admin page can resume. If the pause state cannot be
// read, both actions count as paused.

import { evidence } from './evidence.js';
import { feedbackWith, perIssue } from './feedback.js';
import { ACTIONS } from './settings.js';

const key = (action) => `pause:${action}`;
const UNREADABLE = Object.freeze({ paused: true, unreadable: true });

const readable = (p) => p && typeof p === 'object' && typeof p.paused === 'boolean';

export async function readPauses(store) {
  const entries = await Promise.all(
    ACTIONS.map(async (action) => {
      try {
        const saved = await store.get(key(action));
        if (saved === undefined || saved === null) return [action, { paused: false }];
        return [action, readable(saved) ? saved : UNREADABLE];
      } catch {
        return [action, UNREADABLE];
      }
    }),
  );
  return Object.fromEntries(entries);
}

const pct = (x) => `${+(x * 100).toFixed(2)}%`;
const calls = (action, n) => `${n} ${action} call${n === 1 ? '' : 's'}`;

export function pauseReason(action, pause) {
  if (pause?.unreadable) return 'Hedge could not read whether it is paused.';
  const budget = Number.isFinite(pause?.budget) ? `its ${pct(pause.budget)} error budget` : 'its error budget';
  return `Hedge paused itself: people marked ${pause?.wrong} of the ${calls(action, pause?.reviewed)} they reviewed wrong, too many for ${budget}.`;
}

// Close the gate of every paused action.
export function withPauses(policies, pauses) {
  return Object.fromEntries(
    ACTIONS.map((a) => {
      const p = pauses?.[a] ?? UNREADABLE;
      if (p.paused === false) return [a, policies?.[a]];
      return [a, { ...policies?.[a], calibrated: false, threshold: null, closedBecause: pauseReason(a, p) }];
    }),
  );
}

// The verdicts that count for one action: calls the trigger carried out since the last
// resume. Calls logged before verdicts kept their time and budget are left out.
export function counted(feedback, action, since) {
  return perIssue(feedback)
    .filter((f) => f?.decision === action && f.applied === true && typeof f.decidedAt === 'string')
    .filter((f) => typeof since !== 'string' || f.decidedAt > since)
    .map((f) => ({ wrong: f.verdict === 'wrong', budget: f.budget }));
}

// Run after each verdict is saved, with every verdict including that one. Storage errors
// are thrown, so the person sees the failure and the next try runs the check again.
export async function checkEvidence(store, feedback, action, at = new Date().toISOString()) {
  if (!ACTIONS.includes(action)) return { paused: false };
  const saved = await store.get(key(action));
  if (saved?.paused === true) return { ...saved, already: true };
  const verdicts = counted(feedback, action, saved?.since);
  const e = evidence(verdicts);
  if (!e.over) return { paused: false };
  const budgets = verdicts.map((v) => v.budget).filter(Number.isFinite);
  const pause = { paused: true, at, reviewed: e.reviewed, wrong: e.wrong };
  // Named only when every call was made under the same budget.
  if (new Set(budgets).size === 1) pause.budget = budgets[0];
  await store.set(key(action), pause);
  return pause;
}

// Verdicts given at the same moment may each miss the other in the list, so the trigger and
// the admin page check again.
export async function recheck(store) {
  const feedback = await feedbackWith(store);
  for (const action of ACTIONS) await checkEvidence(store, feedback, action);
}

export async function resume(store, action, at = new Date().toISOString()) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action ${action}.`);
  // Resuming what is not paused would only throw the evidence away.
  if ((await readPauses(store))[action].paused) await store.set(key(action), { paused: false, since: at });
  return readPauses(store);
}
