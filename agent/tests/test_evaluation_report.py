"""Quality, cost, and latency candidate selection."""

from decimal import Decimal
import hashlib
import json

from harmonia_agent.evaluation_report import (
    EvalCaseEvidence,
    EvaluationUsageEvidence,
    RoleEvaluationRecord,
    compare_role_candidates,
    load_verified_evaluation_record,
)
from harmonia_agent.role_models import load_role_model_catalog


def record(
    model: str, *, pass_rate: str, cost: str | None, latency_ms: int,
) -> RoleEvaluationRecord:
    rate = Decimal(pass_rate)
    case_count = max(10, 10 ** max(0, -rate.as_tuple().exponent))
    return RoleEvaluationRecord(
        role="nimi_analyst",
        model_id=model,
        eval_run_id=f"run-{model}",
        evidence_digest="a" * 64,
        usage_evidence_digest="b" * 64,
        cases=tuple(
            EvalCaseEvidence(
                case_id=f"case-{index}",
                passed=index < int(rate * case_count),
                latency_ms=latency_ms,
            )
            for index in range(case_count)
        ),
        usage_records=() if cost is None else (
            EvaluationUsageEvidence(
                record_id=f"usage-{model}", model_id=model,
                estimated_cost_usd=cost, pricing_version="pricing-test",
            ),
        ),
        pricing_version="pricing-test",
        policy_version="policy-test",
        minimum_pass_rate="0.95",
    )


def test_candidate_must_meet_quality_floor_before_cost_selection():
    comparison = compare_role_candidates([
        record("muse-spark-1.3", pass_rate="1.0", cost="0.020000", latency_ms=900),
        record("muse-spark-1.2", pass_rate="0.7", cost="0.005000", latency_ms=400),
    ], minimum_pass_rate="0.95")

    assert comparison.selected_model == "muse-spark-1.3"
    assert comparison.rejected[0].reason == "below_quality_floor"


def test_unknown_cost_cannot_be_selected():
    comparison = compare_role_candidates([
        record("unknown", pass_rate="1.0", cost=None, latency_ms=100),
    ], minimum_pass_rate="0.95")

    assert comparison.selected_model is None
    assert comparison.rejected[0].reason == "unknown_cost"
    assert comparison.rejected[0].record.model_id == "unknown"


def test_quality_then_cost_then_latency_are_stable_tiebreakers():
    comparison = compare_role_candidates([
        record("slower", pass_rate="0.98", cost="0.010000", latency_ms=800),
        record("faster", pass_rate="0.98", cost="0.010000", latency_ms=500),
        record("better", pass_rate="1.0", cost="0.030000", latency_ms=900),
    ], minimum_pass_rate=Decimal("0.95"))

    assert comparison.selected_model == "better"
    assert [candidate.model_id for candidate in comparison.eligible] == [
        "better", "faster", "slower",
    ]


def test_comparison_rejects_mixed_roles_or_versions():
    records = [
        record("one", pass_rate="1", cost="0.01", latency_ms=100),
        record("two", pass_rate="1", cost="0.01", latency_ms=100).model_copy(
            update={"policy_version": "different"},
        ),
    ]

    try:
        compare_role_candidates(records, minimum_pass_rate="0.95")
    except ValueError as exc:
        assert "policy version" in str(exc)
    else:
        raise AssertionError("mixed policy versions must be rejected")


def test_record_derives_metrics_from_case_and_usage_evidence():
    candidate = record("grounded", pass_rate="0.7", cost="0.012345", latency_ms=321)

    assert candidate.pass_rate == Decimal("0.7")
    assert candidate.case_count == 10
    assert candidate.estimated_cost_usd == Decimal("0.012345")
    assert candidate.p95_latency_ms == 321


def test_loader_verifies_artifact_usage_and_catalog_linkage(tmp_path):
    artifact = tmp_path / "eval.json"
    usage = tmp_path / "usage.json"
    artifact.write_text(json.dumps({
        "runId": "run-1", "role": "nimi_analyst", "modelId": "candidate-model",
        "policyVersion": "gear-2026-11-03", "pricingVersion": "2026-11-03",
        "minimumPassRate": "0.95", "usageRecordIds": ["usage-1"],
        "cases": [{"caseId": "grounding", "passed": True, "latencyMs": 250}],
    }, sort_keys=True))
    usage.write_text(json.dumps([{
        "id": "usage-1", "role": "nimi_analyst", "model": "candidate-model",
        "estimatedCostUsd": "0.012000", "pricingVersion": "2026-11-03",
        "modelPolicy": load_role_model_catalog().analyst.policy_snapshot(),
    }], sort_keys=True))

    loaded = load_verified_evaluation_record({
        "evalArtifact": str(artifact),
        "evalArtifactSha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "usageExport": str(usage),
        "usageExportSha256": hashlib.sha256(usage.read_bytes()).hexdigest(),
    }, catalog=load_role_model_catalog())

    assert loaded.pass_rate == Decimal("1")
    assert loaded.estimated_cost_usd == Decimal("0.012000")
    assert loaded.usage_records[0].record_id == "usage-1"


def test_loader_rejects_tampered_artifact_digest(tmp_path):
    artifact = tmp_path / "eval.json"
    usage = tmp_path / "usage.json"
    artifact.write_text("{}")
    usage.write_text("[]")

    try:
        load_verified_evaluation_record({
            "evalArtifact": str(artifact), "evalArtifactSha256": "0" * 64,
            "usageExport": str(usage),
            "usageExportSha256": hashlib.sha256(usage.read_bytes()).hexdigest(),
        }, catalog=load_role_model_catalog())
    except ValueError as exc:
        assert "digest mismatch" in str(exc)
    else:
        raise AssertionError("tampered artifact must be rejected")
