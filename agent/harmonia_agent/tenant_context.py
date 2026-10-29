"""Invocation-local SaaS tenant identity propagated from Pub/Sub."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import re

_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@dataclass(frozen=True)
class TenantScope:
    workspace_id: str
    brand_id: str

    def __post_init__(self) -> None:
        if not _ID.fullmatch(self.workspace_id) or not _ID.fullmatch(self.brand_id):
            raise ValueError("invalid tenant scope")


_scope: ContextVar[TenantScope | None] = ContextVar("harmonia_tenant_scope", default=None)


def current_tenant() -> TenantScope:
    value = _scope.get()
    if value is None:
        raise RuntimeError("tenant context required")
    return value


@contextmanager
def tenant_scope(workspace_id: str, brand_id: str):
    value = TenantScope(workspace_id=workspace_id, brand_id=brand_id)
    token = _scope.set(value)
    try:
        yield value
    finally:
        _scope.reset(token)
