"""Safe structured failures produced at agent contract boundaries."""

from __future__ import annotations

import re


_CODE = re.compile(r"^[a-z0-9_]{1,80}$")


class AgentContractError(RuntimeError):
    """An agent output failed deterministic validation without exposing its payload."""

    def __init__(
        self,
        *,
        role: str,
        code: str,
        public_message: str,
        path: str | None = None,
    ) -> None:
        if not role or not _CODE.fullmatch(code):
            raise ValueError("agent contract error requires a role and stable snake-case code")
        if not public_message or len(public_message) > 240:
            raise ValueError("agent contract public message must contain 1..240 characters")
        super().__init__(public_message)
        self.role = role
        self.code = code
        self.public_message = public_message
        self.path = path
