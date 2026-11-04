"""Frames and source images are stored under the stage's durable operation fence."""

from __future__ import annotations

from harmonia_agent.extraction.media import _fenced_operation_id
from harmonia_agent.operation_context import operation_scope
from harmonia_agent.usage import InvocationContext


def _invocation() -> InvocationContext:
    return InvocationContext(job_id="job-1", workspace_id="w", brand_id="b", user_id="u", stage="extract_sources",
                             operation_id="job:job-1:stage:extract_sources:generation:1:source-7")


def test_artifacts_use_the_stage_fence_not_the_per_source_accounting_id():
    with operation_scope("job:job-1:stage:extract_sources:generation:1", 1):
        assert _fenced_operation_id(_invocation()) == "job:job-1:stage:extract_sources:generation:1"


def test_outside_a_stage_the_invocation_id_is_used():
    assert _fenced_operation_id(_invocation()) == "job:job-1:stage:extract_sources:generation:1:source-7"
