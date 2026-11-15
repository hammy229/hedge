# Security policy

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/hammy229/hedge/security/advisories/new)
rather than in a public issue. I will reply within a week.

Hedge runs inside Atlassian Forge. It reads Jira issues as the invoking user, so a tool call
can never see more than that user can. The app stores no credentials.
