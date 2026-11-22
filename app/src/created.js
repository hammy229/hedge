// The issue trigger: when someone files an issue, triage it and carry out the decision
// (act.js), if an admin turned acting on. The trigger has no calling user, so it reads and
// writes as the app. Kept apart from index.js, which imports Forge, so node:test can run
// it with fakes.

export async function onCreated(event, { readAutoAct, triage, apply }) {
  const key = event?.issue?.key;
  if (typeof key !== 'string' || key === '') return { skipped: 'The event names no issue.' };
  if (!(await readAutoAct())) return { skipped: 'Acting on new issues is off.' };
  return triage(key, 'trigger', 'app', apply);
}
