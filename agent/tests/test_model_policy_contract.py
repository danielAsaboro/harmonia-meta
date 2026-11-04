"""The worker's model-policy snapshot matches the shape the web app accepts.

``fixtures/model_policies.json`` is the worker's real output for every role. The
web contract test (tests/modelPolicyContract.test.ts) parses the same file
with the budget-reservation schema, so drift on either side fails a test.
"""

from __future__ import annotations

import json
from pathlib import Path

from harmonia_agent.role_models import load_role_model_catalog

FIXTURE = Path(__file__).parent / "fixtures" / "model_policies.json"


def test_fixture_is_the_workers_current_policy_snapshot(monkeypatch):
    for name in ("STRATEGIST_MODEL_ID", "STRATEGIST_PROVIDER", "ANALYST_MODEL_ID", "ANALYST_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    snapshots = {role.role: role.policy_snapshot() for role in load_role_model_catalog().roles()}
    assert json.loads(FIXTURE.read_text()) == snapshots
