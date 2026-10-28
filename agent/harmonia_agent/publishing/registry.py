"""Action-type to provider-adapter registry."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class PublishingRegistry:
    def __init__(self, adapters: Mapping[str, Any]):
        self._adapters = dict(adapters)

    def adapter_for(self, action_type: str) -> Any:
        adapter = self._adapters.get(action_type)
        if adapter is None:
            raise RuntimeError(f"no adapter for effect command type '{action_type}'")
        return adapter
