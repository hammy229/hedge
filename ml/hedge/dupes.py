"""Turn typed Duplicate links into the labels Hedge trains and tests on.

Jira users link duplicates one pair at a time, often chaining A -> B and C -> B, so the
real unit is a cluster: every issue reported about the same underlying bug. Clusters are
built with union-find over the links.

The triage task follows from the clusters. When issue q is created, the issues that could
be its duplicates are the ones already filed. q's correct answers are the earlier members
of its cluster. If q is the first of its cluster, or in no cluster, the correct action is
to link nothing.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Hashable, Iterable, Mapping


class UnionFind:
    """Disjoint sets with path halving and union by size."""

    def __init__(self) -> None:
        self._parent: dict[Hashable, Hashable] = {}
        self._size: dict[Hashable, int] = {}

    def add(self, x: Hashable) -> None:
        if x not in self._parent:
            self._parent[x] = x
            self._size[x] = 1

    def find(self, x: Hashable) -> Hashable:
        self.add(x)
        while self._parent[x] != x:
            self._parent[x] = self._parent[self._parent[x]]
            x = self._parent[x]
        return x

    def union(self, a: Hashable, b: Hashable) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self._size[ra] < self._size[rb]:
            ra, rb = rb, ra
        self._parent[rb] = ra
        self._size[ra] += self._size[rb]

    def groups(self) -> list[set[Hashable]]:
        out: dict[Hashable, set[Hashable]] = defaultdict(set)
        for x in self._parent:
            out[self.find(x)].add(x)
        return list(out.values())


def duplicate_clusters(links: Iterable[tuple[str, str]]) -> list[set[str]]:
    """Clusters of two or more issues joined by Duplicate links. Self-links are ignored."""
    uf = UnionFind()
    for a, b in links:
        if a != b:
            uf.union(a, b)
    return [g for g in uf.groups() if len(g) > 1]


def earlier_duplicates(
    clusters: Iterable[set[str]], created: Mapping[str, float]
) -> dict[str, set[str]]:
    """For every clustered issue, the members of its cluster created strictly before it.

    Issues missing a creation time are dropped, since their position in time is unknown.
    The first issue of each cluster maps to an empty set: it is a new report.
    """
    out: dict[str, set[str]] = {}
    for cluster in clusters:
        dated = sorted((created[k], k) for k in cluster if k in created)
        for i, (t, key) in enumerate(dated):
            out[key] = {k for tk, k in dated[:i] if tk < t}
    return out


def duplicate_labels(
    links: Iterable[tuple[str, str]],
    created: Mapping[str, float],
    max_cluster: int | None = 100,
) -> dict[str, set[str]]:
    """Like ``earlier_duplicates``, but distrusts the transitive closure of huge clusters.

    Union-find merges every chain of links. In the Public Jira Dataset that is right for
    almost every cluster (median size 2, 99th percentile 35) and wrong for a few: Mojang's
    catch-all tickets such as "Multiplayer Connection Issues and Workarounds" collect
    thousands of direct duplicates each, and chains between those hubs build clusters of
    over 20,000 issues about unrelated bugs. In a cluster larger than ``max_cluster`` an
    issue's correct answers are only the earlier issues it is directly linked to.
    ``max_cluster=None`` keeps the full closure everywhere.
    """
    links = [(a, b) for a, b in links if a != b]
    clusters = duplicate_clusters(links)
    if max_cluster is None:
        return earlier_duplicates(clusters, created)
    labels = earlier_duplicates([c for c in clusters if len(c) <= max_cluster], created)
    big = {k for c in clusters if len(c) > max_cluster for k in c}
    neighbors: dict[str, set[str]] = defaultdict(set)
    for a, b in links:
        if a in big:
            neighbors[a].add(b)
            neighbors[b].add(a)
    for key in big:
        if key in created:
            t = created[key]
            labels[key] = {n for n in neighbors[key] if n in created and created[n] < t}
    return labels
