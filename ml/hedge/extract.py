"""Stream the Public Jira Dataset into slim issue records and count what is in it.

The archive holds raw Jira REST documents with full changelogs, most of which Hedge never
reads. One pass over the zip writes a gzipped JSON Lines file with only the fields the
retriever, router and gate need, and a stats file with the counts docs/data.md reports.

    python -m hedge.extract ~/Datasets/public-jira/ThePublicJiraDataset.zip \\
        --out ../data/issues.jsonl.gz --stats ../data/stats.json

Nothing is unzipped to disk: zip member -> gzip stream -> archive reader.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
import zipfile
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path

from .archive import read_archive
from .dupes import duplicate_clusters

MEMBER = "ThePublicJiraDataset/3. DataDump/mongodump-JiraReposAnon.archive"
JIRA_TIME = "%Y-%m-%dT%H:%M:%S.%f%z"


def parse_time(value) -> float | None:
    """Epoch seconds from Jira's '2022-01-04T09:13:21.000+0000', or None if unparseable."""
    if isinstance(value, datetime):
        return value.timestamp()
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, JIRA_TIME).timestamp()
    except ValueError:
        return None


def _is_duplicate(link_type: dict) -> bool:
    # Jiras name the type "Duplicate", "Duplicates" or "duplicate"; all mean the same.
    return str(link_type.get("name", "")).lower().startswith("duplicate")


def issue_id(jira: str, key: str) -> str:
    """A dataset-wide id. Keys are only unique inside one Jira: TS-1 exists in RedHat and in
    Apache as unrelated issues, and 6,052 keys repeat across Jiras like that."""
    return f"{jira}:{key}"


def slim(jira: str, doc: dict) -> dict | None:
    """The fields Hedge uses, or None for a document that is not an issue.

    ``duplicates`` holds ids, not keys. A link names a bare key, which Jira resolves inside
    its own instance, so the linked issue lives in the same Jira.
    """
    key = doc.get("key")
    fields = doc.get("fields")
    if not isinstance(key, str) or not isinstance(fields, dict):
        return None
    dupes = set()
    for link in fields.get("issuelinks") or []:
        if not isinstance(link, dict) or not _is_duplicate(link.get("type") or {}):
            continue
        for side in ("inwardIssue", "outwardIssue"):
            other = (link.get(side) or {}).get("key")
            if isinstance(other, str) and other != key:
                dupes.add(issue_id(jira, other))
    description = fields.get("description")
    return {
        "id": issue_id(jira, key),
        "key": key,
        "jira": jira,
        "project": (fields.get("project") or {}).get("key"),
        "created": parse_time(fields.get("created")),
        "type": (fields.get("issuetype") or {}).get("name"),
        "summary": fields.get("summary") or "",
        "description": description if isinstance(description, str) else "",
        "components": sorted(
            c["name"] for c in fields.get("components") or [] if isinstance(c, dict) and "name" in c
        ),
        "duplicates": sorted(dupes),
    }


def _date(t: float | None) -> str | None:
    return None if t is None else datetime.fromtimestamp(t, timezone.utc).date().isoformat()


class Summary:
    """Running per-Jira counts, so a 2.7M issue pass never holds the issues in memory.

    Duplicate links are stored once per unordered pair, since Jira records each link on
    both of its issues.
    """

    def __init__(self) -> None:
        self.per: dict[str, Counter] = defaultdict(Counter)
        self.first: dict[str, float] = {}
        self.last: dict[str, float] = {}
        self.pairs: set[tuple[str, str]] = set()

    def add(self, r: dict) -> None:
        j = r["jira"]
        c = self.per[j]
        c["issues"] += 1
        c["with_components"] += bool(r["components"])
        c["with_description"] += bool(r["description"].strip())
        c["with_duplicate_link"] += bool(r["duplicates"])
        t = r["created"]
        if t is None:
            c["missing_created"] += 1
        else:
            self.first[j] = min(self.first.get(j, t), t)
            self.last[j] = max(self.last.get(j, t), t)
        for other in r["duplicates"]:
            self.pairs.add((min(r["id"], other), max(r["id"], other)))

    def to_dict(self) -> dict:
        clusters = duplicate_clusters(self.pairs)
        jiras = {
            j: {**dict(c), "first_created": _date(self.first.get(j)), "last_created": _date(self.last.get(j))}
            for j, c in sorted(self.per.items())
        }
        return {
            "jiras": jiras,
            "total": dict(sum(self.per.values(), Counter())),
            "duplicate_pairs": len(self.pairs),
            "duplicate_clusters": len(clusters),
            "clustered_issues": sum(len(g) for g in clusters),
            "largest_cluster": max((len(g) for g in clusters), default=0),
        }


def unique_issues(records: Iterable[dict], skipped: Counter | None = None) -> Iterator[dict]:
    """Drop repeated documents for an id already seen (59 in the dump, all exact copies)."""
    seen: set[str] = set()
    for r in records:
        if r["id"] in seen:
            if skipped is not None:
                skipped["repeated_documents"] += 1
            continue
        seen.add(r["id"])
        yield r


def stream_issues(zip_path: Path, member: str = MEMBER, skipped: Counter | None = None) -> Iterator[dict]:
    with zipfile.ZipFile(zip_path) as z, z.open(member) as raw, gzip.GzipFile(fileobj=raw) as f:
        records = (r for jira, doc in read_archive(f) if (r := slim(jira, doc)) is not None)
        yield from unique_issues(records, skipped)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("zip", type=Path, help="ThePublicJiraDataset.zip")
    ap.add_argument("--out", type=Path, required=True, help="gzipped JSON Lines of slim issues")
    ap.add_argument("--stats", type=Path, required=True, help="where to write the counts")
    ap.add_argument("--member", default=MEMBER)
    args = ap.parse_args(argv)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    summary = Summary()
    skipped: Counter = Counter()
    with gzip.open(args.out, "wt", encoding="utf-8") as out:
        for i, r in enumerate(stream_issues(args.zip, args.member, skipped), start=1):
            out.write(json.dumps(r, ensure_ascii=False) + "\n")
            summary.add(r)
            if i % 100_000 == 0:
                print(f"{i:,} issues, {time.monotonic() - start:.0f} s", file=sys.stderr, flush=True)
    stats = summary.to_dict()
    stats["skipped"] = dict(skipped)
    stats["seconds"] = round(time.monotonic() - start, 1)
    args.stats.write_text(json.dumps(stats, indent=2) + "\n")
    print(f"{stats['total'].get('issues', 0):,} issues in {stats['seconds']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
