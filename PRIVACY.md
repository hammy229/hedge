# Privacy

Hedge is a Jira app built on Atlassian Forge. It sends no data outside Atlassian: it has no
server of its own, no analytics, and no external network access.

## What it reads

The summary, description, creation date, project, labels and links of Jira issues. The panel,
the queue page and agents read as the person using them. The new-issue trigger, if an admin
turns it on, reads as the app, and only the new issue's own project and the list of project keys. Issue text is compared in memory and not stored.

## What it stores, in Forge storage

| Data | Kept |
|---|---|
| Error budgets, the project list, the acting switch, pauses, sample-data progress | while installed |
| Decision log entries: issue key, call, reason, scores, threshold, budget, source, whether it was carried out and why not | 30 days |
| The latest call shown on an issue | 180 days |
| What the trigger did to an issue | while installed |
| Verdicts and answers people give: issue key, the choice and the time. A verdict also has a mark for the person, described below | while installed |

No account ids, names or email addresses are stored. So that one person's verdict does not
replace another's, a verdict holds a hash of the issue key and the person's account id, keyed
with a secret made for each install and kept in Forge's encrypted storage. The mark is different
on every issue. It is pseudonymous, not anonymous: someone with the secret and a list of account
ids could match them. Answers to queued tickets hold nothing about who gave them. Earlier
versions stored account ids. They are rewritten when an admin next opens the admin page after the
update, and stay until then.

The reason in a decision names issue keys, never issue text. Forge may keep an expired entry
for a short time, and Atlassian handles the stored data after the app is uninstalled.

## Logs

Hedge's own code writes no log lines. Forge records function runs and errors, which the developer can
see to fix problems. A site admin can turn that access off in Atlassian Administration.

## Questions and deletion

Open an issue at <https://github.com/hammy229/hedge/issues>. Do not put private data in it.
