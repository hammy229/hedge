# Data

Every number on this page comes from one run of `python -m hedge.extract` over the
2025-06-23 release of the dataset (Zenodo 15719919, zip 5.81 GB) on Nov 16, 2026. The run
took 261 seconds on a laptop and wrote a 701 MB gzipped JSON Lines file of slim issue
records. Neither file is committed (see .gitignore).

```bash
cd ml
../.venv/bin/python -m hedge.extract ~/Datasets/public-jira/ThePublicJiraDataset.zip \
    --out ../data/issues.jsonl.gz --stats ../data/stats.json
```

The zip is streamed (zip member, then gzip, then `hedge.archive.read_archive`), so nothing
is unzipped or restored into MongoDB.

## Source

Montgomery, Lüders and Maalej, "An Alternative Issue Tracking Dataset of Public Jira
Repositories", MSR 2022 ([arXiv 2201.08368](https://arxiv.org/abs/2201.08368)). Each
document is a raw Jira REST v2 issue. Hedge keeps the key, Jira, project, creation time,
issue type, summary, description, component names and Duplicate links.

## Issue ids

An issue key is unique only inside one Jira. 6,052 keys name two unrelated issues in
different Jiras (TS-1 is a test ticket in RedHat and a startup script bug in Apache), so
every issue is identified as `jira:key`, and a Duplicate link resolves inside its own Jira.
59 documents were exact repeats of an issue already read and are skipped.

## Counts

| Jira | Issues | Projects | With components | With a Duplicate link |
|---|---:|---:|---:|---:|
| Apache | 1,014,909 | 646 | 714,546 | 49,147 |
| Mojang | 420,814 | 8 | 7,281 | 214,181 |
| RedHat | 352,997 | 241 | 253,161 | 11,982 |
| Jira | 274,535 | 30 | 168,778 | 34,402 |
| Qt | 148,578 | 21 | 143,231 | 7,364 |
| MongoDB | 137,150 | 27 | 79,827 | 15,470 |
| Sonatype | 87,284 | 5 | 7,475 | 671 |
| Spring | 69,156 | 80 | 48,776 | 3,191 |
| Sakai | 50,550 | 53 | 48,880 | 0 |
| JiraEcosystem | 41,866 | 101 | 14,797 | 3,076 |
| MariaDB | 31,228 | 11 | 24,454 | 2,447 |
| Hyperledger | 28,146 | 32 | 11,927 | 1,228 |
| JFrog | 15,535 | 10 | 8,230 | 1,210 |
| IntelDAOS | 9,474 | 2 | 7,421 | 475 |
| Mindville | 2,134 | 7 | 0 | 34 |
| SecondLife | 1,867 | 2 | 88 | 0 |
| **Total** | **2,686,223** | **1,276** | **1,538,872** | **344,878** |

2,471,469 issues (92%) have a non-empty description.

## Duplicate links

| Measure | Value |
|---|---:|
| Distinct Duplicate pairs (each link is stored on both issues, counted once) | 271,185 |
| Clusters from the transitive closure | 76,396 |
| Issues in a cluster | 345,170 |
| Cluster size: median, 90th, 99th percentile | 2, 5, 35 |
| Clusters of exactly two issues | 53,183 |
| Clusters above 100 issues (issues in them) | 171 (76,613) |
| Two largest clusters, both Mojang | 23,292 and 21,084 |
| Link endpoints not present in the dataset | 373 of 541,997 |

Mojang holds 62% of all duplicate-linked issues, so any headline number is also reported
without it. Its giant clusters come from catch-all tickets chained together; see
[ADR 3](adr/0003-direct-links-in-huge-clusters.md) for why clusters above 100 issues are
labeled by direct links only. With that rule, 265,789 issues have at least one earlier
duplicate to find.

Sakai and SecondLife have no Duplicate links, so they can serve only as "link nothing"
tickets and as distractors in the retrieval corpus.

## Data quality

- **Impossible creation dates.** 290 issues are dated before 2000: 289 in Apache
  (for example SPARK-574 to SPARK-578, dated in the year 10) and 1 in Jira (1982). The
  extractor treats a time outside 2000 to January 2022 as unknown. Otherwise a misdated
  issue would be the earliest member of its cluster, and so a correct answer for every later
  report. Issues with an unknown time will be left out of queries and the retrieval corpus.
- **Dangling links.** 373 link endpoints point at issues that are not in the dump (deleted
  or private). They stay in the cluster structure but can never be retrieved.
- **Component coverage is uneven.** 57% of issues have a component overall, but Mojang has
  under 2% and Mindville none, so component routing is evaluated only on Jiras where most
  issues carry one.
