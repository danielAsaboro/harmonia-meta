"""Provider-neutral durable upload progress."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

UploadState = Literal["uploading", "processing", "complete"]


@dataclass(frozen=True)
class UploadCheckpoint:
    session_uri: str
    acknowledged_bytes: int
    state: UploadState

    def __post_init__(self) -> None:
        if not self.session_uri.startswith("https://"):
            raise ValueError("upload session must use HTTPS")
        if self.acknowledged_bytes < 0:
            raise ValueError("acknowledged bytes must be non-negative")

    def advance(self, acknowledged_bytes: int) -> "UploadCheckpoint":
        if self.state == "complete":
            raise ValueError("complete upload cannot advance")
        if acknowledged_bytes < self.acknowledged_bytes:
            raise ValueError("upload checkpoint cannot move backwards")
        return replace(self, acknowledged_bytes=acknowledged_bytes)

    def mark_processing(self) -> "UploadCheckpoint":
        return replace(self, state="processing")

    def mark_complete(self) -> "UploadCheckpoint":
        return replace(self, state="complete")
