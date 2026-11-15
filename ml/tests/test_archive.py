import gzip
import io
import struct

import bson
import pytest

from hedge.archive import MAGIC, TERMINATOR, ArchiveError, read_archive


def build_archive(blocks, gz=False):
    """A mongodump-style archive: magic, prelude, then (collection, docs, eof) blocks."""
    out = io.BytesIO()
    out.write(struct.pack("<I", MAGIC))
    out.write(bson.encode({"concurrent_collections": 4, "version": "0.1"}))
    for name in {b[0] for b in blocks}:
        out.write(bson.encode({"db": "JiraRepos", "collection": name, "metadata": "{}"}))
    out.write(TERMINATOR)
    for name, docs, eof in blocks:
        out.write(bson.encode({"db": "JiraRepos", "collection": name, "EOF": eof, "CRC": 0}))
        for d in docs:
            out.write(bson.encode(d))
        out.write(TERMINATOR)
    raw = out.getvalue()
    return io.BytesIO(gzip.compress(raw) if gz else raw)


BLOCKS = [
    ("Apache", [{"key": "HDFS-1"}, {"key": "HDFS-2"}], False),
    ("MongoDB", [{"key": "SERVER-9"}], False),
    ("Apache", [{"key": "SPARK-3"}], False),  # collections interleave
    ("Apache", [], True),
    ("MongoDB", [], True),
]


def test_reads_interleaved_blocks_in_order():
    out = list(read_archive(build_archive(BLOCKS)))
    assert out == [
        ("Apache", {"key": "HDFS-1"}),
        ("Apache", {"key": "HDFS-2"}),
        ("MongoDB", {"key": "SERVER-9"}),
        ("Apache", {"key": "SPARK-3"}),
    ]


def test_filters_collections():
    keys = [d["key"] for _, d in read_archive(build_archive(BLOCKS), {"MongoDB"})]
    assert keys == ["SERVER-9"]


def test_streams_through_gzip():
    f = gzip.GzipFile(fileobj=build_archive(BLOCKS, gz=True))
    assert len(list(read_archive(f))) == 4


def test_rejects_non_archives_and_truncation():
    with pytest.raises(ArchiveError):
        list(read_archive(io.BytesIO(b"PK\x03\x04 not an archive")))
    data = build_archive(BLOCKS).getvalue()
    with pytest.raises(ArchiveError):
        list(read_archive(io.BytesIO(data[:-20])))


def test_many_blocks_do_not_slow_down():
    blocks = [("Apache", [{"i": i}], False) for i in range(5000)]
    assert sum(1 for _ in read_archive(build_archive(blocks))) == 5000
