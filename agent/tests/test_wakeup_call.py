from harmonia_agent.wakeup_call import assemble_wakeup_call


def test_wakeup_call_reuses_persisted_dream_results_without_model_synthesis():
    result = assemble_wakeup_call(
        cycle_id="wake-1", dream={"safeActivitySummary": "One posting-window hypothesis was recorded.", "experimentIds": ["exp-1"]},
        operations={"failedJobs": ["job-1"], "pendingApprovals": ["action-1"], "budgetAvailable": True, "providerHealth": "healthy"},
    )
    assert "One posting-window hypothesis" in result["briefing"]
    assert {item["authority"] for item in result["items"]} == {"propose", "request_attention"}
    assert result["source"] == "persisted_dream_and_operational_state"
