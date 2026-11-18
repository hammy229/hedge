import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from hedge.gate import fit_gate, policy_dict, write_policies, write_policy
from hedge.risk import NEVER_ACT, Threshold
from hedge.window import RETRIEVER

APP = Path(__file__).resolve().parents[2] / "app"


def data(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    X = np.column_stack([rng.normal(10, 3, n), rng.normal(0, 1, n), rng.uniform(size=n)])
    logit = 0.8 * (X[:, 0] - 10) - 1.5 * X[:, 1]  # third feature is noise
    y = (rng.uniform(size=n) < 1 / (1 + np.exp(-logit))).astype(float)
    return X, y


def test_recovers_true_weights_on_raw_scale():
    X, y = data()
    m = fit_gate(X, y, ["a", "b", "noise"], l2=1e-3)
    np.testing.assert_allclose(m.weights[:2], [0.8, -1.5], atol=0.12)
    assert abs(m.weights[2]) < 0.3
    assert m.bias == pytest.approx(-8.0, abs=1.2)


def test_strong_penalty_shrinks_toward_constant():
    X, y = data()
    m = fit_gate(X, y, ["a", "b", "noise"], l2=1e6)
    p = m.predict_proba(X)
    assert p.std() < 0.01 and p.mean() == pytest.approx(y.mean(), abs=0.02)


def test_constant_feature_is_harmless():
    X, y = data()
    X[:, 2] = 7.0
    m = fit_gate(X, y, ["a", "b", "const"])
    assert np.all(np.isfinite(m.weights))


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        fit_gate(np.zeros((3, 2)), [0, 1, 1], ["only_one"])
    with pytest.raises(ValueError):
        fit_gate(np.zeros((2, 1)), [0, 2], ["a"])
    with pytest.raises(ValueError, match="finite"):
        fit_gate(np.array([[1.0], [np.inf]]), [0, 1], ["a"])


def test_uncertified_threshold_keeps_the_gate_closed(tmp_path):
    X, y = data(500)
    m = fit_gate(X, y, ["a", "b", "noise"])
    policy = policy_dict(m, Threshold(NEVER_ACT, 0.0, 0, 0), 0.03, 0.1, 500, RETRIEVER)
    assert policy["calibrated"] is False and policy["threshold"] is None
    text = write_policy(policy, tmp_path / "policy.js").read_text()
    assert text.startswith("// Generated") and "Infinity" not in text


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_javascript_gate_matches_python(tmp_path):
    """The Forge gate must score exactly like the Python model it was exported from."""
    X, y = data(2000)
    names = ["a", "b", "noise"]
    m = fit_gate(X, y, names)
    policy = policy_dict(m, Threshold(0.5, 0.4, 3, 800), 0.03, 0.1, 2000, RETRIEVER)
    policy_path = write_policy(policy, tmp_path / "policy.mjs")
    rows = [dict(zip(names, map(float, x))) for x in X[:50]]
    script = (
        f"import {{ score, decide }} from {json.dumps(str(APP / 'src' / 'gate.js'))};\n"
        f"import policy from {json.dumps(str(policy_path))};\n"
        f"const rows = {json.dumps(rows)};\n"
        "console.log(JSON.stringify(rows.map((r) => [score(r, policy.model), decide(r, policy).decision])));\n"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True
    )
    js = json.loads(out.stdout)
    py = m.predict_proba(X[:50])
    np.testing.assert_allclose([s for s, _ in js], py, rtol=1e-12, atol=1e-12)
    assert [d for _, d in js] == ["act" if p >= 0.5 else "ask" for p in py]


def test_policies_must_sit_under_the_action_they_were_certified_for(tmp_path):
    X, y = data(300)
    m = fit_gate(X, y, ["a", "b", "noise"])
    p = {"action": "link", **policy_dict(m, Threshold(NEVER_ACT, 0.0, 0, 0), 0.03, 0.1, 300, RETRIEVER)}
    with pytest.raises(ValueError, match="certified for 'link'"):
        write_policies({"clear": p}, tmp_path / "policy.js")
    assert write_policies({"link": p}, tmp_path / "policy.js").exists()
