"""Shared fixture access. The same JSON backs the TypeScript suite."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "fixtures.json").read_text(encoding="utf-8")
)
TOPIC_ID = FIXTURE["topicId"]
CASE_LABEL = FIXTURE["caseLabel"]
INPUT = FIXTURE["input"]
EXPECTED = FIXTURE["expected"]

#: The fixture's single announcement revision.
R1 = INPUT["revisions"][0]


def payload(**overrides) -> dict:
    return {**copy.deepcopy(INPUT), **overrides}


def run(**overrides) -> dict:
    from fintech_return_of_capital import calculate

    return calculate(payload(**overrides))


def revision(**overrides) -> dict:
    return {**copy.deepcopy(R1), **overrides}


def with_terms(**term_overrides) -> dict:
    """The fixture with the revision's terms patched."""

    row = copy.deepcopy(R1)
    row["terms"] = {**row["terms"], **term_overrides}
    return {**copy.deepcopy(INPUT), "revisions": [row]}


def run_terms(**term_overrides) -> dict:
    from fintech_return_of_capital import calculate

    return calculate(with_terms(**term_overrides))


def section(name: str, **overrides) -> dict:
    """One of the fixture's top-level observation blocks, patched."""

    return {**copy.deepcopy(INPUT[name]), **overrides}
