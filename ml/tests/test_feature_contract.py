"""The shared feature cases in fixtures/features.json, checked from the Python side.

app/test/features.test.js runs the same cases against the Forge code. If a definition
changes, regenerate the expected values from hedge.features and bump the schema version.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from hedge.features import FEATURE_NAMES, gate_features

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "features.json").read_text())


def test_names_match():
    assert tuple(CONTRACT["featureNames"]) == FEATURE_NAMES


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda c: c["name"])
def test_case(case):
    x = case["context"]
    got = gate_features(case["scores"], case["summary"], case["description"], x["window"], x["topSummary"], x["ageSeconds"])
    assert got == pytest.approx(case["expected"], abs=1e-12)


def test_schema_version_matches_and_travels_in_the_policy():
    from hedge.features import FEATURE_SCHEMA
    from hedge.gate import GateModel, policy_dict
    from hedge.risk import Threshold

    assert CONTRACT["featureSchema"] == FEATURE_SCHEMA
    model = GateModel(FEATURE_NAMES, np.zeros(len(FEATURE_NAMES)), 0.0)
    policy = policy_dict(model, Threshold(0.5, 0.3, 1, 30), 0.03, 0.1, 100, "bm25-v1")
    assert policy["featureSchema"] == FEATURE_SCHEMA and policy["retriever"] == "bm25-v1"
    with pytest.raises(ValueError):
        policy_dict(model, Threshold(0.5, 0.3, 1, 30), 0.03, 0.1, 100, "")
