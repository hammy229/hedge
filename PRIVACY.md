# Privacy

Hedge is a Jira app built on Atlassian Forge. It sends no data outside Atlassian: it has no
server of its own, no analytics, and no external network access.

## What it reads

The summary, description, creation date, project, labels and links of Jira issues. The panel,
the queue page and agents read as the person using them. The new-issue trigger, if an admin
turns it on, reads as the app. Issue text is compared in memory and not stored.

## What it stores, in Forge storage

| Data | Kept |
|---|---|
| Error budgets, the project list, the acting switch, pauses, sample-data progress | while installed |
| Decision log entries: issue key, call, reason, score | 30 days |
| The latest call shown on an issue | 180 days |
| What the trigger did to an issue | while installed |
| Verdicts and answers people give: issue key, the choice, the time, and the Atlassian account id of the person | while installed |

Account ids are the only personal data stored. They keep one person's verdict from replacing
another's. Names and email addresses are never read or stored.

The reason in a decision names issue keys, never issue text. Forge may keep an expired entry
for a short time, and Atlassian handles the stored data after the app is uninstalled.

## Questions and deletion

Open an issue at <https://github.com/hammy229/hedge/issues>. Do not put private data in it.
