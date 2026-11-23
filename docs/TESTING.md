# Testing Hedge on your own site

These steps start from an empty Jira Cloud site. They take about fifteen minutes.

> Steps 2 to 5 were checked on a deployed install on Nov 22 2026, except steps 5.5 to 5.7,
> which are new and covered by unit tests so far. Step 1 (the install link)
> and the MCP steps in 6 get checked when the production build is shared.

## 1. Install

1. Open the install link from the submission page and pick your site.
2. Approve the scopes. Hedge asks for `read:jira-work` (to read tickets as the person
   viewing them), `write:jira-work` (for the optional sample data in step 2, and for the
   labels Hedge adds in step 5 if you turn acting on; it is off on a fresh install, so until
   then Hedge never edits your tickets) and `storage:app` (to keep the error budget, the
   decision log, verdicts and seeding progress inside Atlassian).

## 2. Add sample data

Hedge compares a new ticket against the most recent earlier issues in its project, and it
asks about every ticket until a project has 30 earlier issues: below that, too few
calibration tickets look like it ([ADR 8](adr/0008-ask-below-a-minimum-window.md)). An
empty site needs history first.

1. Create a Software project (any template), say with key `DEMO`.
2. Go to **Settings (gear, top right) → Apps**, then **Hedge error budget** under Apps in the left sidebar (site admins only).
3. Under **Sample data**, type `DEMO` and choose **Add 150 sample issues**. Hedge creates
   150 real issues from Atlassian's public Jira Software Server tracker (Public Jira
   Dataset, CC BY 4.0), oldest first, labeled `hedge-sample`. It takes about two minutes;
   leave the page open. If you close it, choose **Continue** later and it picks up where
   it stopped. Sample issues are never acted on, even with acting turned on in step 5.

Five of the 150 restate an earlier sample issue. In a new project they become DEMO-15,
DEMO-29, DEMO-37, DEMO-50 and DEMO-51 (the numbers shift if the project already had
issues).

## 3. The issue panel

1. Open any ticket and choose **Hedge** in the issue panel area.
2. The panel shows one of three outcomes:
   - **New report**: Hedge is confident this is not a duplicate, inside the error budget,
     which the panel shows in its own card.
   - **Duplicate**: Hedge certified nothing for duplicates, so you shouldn't see this.
   - **Needs a person**: Hedge is not sure enough. Under **Why** it gives each check's
     reason (its score against the certified threshold, a copied ticket, or too little
     history), and **What to do next** says which earlier issues to compare it with.
   Every outcome lists the closest earlier issues as links, with Hedge's match marked.
3. What to expect on the sample, replayed in CI (`app/test/seed.test.js`) at the default
   3% budget: 119 cleared, 31 asked about. DEMO-1 to DEMO-30 always ask (too little
   history). Of the five duplicates, DEMO-15 and DEMO-29 are asked about, and DEMO-37,
   DEMO-50 and DEMO-51 are cleared by mistake, each with the right earlier issue listed as
   its closest match. Three misses in 119 clears is 2.5%, inside the 3% budget: the
   guarantee bounds how often Hedge is wrong, it does not promise never.
4. Under **Was this call right?**, choose **Right** or **Wrong**. The admin page counts
   verdicts against the budget only for calls Hedge carried out (step 5).
5. Your own test: create ten tickets in a second, empty project, then one that restates
   the first in new words. All eleven get **Needs a person**, and the restated one lists
   the first as its closest earlier issue.

## 4. The error-budget dial

1. Go to **Settings (gear, top right) → Apps**, then **Hedge error budget** under Apps in the left sidebar (site admins only).
2. The chart shows how many held-out tickets Hedge would act on at each budget.
3. Pick 2.5% and the sample gets 114 clears instead of 119. Pick 2%: nothing was
   certified at 2%, so Hedge asks about every ticket. Pick 3.5% and it acts on more.
4. **Recent decisions** lists each decision with its score, budget, source (issue panel,
   agent or new issue) and whether it was carried out.

## 5. Let Hedge act on new issues (optional)

1. On the admin page, turn on **Act on new issues**. It is off on a fresh install.
2. Create a new ticket in `DEMO`. Within a few seconds Hedge triages it and adds one label:
   `hedge-cleared` for a new report, `hedge-ask` for one a person must decide, or
   `hedge-duplicate` for a likely duplicate (Hedge never writes the link itself, since the
   app can see issues the reporter might not). The panel on that ticket now says Hedge
   carried the call out.
3. Search `labels = hedge-ask` to see the queue Hedge left for people.
4. To keep Hedge to some projects, type their keys under **Only in these projects** (for
   example `DEMO`) and choose **Save projects**. Leave it empty to act in every project.
   If a project's edit screen has no Labels field, Hedge cannot label its issues: the
   admin log marks them **Failed** and says how to add the field.
5. On a ticket labeled `hedge-ask`, choose **New report** or **Duplicate** in the panel. The
   label comes off, and **Waiting for a person** on the admin page goes down.
6. On a ticket labeled `hedge-cleared`, choose **Wrong**. Its label becomes `hedge-ask`.
7. Do that on a second cleared ticket, with no right verdicts in between. Two wrong calls out
   of two are too many for a 3% budget, so Hedge pauses: every ticket now gets **Needs a
   person**, and the admin page shows a banner with **Resume**.
8. Mark a few calls right or wrong in the panel; **What people said** on the admin
   page compares the share marked wrong with the budget, and says when there are too few
   reviews to tell.

## 6. Through an agent (Rovo or Atlassian MCP, optional)

In Rovo chat, pick the **Hedge** agent and ask "Is DEMO-50 a duplicate?" It calls the same
`triage-issue` action as the panel, so it reports the same call, and it only reports: it
never edits the ticket.

For an external agent over MCP:


1. In **Atlassian Administration → Apps → Sites → Connected apps**, open Hedge and turn on
   "Expose tools via external MCP endpoint".
2. Add `https://mcp.atlassian.com/forge/<appId>` to an MCP client such as Claude Desktop
   (the app id is on the submission page).
3. Ask it: "Use Hedge to triage PROJ-12." The tool returns the same decision as the panel,
   and the decision shows up in the admin page log with source `mcp`.
4. Ask "What guarantee does Hedge give?" to call `explain-policy`.
