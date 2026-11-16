from hedge.dupes import UnionFind, duplicate_clusters, earlier_duplicates


def test_chained_links_form_one_cluster():
    clusters = duplicate_clusters([("A", "B"), ("C", "B"), ("D", "E")])
    assert sorted(map(sorted, clusters)) == [["A", "B", "C"], ["D", "E"]]


def test_self_links_and_repeats_are_harmless():
    assert duplicate_clusters([("A", "A")]) == []
    assert duplicate_clusters([("A", "B"), ("B", "A"), ("A", "B")]) == [{"A", "B"}]


def test_union_find_merges_large_chains():
    uf = UnionFind()
    for i in range(1000):
        uf.union(i, i + 1)
    assert uf.find(0) == uf.find(1000)
    assert len(uf.groups()) == 1


def test_earlier_duplicates_respects_time():
    clusters = [{"A", "B", "C"}]
    created = {"A": 3.0, "B": 1.0, "C": 2.0}
    out = earlier_duplicates(clusters, created)
    assert out == {"B": set(), "C": {"B"}, "A": {"B", "C"}}


def test_same_timestamp_is_not_earlier():
    out = earlier_duplicates([{"A", "B"}], {"A": 1.0, "B": 1.0})
    assert out == {"A": set(), "B": set()}


def test_undated_issues_are_dropped():
    out = earlier_duplicates([{"A", "B", "C"}], {"A": 1.0, "C": 2.0})
    assert out == {"A": set(), "C": {"A"}}


def test_small_clusters_keep_the_transitive_closure():
    from hedge.dupes import duplicate_labels

    links = [("A", "B"), ("B", "C")]
    created = {"A": 1, "B": 2, "C": 3}
    assert duplicate_labels(links, created, max_cluster=3)["C"] == {"A", "B"}


def test_huge_clusters_fall_back_to_direct_links():
    from hedge.dupes import duplicate_labels

    # Two catch-all hubs H1 and H2, each with its own reports, joined by one stray link.
    links = [("H1", f"a{i}") for i in range(5)] + [("H2", f"b{i}") for i in range(5)] + [("a4", "H2")]
    created = {"H1": 0, "H2": 1, **{f"a{i}": 10 + i for i in range(5)}, **{f"b{i}": 20 + i for i in range(5)}}
    closure = duplicate_labels(links, created, max_cluster=None)
    direct = duplicate_labels(links, created, max_cluster=5)
    assert "H1" in closure["b3"]  # the closure calls an unrelated bug a duplicate
    assert direct["b3"] == {"H2"}
    assert direct["a4"] == {"H1", "H2"}  # directly linked to both, both earlier
    assert direct["H1"] == set() and direct["H2"] == set()
    assert duplicate_labels([("X", "X")], {"X": 0}) == {}
