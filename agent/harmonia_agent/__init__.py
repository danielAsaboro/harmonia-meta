"""Harmonia ADK worker service."""

async def dispatch(job_id: str, stage: str, *, attempt: int = 0, operation_id: str | None = None) -> bool:
    """Load the worker graph only when dispatch is invoked."""
    from .stages import dispatch as stage_dispatch

    return await stage_dispatch(job_id, stage, attempt=attempt, operation_id=operation_id)


__all__ = ["dispatch"]
