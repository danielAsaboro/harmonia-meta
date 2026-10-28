"""Task-local durable-operation fence propagated to Harmonia's internal API."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import re
from collections.abc import Iterator


_OPERATION_ID = re.compile(r"^[A-Za-z0-9:_-]{1,512}$")


@dataclass(frozen=True)
class OperationFence:
    operation_id: str
    epoch: int
    goal_digest: str | None = None


_current: ContextVar[OperationFence | None] = ContextVar(
    "harmonia_operation_fence", default=None
)


def current_operation() -> OperationFence | None:
    return _current.get()


def operation_headers() -> dict[str, str]:
    fence = current_operation()
    if fence is None:
        return {}
    return {
        "x-harmonia-operation-id": fence.operation_id,
        "x-harmonia-operation-epoch": str(fence.epoch),
    }


@contextmanager
def operation_scope(
    operation_id: str, epoch: int, *, goal_digest: str | None = None
) -> Iterator[OperationFence]:
    if not _OPERATION_ID.fullmatch(operation_id):
        raise ValueError("invalid operation id")
    if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 1:
        raise ValueError("invalid operation epoch")
    if goal_digest is not None and not re.fullmatch(r"[a-f0-9]{64}", goal_digest):
        raise ValueError("invalid operation goal digest")
    fence = OperationFence(
        operation_id=operation_id, epoch=epoch, goal_digest=goal_digest
    )
    token = _current.set(fence)
    try:
        yield fence
    finally:
        _current.reset(token)
