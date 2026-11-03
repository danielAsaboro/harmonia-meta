import asyncio

from harmonia_agent.dream_cycle import build_dream_cycle_agent, run_dream_cycle
from harmonia_agent.autonomy_models import DreamCycleOutput
from harmonia_agent.provider_schema import meta_output_schema


def valid_output():
    return {"reflections": [], "hypotheses": [], "experiments": [], "safe_activity_summary": "No stable pattern met the evidence threshold."}


def test_dream_cycle_skips_without_new_eligible_evidence():
    entered = []
    result = asyncio.run(run_dream_cycle(cycle_id="dream-1", observations=[], reserve_budget=lambda *_: entered.append("reserve"), synthesize=lambda *_: entered.append("model"), persist=lambda *_: entered.append("persist")))
    assert result == {"status": "skipped", "reason": "no_new_eligible_evidence", "cycleId": "dream-1"}
    assert entered == []


def test_dream_cycle_reserves_before_synthesis_and_persists_only_validated_output():
    order = []
    async def synthesize(evidence):
        order.append(("model", evidence))
        return valid_output()
    result = asyncio.run(run_dream_cycle(
        cycle_id="dream-1", observations=[{"id": "obs-1", "observationType": "verified_effect", "facts": {"outcome": "applied"}}],
        reserve_budget=lambda operation_id, amount: order.append(("reserve", operation_id, amount)) or {"accepted": True},
        synthesize=synthesize, persist=lambda output: order.append(("persist", output.safe_activity_summary)), estimated_cost_usd=0.02,
    ))
    assert [entry[0] for entry in order] == ["reserve", "model", "persist"]
    assert result == {"status": "completed", "cycleId": "dream-1", "reflectionCount": 0, "hypothesisCount": 0, "experimentCount": 0, "safeActivitySummary": "No stable pattern met the evidence threshold."}


def test_dream_cycle_pauses_when_budget_reservation_is_rejected():
    entered = []
    result = asyncio.run(run_dream_cycle(cycle_id="dream-1", observations=[{"id": "obs-1", "observationType": "x", "facts": {}}], reserve_budget=lambda *_: {"accepted": False, "reason": "daily budget exhausted"}, synthesize=lambda *_: entered.append("model"), persist=lambda *_: entered.append("persist")))
    assert result == {"status": "paused", "reason": "daily budget exhausted", "cycleId": "dream-1"}
    assert entered == []


def test_dream_agent_has_typed_io_and_no_tools_or_write_authority():
    agent = build_dream_cycle_agent("muse-spark-1.3")
    assert agent.name == "harmonia_dream_synthesizer"
    assert agent.tools == []
    assert agent.output_schema == meta_output_schema(DreamCycleOutput)
    assert "credentials" in agent.instruction
    assert "configuration" in agent.instruction
