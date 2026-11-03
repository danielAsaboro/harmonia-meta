from __future__ import annotations

import pytest

from harmonia_agent.operation_context import (
    current_operation,
    operation_scope,
    operation_headers,
)
from harmonia_agent.tenant_context import tenant_scope
from harmonia_agent.web_client import _client


def test_operation_scope_adds_fencing_headers_and_clears_after_exit() -> None:
    assert current_operation() is None
    with operation_scope("job:job-1:stage:draft", 3):
        assert operation_headers() == {
            "x-harmonia-operation-id": "job:job-1:stage:draft",
            "x-harmonia-operation-epoch": "3",
        }
        assert current_operation().epoch == 3
    assert current_operation() is None
    assert operation_headers() == {}


def test_nested_operation_scope_restores_the_parent() -> None:
    with operation_scope("job:job-1:stage:draft", 2):
        with operation_scope("job:job-1:effect:command-1", 7):
            assert current_operation().operation_id == "job:job-1:effect:command-1"
        assert current_operation().operation_id == "job:job-1:stage:draft"


def test_web_client_automatically_propagates_the_current_fence() -> None:
    with tenant_scope("workspace-1", "brand-1"):
        with operation_scope("job:job-1:stage:draft", 5):
            client = _client()
            try:
                assert client.headers["x-harmonia-operation-id"] == "job:job-1:stage:draft"
                assert client.headers["x-harmonia-operation-epoch"] == "5"
            finally:
                client.close()


@pytest.mark.parametrize("operation_id,epoch", [("", 1), ("op", 0), ("op", -1)])
def test_operation_scope_rejects_incomplete_fences(operation_id: str, epoch: int) -> None:
    with pytest.raises(ValueError):
        with operation_scope(operation_id, epoch):
            pass
