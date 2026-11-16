"""Train, calibration and test splits over issues (as queries).

A split decides which issues act as *queries* for training, calibrating and testing. The
retrieval corpus is separate: a test query may still be matched against older training
issues, because a real triage agent searches everything filed before the new ticket.

Two splits answer two questions:

``temporal_split``
    Train on the past, calibrate on the next window, test on the latest window. Asks: does
    the guarantee survive drift over time?

``project_holdout_split``
    Test on whole Jira projects the models never saw. Asks: does Hedge work on a new team's
    Jira, such as a judge's empty site seeded with sample data?
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import numpy as np

from .leakage import cross_split_duplicates


@dataclass(frozen=True)
class Split:
    train: np.ndarray
    calibration: np.ndarray
    test: np.ndarray

    def __post_init__(self) -> None:
        parts = [set(self.train.tolist()), set(self.calibration.tolist()), set(self.test.tolist())]
        if parts[0] & parts[1] or parts[0] & parts[2] or parts[1] & parts[2]:
            raise ValueError("split parts overlap")

    def sizes(self) -> dict[str, int]:
        return {"train": self.train.size, "calibration": self.calibration.size, "test": self.test.size}


def temporal_split(created: Sequence[float], cal_start: float, test_start: float) -> Split:
    """train: created < cal_start; calibration: cal_start <= created < test_start; test: rest."""
    if cal_start > test_start:
        raise ValueError("cal_start must not be after test_start")
    t = np.asarray(created, dtype=float)
    return Split(
        train=np.flatnonzero(t < cal_start),
        calibration=np.flatnonzero((t >= cal_start) & (t < test_start)),
        test=np.flatnonzero(t >= test_start),
    )


def quantile_temporal_split(
    created: Sequence[float], cal_frac: float = 0.15, test_frac: float = 0.15
) -> Split:
    """Temporal split whose cut times sit at the given quantiles of creation time."""
    if not (cal_frac > 0 and test_frac > 0 and cal_frac + test_frac < 1):
        raise ValueError("fractions must be positive and sum to less than 1")
    t = np.asarray(created, dtype=float)
    cal_start, test_start = np.quantile(t, [1 - cal_frac - test_frac, 1 - test_frac])
    return temporal_split(t, float(cal_start), float(test_start))


def project_holdout_split(
    projects: Sequence[str],
    created: Sequence[float],
    test_projects: set[str],
    cal_frac: float = 0.15,
) -> Split:
    """Test on whole held-out projects; calibrate on the latest cal_frac of the rest.

    Calibrating on the most recent seen-project issues keeps the calibration set as close
    in time to deployment as the data allows.
    """
    p = np.asarray(projects)
    t = np.asarray(created, dtype=float)
    held = np.isin(p, list(test_projects))
    if not held.any():
        raise ValueError("no issues belong to the held-out projects")
    seen = np.flatnonzero(~held)
    cut = np.quantile(t[seen], 1 - cal_frac)
    return Split(
        train=seen[t[seen] < cut],
        calibration=seen[t[seen] >= cut],
        test=np.flatnonzero(held),
    )


def cluster_disjoint(split: Split, groups: Sequence) -> tuple[Split, dict[str, int]]:
    """Drop train rows whose duplicate cluster also appears in calibration or test.

    ``groups`` holds one cluster id per issue, indexed like the split; use None for an
    issue in no cluster. A retriever fine-tuned on a cluster's pairs would otherwise be
    graded on a cluster it memorized. Train is the largest part, so it gives up the rows.

    Calibration and test are left whole. Deployment sees new reports of bugs from every
    earlier window, so removing test rows that share a cluster with calibration would test
    a different population than the one the threshold is certified for. The learn then test
    bound needs only exchangeability between calibration and deployment, and calibration
    already certifies on one row per cluster. Use ``shares_cluster`` to report test results
    with and without that overlap.
    """
    g = _groups(groups)
    banned = _ids(g, split.calibration) | _ids(g, split.test)
    train = split.train[~_member(g, split.train, banned)]
    return Split(train, split.calibration, split.test), {"train": split.train.size - train.size}


def shares_cluster(part: np.ndarray, other: np.ndarray, groups: Sequence) -> np.ndarray:
    """Boolean mask over ``part``: rows whose cluster also has a row in ``other``."""
    g = _groups(groups)
    return _member(g, part, _ids(g, other))


def _groups(groups: Sequence) -> np.ndarray:
    # Filled element by element so tuple cluster ids stay single objects instead of
    # becoming a 2-D array.
    g = np.empty(len(groups), dtype=object)
    g[:] = list(groups)
    return g


def _ids(g: np.ndarray, idx: np.ndarray) -> set:
    return {x for x in g[idx].tolist() if x is not None}


def _member(g: np.ndarray, idx: np.ndarray, ids: set) -> np.ndarray:
    return np.array([x is not None and x in ids for x in g[idx].tolist()], dtype=bool)


def drop_copies(
    split: Split, texts: Sequence[str], project_keys: Iterable[str] | None = None
) -> tuple[Split, dict[str, int]]:
    """Drop calibration and test rows whose text is a copy of an earlier part's text.

    The same filter runs on both evaluated parts. Filtering only test would leave copies in
    calibration, where a pasted-in ticket is trivially "right" and makes the certified
    threshold look safer than it is on new tickets. Calibration is checked against train;
    test against train and calibration.
    """
    t = list(texts)

    def copies(earlier: np.ndarray, part: np.ndarray) -> np.ndarray:
        if part.size == 0:
            return part
        hits = cross_split_duplicates([t[i] for i in earlier], [t[i] for i in part], project_keys)
        return np.delete(part, hits)

    cal = copies(split.train, split.calibration)
    test = copies(np.concatenate([split.train, cal]), split.test)
    dropped = {"calibration": split.calibration.size - cal.size, "test": split.test.size - test.size}
    return Split(split.train, cal, test), dropped
