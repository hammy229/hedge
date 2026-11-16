"""The shared feature cases in fixtures/features.json, checked from the Python side.

app/test/features.test.js runs the same cases against the Forge code. If a definition
changes, regenerate the expected values from hedge.features and bump the schema version.
"""

import json
from pathlib import Path

import pytest

from hedge.features import FEATURE_NAMES, gate_features

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / "fixtures" / "features.json").read_text())


def test_names_match():
    assert tuple(CONTRACT["featureNames"]) == FEATURE_NAMES


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda c: c["name"])
def test_case(case):
    got = gate_features(case["scores"], case["summary"], case["description"])
    assert got == pytest.approx(case["expected"], abs=1e-12)
