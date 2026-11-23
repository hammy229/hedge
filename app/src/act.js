// Carry out a triage decision on its issue, so Hedge's call is visible in Jira itself.
//
//   clear  label hedge-cleared: a new report, nobody needs to check it for duplicates
//   link   label hedge-duplicate; the panel names the original and a person makes the link
//   ask    label hedge-ask, so `labels = hedge-ask` is the queue a person works through
//
// The trigger writes as the app, which can see issues the reporter cannot (security
// levels, restricted projects). A link written by the app would show the reporter the key
// and summary of such an issue, so Hedge never creates the link itself.
//
// Labels are added, never set, so the issue's own labels stay. Nothing here decides: the
// gate already did, and an error or an unknown decision changes nothing. A Jira failure
// comes back as { applied: false, error } so the trigger can log it instead of retrying.

// The seeder's label (seeder.js), here so the trigger can skip sample issues without
// importing the 150 shipped issues.
export const SAMPLE_LABEL = 'hedge-sample';

export const LABELS = Object.freeze({ clear: 'hedge-cleared', link: 'hedge-duplicate', ask: 'hedge-ask' });

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

export async function applyDecision(result, jira, route) {
  const issueKey = result?.issueKey;
  const decision = result?.decision;
  if (result?.error || !ISSUE_KEY.test(String(issueKey ?? '')) || !LABELS[decision]) {
    return { applied: false, error: 'No decision to apply.' };
  }
  if (decision === 'link' && !ISSUE_KEY.test(String(result.duplicateOf ?? ''))) {
    return { applied: false, error: 'A link decision needs the issue it duplicates.' };
  }
  try {
    await jira(route`/rest/api/2/issue/${issueKey}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ update: { labels: [{ add: LABELS[decision] }] } }),
    });
  } catch (e) {
    return { applied: false, error: writeError(e) };
  }
  const out = { applied: true, label: LABELS[decision] };
  if (decision === 'link') out.duplicateOf = result.duplicateOf;
  return out;
}

// A person marked a call Hedge carried out as wrong: swap its label for hedge-ask, so the
// ticket goes to the queue instead of staying cleared. Called as that person, so Jira's own
// permissions decide whether they may edit the issue. The verdict is saved either way.
export async function requeue(saved, jira, route) {
  const label = LABELS[saved?.decision];
  if (saved?.verdict !== 'wrong' || saved.applied !== true || !label || saved.decision === 'ask') return null;
  return editLabels(saved.issueKey, [{ remove: label }, { add: LABELS.ask }], jira, route);
}

// A person answered a ticket in the queue, so it leaves it.
export function leaveQueue(issueKey, jira, route) {
  return editLabels(issueKey, [{ remove: LABELS.ask }], jira, route);
}

async function editLabels(issueKey, labels, jira, route) {
  try {
    await jira(route`/rest/api/2/issue/${issueKey}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ update: { labels } }) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: writeError(e) };
  }
}

// The result reaches the panel, the agent and the log, so Jira's text stays out of it:
// only a known cause, or the status. Jira answers 400 with errors.labels when the project's
// edit screen has no Labels field, which an admin can fix in a minute.
export const NO_LABELS_FIELD =
  "This project's edit screen has no Labels field, so Hedge could not label the issue. Add Labels to the screen, or leave acting off for this project.";

function writeError(e) {
  if (e?.jiraBody?.errors && typeof e.jiraBody.errors === 'object' && 'labels' in e.jiraBody.errors) return NO_LABELS_FIELD;
  if (Number.isInteger(e?.status)) return `Jira returned ${e.status}`;
  const m = /^Jira returned \d{3}/.exec(String(e?.message ?? ''));
  return m ? m[0] : 'Jira could not be updated.';
}
