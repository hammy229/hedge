# Testing Hedge on your own site

These steps start from an empty Jira Cloud site. They take about fifteen minutes.

> Draft: written before the first deployed install. The menu paths in steps 1, 4 and 5 get
> checked against a real site when Hedge is deployed.

## 1. Install

1. Open the install link from the submission page and pick your site.
2. Approve the scopes. Hedge asks for `read:jira-work` (to read tickets as the person
   viewing them), `write:jira-work` (only for the optional sample data in step 2; Hedge
   never edits your tickets) and `storage:app` (to keep the error budget, the decision log
   and seeding progress inside Atlassian).

## 2. Add sample data

Hedge compares a new ticket against the most recent earlier issues in its project, and it
asks about every ticket until a project has 30 earlier issues: below that, too few
calibration tickets look like it ([ADR 8](adr/0008-ask-below-a-minimum-window.md)). An
empty site needs history first.

1. Create a Software project (any template), say with key `DEMO`.
2. Go to **Jira settings → Apps → Hedge error budget** (site admins only).
3. Under **Sample data**, type `DEMO` and choose **Add 150 sample issues**. Hedge creates
   150 real issues from Atlassian's public Jira Software Server tracker (Public Jira
   Dataset, CC BY 4.0), oldest first, labeled `hedge-sample`. It takes about two minutes;
   leave the page open. If you close it, choose **Continue** later and it picks up where
   it stopped.

Five of the 150 restate an earlier sample issue. In a new project they become DEMO-15,
DEMO-29, DEMO-37, DEMO-50 and DEMO-51 (the numbers shift if the project already had
issues).

## 3. The issue panel

1. Open any ticket and choose **Hedge** in the issue panel area.
2. The panel shows one of three outcomes:
   - **Cleared as new**: Hedge is confident this is not a duplicate, inside the error budget.
   - **Linked as duplicate**: Hedge certified nothing for linking, so you shouldn't see
     this. The panel says why for every ticket.
   - **Needs a person**: Hedge is not sure enough, and says why (its score against the
     certified threshold, a copied ticket, or too little history).
3. What to expect on the sample, replayed in CI (`app/test/seed.test.js`) at the default
   3% budget: 119 cleared, 31 asked about. DEMO-1 to DEMO-30 always ask (too little
   history). Of the five duplicates, DEMO-15 and DEMO-29 are asked about, and DEMO-37,
   DEMO-50 and DEMO-51 are cleared by mistake, each with the right earlier issue listed as
   its closest match. Three misses in 119 clears is 2.5%, inside the 3% budget: the
   guarantee bounds how often Hedge is wrong, it does not promise never.
4. Your own test: create ten tickets in a second, empty project, then one that restates
   the first in new words. All eleven get **Needs a person**, and the restated one lists
   the first as its closest earlier issue.

## 4. The error-budget dial

1. Go to **Jira settings → Apps → Hedge error budget** (site admins only).
2. The chart shows how many held-out tickets Hedge would act on at each budget.
3. Pick 2.5% and the sample gets 114 clears instead of 119. Pick 2%: nothing was
   certified at 2%, so Hedge asks about every ticket. Pick 3.5% and it acts on more.
4. **Recent decisions** lists each decision with its score, budget and source (panel or MCP).

## 5. Through an agent (Atlassian MCP, optional)

1. In **Atlassian Administration → Apps → Sites → Connected apps**, open Hedge and turn on
   "Expose tools via external MCP endpoint".
2. Add `https://mcp.atlassian.com/forge/<appId>` to an MCP client such as Claude Desktop
   (the app id is on the submission page).
3. Ask it: "Use Hedge to triage PROJ-12." The tool returns the same decision as the panel,
   and the decision shows up in the admin page log with source `mcp`.
4. Ask "What guarantee does Hedge give?" to call `explain-policy`.
