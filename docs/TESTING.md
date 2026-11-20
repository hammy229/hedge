# Testing Hedge on your own site

These steps start from an empty Jira Cloud site. They take about ten minutes.

> Draft: written before the first deployed install. The menu paths in steps 1, 4 and 5 get
> checked against a real site when Hedge is deployed.

## 1. Install

1. Open the install link from the submission page and pick your site.
2. Approve the scopes. Hedge asks for `read:jira-work` (to read tickets as the person
   viewing them) and `storage:app` (to keep the error budget and the decision log inside
   Atlassian). It never writes to your tickets.

## 2. Make a few tickets

Hedge compares a new ticket against the most recent earlier issues in its project, so a
project needs some history.

1. Create a Software project (any template).
2. Create about ten tickets about different things, for example "Login page times out on
   Safari" or "Export to CSV drops the last row".
3. Create one more that restates an earlier one in new words, for example "Safari users
   can't log in, the page just spins".

## 3. The issue panel

1. Open any ticket and choose **Hedge** in the issue panel area.
2. The panel shows one of three outcomes:
   - **Cleared as new**: Hedge is confident this is not a duplicate, inside the error budget.
   - **Linked as duplicate**: Hedge certified nothing for linking, so you shouldn't see
     this. The panel says why for every ticket.
   - **Needs a person**: Hedge is not sure enough, and says why (its score against the
     certified threshold, a copied ticket, or too little history).
3. Open the restated ticket from step 2.3. Its closest earlier issue should be the one it
   restates.

Small projects mostly get **Needs a person**. That's intended. The gate learned that a
match score from a ten-issue window says little, and it asks instead of guessing.

## 4. The error-budget dial

1. Go to **Jira settings → Apps → Hedge error budget** (site admins only).
2. The chart shows how many held-out tickets Hedge would act on at each budget.
3. Pick 2% and reopen a ticket: Hedge acts on fewer tickets. Pick 3.5% and it acts on more.
4. **Recent decisions** lists each decision with its score, budget and source (panel or MCP).

## 5. Through an agent (Atlassian MCP, optional)

1. In **Atlassian Administration → Apps → Sites → Connected apps**, open Hedge and turn on
   "Expose tools via external MCP endpoint".
2. Add `https://mcp.atlassian.com/forge/<appId>` to an MCP client such as Claude Desktop
   (the app id is on the submission page).
3. Ask it: "Use Hedge to triage PROJ-12." The tool returns the same decision as the panel,
   and the decision shows up in the admin page log with source `mcp`.
4. Ask "What guarantee does Hedge give?" to call `explain-policy`.
