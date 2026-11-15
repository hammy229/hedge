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
