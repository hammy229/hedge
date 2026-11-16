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

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


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
    """Remove rows so no duplicate cluster spans two parts. Returns the split and drop counts.

    ``groups`` holds one cluster id per issue, indexed like the split; use None for an
    issue in no cluster. Which side gives up its rows matters:

    - Train rows whose cluster also appears in calibration or test are dropped. Train is the
      largest part, and a retriever fine-tuned on a cluster's pairs would otherwise be
      graded on a cluster it memorized.
    - Test rows whose cluster appears in calibration are dropped, so the realized-risk check
      on test does not reuse the outcomes the threshold was certified on.

    Test rows are never dropped for sharing a cluster with train. Doing so would delete the
    most realistic case, a new report of a long-known bug, and the retrieval corpus is
    allowed to hold every earlier issue anyway.
    """
    g = np.asarray(groups, dtype=object)

    def ids(idx: np.ndarray) -> set:
        return {x for x in g[idx].tolist() if x is not None}

    def keep(idx: np.ndarray, banned: set) -> np.ndarray:
        if not banned:
            return idx
        mask = np.array([x is None or x not in banned for x in g[idx].tolist()], dtype=bool)
        return idx[mask]

    cal_ids, test_ids = ids(split.calibration), ids(split.test)
    train = keep(split.train, cal_ids | test_ids)
    test = keep(split.test, cal_ids)
    dropped = {"train": split.train.size - train.size, "test": split.test.size - test.size}
    return Split(train, split.calibration, test), dropped
