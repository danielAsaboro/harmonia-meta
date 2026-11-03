import pytest
from pydantic import ValidationError

from harmonia_agent.autonomy_models import DreamCycleOutput


def test_dream_output_is_typed_bounded_and_contains_no_private_reasoning():
    output = DreamCycleOutput.model_validate({
        "reflections": [{"id": "ref-1", "evidence_refs": ["obs-1"], "scope": "posting windows", "summary": "Morning posts have stronger verified engagement.", "confidence": 0.8, "expires_at": "2026-09-27T08:00:00Z", "expected_benefit": "Improve verified engagement", "risk_class": "low", "estimated_cost_usd": 0.01, "evaluation_criteria": "Compare verified engagement after 10 posts"}],
        "hypotheses": [{"id": "hyp-1", "reflection_id": "ref-1", "evidence_refs": ["obs-1"], "statement": "Posting at 09:00 may improve engagement", "confidence": 0.7, "expires_at": "2026-09-27T08:00:00Z", "contradiction_refs": []}],
        "experiments": [{"id": "exp-1", "hypothesis_id": "hyp-1", "variable": "preferred_posting_hour", "baseline": 14, "candidate": 9, "lower_bound": 0, "upper_bound": 23, "evidence_threshold": 10, "evaluation_method": "before_after", "success_criteria": "verified engagement improves", "failure_criteria": "verified engagement declines", "maximum_cost_usd": 0.2, "starts_at": "2026-08-28T00:00:00Z", "ends_at": "2026-09-04T00:00:00Z", "expires_at": "2026-09-05T00:00:00Z", "rollback_condition": "engagement falls below baseline"}],
        "safe_activity_summary": "Synthesized one bounded posting-window experiment from one verified observation.",
    })
    assert output.experiments[0].variable == "preferred_posting_hour"
    assert "reasoning" not in output.model_dump()


def test_dream_output_rejects_unknown_fields_and_unsupported_variables():
    with pytest.raises(ValidationError):
        DreamCycleOutput.model_validate({"reflections": [], "hypotheses": [], "experiments": [], "safe_activity_summary": "Nothing new.", "chain_of_thought": "private"})
    with pytest.raises(ValidationError):
        DreamCycleOutput.model_validate({"reflections": [], "hypotheses": [], "experiments": [{"variable": "model_selection"}], "safe_activity_summary": "Invalid protected change."})
