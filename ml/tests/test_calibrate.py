import json

import numpy as np
import pytest

from hedge.calibrate import build_policy, main
from hedge.features import FEATURE_NAMES


def rows(n, seed=0, signal=3.0):
    """Synthetic tickets where a big margin means the top candidate is the true duplicate."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        margin = rng.exponential(2.0)
        right = int(rng.uniform() < 1 / (1 + np.exp(-(signal * (margin - 2.0)))))
        out.append(
            {
                "split": "train" if i < n // 2 else "calibration",
                "right": right,
                "top1": 10 + margin + rng.normal(),
                "margin": margin,
                "entropy": float(np.exp(-margin)),
                "summaryWords": float(rng.integers(3, 15)),
                "hasDescription": float(rng.uniform() < 0.8),
            }
        )
    return out


def test_policy_from_informative_features_acts_on_some_tickets():
    policy = build_policy(rows(6000), alpha=0.05, delta=0.1)
    assert policy["calibrated"] is True
    assert 0.1 < policy["calibrationCoverage"] < 0.9
    assert set(policy["model"]["weights"]) == set(FEATURE_NAMES)


def test_useless_features_never_get_certified():
    policy = build_policy(rows(3000, signal=0.0), alpha=0.05, delta=0.1)
    assert policy["calibrated"] is False


def test_missing_split_is_an_error():
    with pytest.raises(ValueError):
        build_policy([r | {"split": "train"} for r in rows(100)], alpha=0.05, delta=0.1)


@pytest.mark.parametrize("bad", [{"split": "calib"}, {"right": 2}, {"right": None}])
def test_bad_rows_are_errors_not_silently_dropped(bad):
    data = rows(200)
    data[150] = data[150] | bad
    with pytest.raises(ValueError, match="row 150"):
        build_policy(data, alpha=0.05, delta=0.1)


def test_groups_shrink_the_calibration_set_to_one_row_each():
    data = rows(6000)
    grouped = [r | {"group": i // 3} for i, r in enumerate(data)]
    policy = build_policy(grouped, alpha=0.05, delta=0.1)
    assert policy["calibrationSize"] == 1000  # 3000 calibration rows in groups of 3
    assert policy["calibrationActed"] >= policy["calibrationErrors"] >= 0


def test_cli_writes_an_importable_policy(tmp_path, capsys):
    path = tmp_path / "rows.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows(4000)) + "\n")
    out = tmp_path / "policy.js"
    assert main([str(path), "--alpha", "0.05", "--out", str(out)]) == 0
    body = out.read_text().split("export default ", 1)[1].rstrip().rstrip(";")
    assert json.loads(body)["calibrated"] is True
    assert "acts on" in capsys.readouterr().out
