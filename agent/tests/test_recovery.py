from harmonia_agent.recovery import recover_missed


def test_recovery_client_requests_a_strict_bounded_page():
    calls = []
    result = recover_missed(
        limit=20, deadline_seconds=15, max_retries=3, max_cost_usd="0.250000",
        submit=lambda payload: calls.append(payload) or {"actions": [{"action": "replay_operation"}]},
    )
    assert result == [{"action": "replay_operation"}]
    assert calls == [{
        "limit": 20, "deadlineSeconds": 15, "maxRetries": 3,
        "maxCostUsd": "0.250000",
    }]


def test_recovery_client_rejects_unbounded_requests_before_network_entry():
    calls = []
    try:
        recover_missed(limit=101, submit=lambda payload: calls.append(payload))
    except ValueError as exc:
        assert "limit" in str(exc)
    else:
        raise AssertionError("expected recovery bound failure")
    assert calls == []
