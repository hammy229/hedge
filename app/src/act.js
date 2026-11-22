// Carry out a triage decision on its issue, so Hedge's call is visible in Jira itself.
//
//   clear  label hedge-cleared: a new report, nobody needs to check it for duplicates
//   link   a Duplicate link to the top candidate, then label hedge-linked
//   ask    label hedge-ask, so `labels = hedge-ask` is the queue a person works through
//
// Labels are added, never set, so the issue's own labels stay. Nothing here decides: the
// gate already did, and an error or an unknown decision changes nothing. A Jira failure
// comes back as { applied: false, error } so the trigger can log it instead of retrying.

export const LABELS = Object.freeze({ clear: 'hedge-cleared', link: 'hedge-linked', ask: 'hedge-ask' });

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
    if (decision === 'link') {
      // Jira shows the inward issue as "duplicates" the outward one.
      await jira(route`/rest/api/2/issueLink`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          type: { name: 'Duplicate' },
          inwardIssue: { key: issueKey },
          outwardIssue: { key: result.duplicateOf },
        }),
      });
    }
    await jira(route`/rest/api/2/issue/${issueKey}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ update: { labels: [{ add: LABELS[decision] }] } }),
    });
  } catch (e) {
    return { applied: false, error: String(e?.message ?? e) };
  }
  const out = { applied: true, label: LABELS[decision] };
  if (decision === 'link') out.duplicateOf = result.duplicateOf;
  return out;
}
