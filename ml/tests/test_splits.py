import numpy as np
import pytest

from hedge.splits import Split, project_holdout_split, quantile_temporal_split, temporal_split


def test_temporal_split_boundaries():
    s = temporal_split([1, 2, 3, 4, 5, 6], cal_start=3, test_start=5)
    assert s.train.tolist() == [0, 1]
    assert s.calibration.tolist() == [2, 3]
    assert s.test.tolist() == [4, 5]


def test_temporal_split_never_trains_on_the_future():
    rng = np.random.default_rng(0)
    t = rng.uniform(0, 100, size=1000)
    s = quantile_temporal_split(t, cal_frac=0.2, test_frac=0.2)
    assert t[s.train].max() < t[s.calibration].min()
    assert t[s.calibration].max() < t[s.test].min()
    assert s.train.size + s.calibration.size + s.test.size == 1000
    assert 150 < s.test.size < 250


def test_project_holdout_keeps_projects_apart():
    projects = ["HDFS"] * 4 + ["SPARK"] * 4 + ["KAFKA"] * 2
    created = list(range(10))
    s = project_holdout_split(projects, created, test_projects={"KAFKA"}, cal_frac=0.25)
    p = np.asarray(projects)
    assert set(p[s.test]) == {"KAFKA"}
    assert "KAFKA" not in set(p[s.train]) | set(p[s.calibration])
    assert max(s.train) < min(s.calibration)  # calibration is the latest seen-project slice


def test_overlapping_parts_are_rejected():
    with pytest.raises(ValueError):
        Split(np.array([0, 1]), np.array([1]), np.array([2]))


def test_bad_arguments():
    with pytest.raises(ValueError):
        temporal_split([1, 2], cal_start=5, test_start=3)
    with pytest.raises(ValueError):
        project_holdout_split(["A"], [1.0], test_projects={"B"})
    for cal, test in [(0.0, 0.2), (0.2, 0.0), (0.6, 0.5)]:
        with pytest.raises(ValueError):
            quantile_temporal_split([1, 2, 3], cal_frac=cal, test_frac=test)


def test_cluster_disjoint_drops_train_and_test_rows_only():
    from hedge.splits import cluster_disjoint

    #          0     1     2     3     4     5     6     7
    groups = ["a", "b", None, "c", "a", "b", None, "c"]
    s = Split(train=np.array([0, 1, 2]), calibration=np.array([3, 4]), test=np.array([5, 6, 7]))
    out, dropped = cluster_disjoint(s, groups)
    assert out.train.tolist() == [2]  # 0 shares "a" with calibration, 1 shares "b" with test
    assert out.calibration.tolist() == [3, 4]  # calibration is never touched
    assert out.test.tolist() == [5, 6]  # 7 shares "c" with calibration; 5 shares only with train
    assert dropped == {"train": 2, "test": 1}
    g = np.asarray(groups, dtype=object)
    parts = [set(g[out.train]) - {None}, set(g[out.calibration]) - {None}, set(g[out.test]) - {None}]
    assert not (parts[0] & parts[1]) and not (parts[0] & parts[2]) and not (parts[1] & parts[2])


def test_cluster_disjoint_without_clusters_is_a_no_op():
    from hedge.splits import cluster_disjoint

    s = temporal_split([1, 2, 3, 4], cal_start=2, test_start=3)
    out, dropped = cluster_disjoint(s, [None] * 4)
    assert (out.train.tolist(), out.test.tolist()) == (s.train.tolist(), s.test.tolist())
    assert dropped == {"train": 0, "test": 0}
