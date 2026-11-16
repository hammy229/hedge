import gzip
import io
import json
import struct
import zipfile

import bson
import pytest

from hedge.archive import MAGIC, TERMINATOR
from hedge.extract import Summary, main, parse_time, slim


def issue(key, created="2022-01-04T09:13:21.000+0000", links=(), components=(), description="text"):
    return {
        "key": key,
        "fields": {
            "created": created,
            "project": {"key": key.split("-")[0]},
            "issuetype": {"name": "Bug"},
            "summary": f"summary of {key}",
            "description": description,
            "components": [{"name": c} for c in components],
            "issuelinks": list(links),
        },
    }


def dup(side, other, name="Duplicate"):
    return {"type": {"name": name}, side: {"key": other}}


def test_parse_time():
    assert parse_time("1970-01-01T00:00:10.000+0000") == 10.0
    assert parse_time("2022-01-04T10:13:21.000+0100") == parse_time("2022-01-04T09:13:21.000+0000")
    assert parse_time("not a date") is None and parse_time(None) is None


def test_slim_keeps_only_duplicate_links_both_directions():
    doc = issue(
        "HDFS-2",
        links=[
            dup("outwardIssue", "HDFS-1"),
            dup("inwardIssue", "HDFS-3", name="Duplicates"),
            {"type": {"name": "Blocker"}, "outwardIssue": {"key": "HDFS-9"}},
            dup("outwardIssue", "HDFS-2"),  # a self-link is noise
        ],
        components=["namenode", "client"],
    )
    r = slim("Apache", doc)
    assert r["duplicates"] == ["HDFS-1", "HDFS-3"]
    assert r["components"] == ["client", "namenode"]
    assert r["project"] == "HDFS" and r["jira"] == "Apache" and r["type"] == "Bug"


def test_slim_skips_non_issues_and_tolerates_nulls():
    assert slim("Apache", {"_id": 1}) is None
    doc = issue("X-1")
    doc["fields"].update(description=None, components=None, issuelinks=None, created=None)
    r = slim("Apache", doc)
    assert r["description"] == "" and r["components"] == [] and r["created"] is None


def test_summary_counts_each_link_once():
    s = Summary()
    a = slim("Apache", issue("A-1", links=[dup("outwardIssue", "A-2")], components=["ui"]))
    b = slim("Apache", issue("A-2", links=[dup("inwardIssue", "A-1")], description=""))
    c = slim("Mongo", issue("M-1", created="bad"))
    for r in (a, b, c):
        s.add(r)
    out = s.to_dict()
    assert out["duplicate_pairs"] == 1 and out["duplicate_clusters"] == 1
    assert out["clustered_issues"] == 2 and out["largest_cluster"] == 2
    assert out["jiras"]["Apache"]["issues"] == 2
    assert out["jiras"]["Apache"]["with_components"] == 1
    assert out["jiras"]["Apache"]["with_description"] == 1
    assert out["jiras"]["Mongo"]["missing_created"] == 1
    assert out["jiras"]["Apache"]["first_created"] == "2022-01-04"
    assert out["total"]["issues"] == 3


def test_main_streams_a_zipped_archive(tmp_path):
    raw = io.BytesIO()
    raw.write(struct.pack("<I", MAGIC))
    raw.write(bson.encode({"version": "0.1"}))
    raw.write(TERMINATOR)
    raw.write(bson.encode({"db": "JiraRepos", "collection": "Apache", "EOF": False, "CRC": 0}))
    for d in (issue("A-1", links=[dup("outwardIssue", "A-2")]), issue("A-2"), {"_id": "junk"}):
        raw.write(bson.encode(d))
    raw.write(TERMINATOR)
    zpath = tmp_path / "data.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        z.writestr("dump.archive", gzip.compress(raw.getvalue()))
    out, stats = tmp_path / "issues.jsonl.gz", tmp_path / "stats.json"
    assert main([str(zpath), "--out", str(out), "--stats", str(stats), "--member", "dump.archive"]) == 0
    with gzip.open(out, "rt") as f:
        rows = [json.loads(line) for line in f]
    assert [r["key"] for r in rows] == ["A-1", "A-2"]
    assert json.loads(stats.read_text())["duplicate_pairs"] == 1


@pytest.mark.parametrize("name", ["Duplicate", "duplicate", "Duplicates"])
def test_duplicate_type_names(name):
    assert slim("J", issue("A-1", links=[dup("outwardIssue", "A-2", name=name)]))["duplicates"] == ["A-2"]
