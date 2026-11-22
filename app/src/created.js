// The issue trigger: when someone files an issue, triage it and carry out the decision
// (act.js), if an admin turned acting on. The trigger has no calling user, so it reads and
// writes as the app. Kept apart from index.js, which imports Forge, so node:test can run
// it with fakes.
//
// Skipped without a triage:
//   - sample issues (label hedge-sample) and anything filed while seeding runs in that
//     project: 150 creates in two minutes would mean 150 full window reads at once, and the
//     first ones always ask, which would fill the hedge-ask queue with sample tickets;
//   - subtasks, which are pieces of an issue, not new reports;
//   - an issue the trigger already handled, since Forge may deliver an event twice;
//   - a triage that could not read Jira: its "ask" says nothing about the ticket, and a
//     label would stick, because the trigger only fires on create.

import { SAMPLE_LABEL } from './act.js';

export async function onCreated(event, { readAutoAct, triage, apply, alreadyHandled, seeding }) {
  const issue = event?.issue;
  const key = issue?.key;
  if (typeof key !== 'string' || key === '') return { skipped: 'The event names no issue.' };
  if (!(await readAutoAct())) return { skipped: 'Acting on new issues is off.' };
  const labels = Array.isArray(issue.fields?.labels) ? issue.fields.labels : [];
  if (labels.includes(SAMPLE_LABEL)) return { skipped: 'Sample issues are not acted on.' };
  if (issue.fields?.issuetype?.subtask === true) return { skipped: 'Subtasks are not acted on.' };
  const projectKey = issue.fields?.project?.key ?? key.replace(/-\d+$/, '');
  if (await seeding(projectKey)) return { skipped: 'Sample data is being added to this project.' };
  if (await alreadyHandled(key)) return { skipped: 'This issue was already handled.' };
  return triage(key, 'trigger', 'app', (result) => {
    if (result.failed) return { applied: false, error: 'Jira could not be read, so nothing was changed.' };
    // Jira's create event does not carry labels, so the check above rarely fires; the
    // triage read the issue's labels, so check them again before changing anything.
    if (Array.isArray(result.labels) && result.labels.includes(SAMPLE_LABEL)) {
      return { applied: false, error: 'Sample issues are not acted on.' };
    }
    return apply(result);
  });
}
