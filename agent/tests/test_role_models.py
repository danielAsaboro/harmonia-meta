from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from harmonia_agent.role_models import RoleGenerationPolicy, load_role_model_catalog
from harmonia_agent.generation_policy import generation_config


def test_roles_do_not_collapse_to_one_global_model(monkeypatch):
    monkeypatch.setenv("COORDINATOR_MODEL_ID", "muse-spark-1.2")
    monkeypatch.setenv("STRATEGIST_MODEL_ID", "muse-spark-1.3")
    monkeypatch.setenv("ANALYST_MODEL_ID", "muse-spark-1.3")
    monkeypatch.setenv("COPYWRITER_MODEL_ID", "muse-spark-1.3")
    monkeypatch.setenv("EDITOR_MODEL_ID", "muse-spark-1.3")
    monkeypatch.setenv("PLANNER_MODEL_ID", "muse-spark-1.2")
    monkeypatch.setenv("PRESENTER_MODEL_ID", "muse-spark-1.3")

    catalog = load_role_model_catalog()

    assert catalog.coordinator.model_id == "muse-spark-1.2"
    assert catalog.copywriter.provider == "meta"
    assert catalog.copywriter.model_id == "muse-spark-1.3"
    assert catalog.presenter.model_id == "muse-spark-1.3"
    assert len({item.model_id for item in catalog.roles()}) >= 2


def test_copywriter_uses_meta_model_api_by_default(monkeypatch):
    monkeypatch.setenv("COPYWRITER_MODEL_ID", "muse-spark-1.3")

    catalog = load_role_model_catalog()

    assert catalog.copywriter.provider == "meta"
    assert catalog.copywriter.model_id == "muse-spark-1.3"
    assert catalog.copywriter.reservation_usd is None


def test_each_role_can_raise_its_timeout_without_weakening_other_roles(monkeypatch):
    monkeypatch.setenv("STRATEGIST_TIMEOUT_SECONDS", "300")

    catalog = load_role_model_catalog()

    assert catalog.strategist.timeout_seconds == 300
    assert catalog.analyst.timeout_seconds == 120


def test_every_role_has_versioned_reasoning_and_safety_policy(monkeypatch):
    """Catches a role falling back to implicit provider generation defaults."""

    catalog = load_role_model_catalog()

    assert all(role.policy_version == "gear-2026-11-03" for role in catalog.roles())
    assert catalog.planner.generation.reasoning_effort == "medium"
    assert catalog.planner.max_output_tokens == 16384
    assert catalog.strategist.generation.reasoning_effort == "high"
    assert catalog.coordinator.generation.reasoning_effort == "low"
    assert all(
        role.generation.safety_profile == "harmonia-standard"
        for role in catalog.roles()
    )
    assert all(role.timeout_seconds > 0 for role in catalog.roles())
    assert all(role.eligible_tasks for role in catalog.roles())
    assert catalog.planner.eligible_tasks == ("propose_editorial_plan",)
    assert all(role.minimum_pass_rate == Decimal("0.95") for role in catalog.roles())
    assert all(role.pricing_version == "2026-11-03" for role in catalog.roles())


def test_muse_spark_keeps_its_tuned_default_sampling():
    role = load_role_model_catalog().analyst
    config = generation_config(role)

    assert role.model_id == "muse-spark-1.3"
    assert config.temperature is None
    assert config.top_p is None
    assert config.top_k is None


def test_role_can_move_to_muse_spark_open_on_baseten(monkeypatch):
    monkeypatch.setenv("ANALYST_PROVIDER", "baseten")

    catalog = load_role_model_catalog()

    assert catalog.analyst.provider == "baseten"
    assert catalog.analyst.model_id == "meta-models/muse-spark-open-1026"
    assert catalog.copywriter.provider == "meta"


def test_unknown_role_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("ANALYST_PROVIDER", "gemini")

    with pytest.raises(ValueError, match="ANALYST_PROVIDER must be meta or baseten"):
        load_role_model_catalog()


def test_strategist_has_enough_time_to_complete_the_strategy_contract():
    """Catches the worker cancelling Ryan at the former 120-second limit."""

    catalog = load_role_model_catalog()

    assert catalog.strategist.timeout_seconds == 300


def test_generation_policy_rejects_unknown_reasoning_effort():
    """Catches an invalid reasoning level reaching a provider request."""
    with pytest.raises(ValidationError):
        RoleGenerationPolicy(reasoning_effort="none")


def test_adk_transport_owns_bounded_http_retries_and_timeout():
    role = load_role_model_catalog().copywriter

    config = generation_config(role)

    assert config.http_options.timeout == role.timeout_seconds * 1_000
    assert config.http_options.retry_options.attempts == 2

