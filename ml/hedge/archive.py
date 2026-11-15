"""Stream documents out of a ``mongodump --archive`` file without running MongoDB.

The Public Jira Dataset ships as one gzipped mongodump archive (about 60 GB once restored).
Restoring it needs a MongoDB server and the disk space; reading the archive format directly
needs neither. Layout, from mongo-tools' archive package:

    magic        uint32 little-endian 0x8199e26d
    prelude      BSON docs (archive header, then one metadata doc per collection), then
                 a terminator
    body         repeated blocks: a namespace header BSON doc {db, collection, EOF, CRC},
                 then that collection's BSON docs, then a terminator

A terminator is the 4 bytes ff ff ff ff, which can never start a BSON document because a
document's first 4 bytes are its (positive) length.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from typing import BinaryIO

import bson

MAGIC = 0x8199E26D
TERMINATOR = b"\xff\xff\xff\xff"
END = object()  # clean end of stream between blocks


class ArchiveError(ValueError):
    pass


def _read_exact(f: BinaryIO, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = f.read(n - len(buf))
        if not chunk:
            raise ArchiveError(f"archive ended early: wanted {n} bytes, got {len(buf)}")
        buf += chunk
    return bytes(buf)


def _next_doc(f: BinaryIO, eof_ok: bool = False):
    """Raw bytes of the next BSON document, None at a terminator, END at a clean EOF."""
    head = f.read(4)
    if not head and eof_ok:
        return END
    if head == TERMINATOR:
        return None
    if len(head) < 4:
        head += _read_exact(f, 4 - len(head))
    (length,) = struct.unpack("<i", head)
    if length < 5:
        raise ArchiveError(f"bad BSON document length {length}")
    return head + _read_exact(f, length - 4)


def read_archive(
    f: BinaryIO, collections: set[str] | None = None
) -> Iterator[tuple[str, dict]]:
    """Yield (collection, document) pairs in archive order.

    Documents in collections outside ``collections`` are skipped without being decoded,
    which is most of the cost when only a few Jira repositories are wanted.
    """
    magic = f.read(4)
    if len(magic) < 4 or struct.unpack("<I", magic)[0] != MAGIC:
        raise ArchiveError("not a mongodump archive (bad magic number)")
    while True:  # prelude: archive header and collection metadata
        doc = _next_doc(f)
        if doc is None:
            break
        if doc is END:
            return
    while True:
        header_raw = _next_doc(f, eof_ok=True)
        if header_raw is END:
            return
        if header_raw is None:
            continue  # tolerate empty blocks
        header = bson.decode(header_raw)
        name = header.get("collection", "")
        wanted = (collections is None or name in collections) and not header.get("EOF")
        while (raw := _next_doc(f)) is not None:
            if wanted:
                yield name, bson.decode(raw)
