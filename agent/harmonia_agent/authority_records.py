"""Host-owned evidence for compiled skills and authoritative reads.

These records deliberately do not resemble ADK tool traces. A record says what
the coordinator compiled or read; an ADK after-tool callback remains the only
place that may claim a tool was called.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _digest(value: Any) -> str:
    canonical = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def skill_activation_records(
    *, skill_name: str, skill_root: Path, references: tuple[str, ...],
) -> list[dict[str, Any]]:
    files = (("SKILL.md", "skill_activation"), *(
        (reference, "skill_resource_activation") for reference in references
    ))
    return [
        {
            "sequence": index,
            "kind": kind,
            "owner": "harmonia_coordinator",
            "skillName": skill_name,
            "resourcePath": relative_path,
            "contentDigest": _file_digest(skill_root / relative_path),
        }
        for index, (relative_path, kind) in enumerate(files, start=1)
    ]


def validate_skill_activation(
    records: list[dict[str, Any]], *, skill_name: str, skill_root: Path,
    allowed_references: tuple[str, ...],
) -> None:
    expected = skill_activation_records(
        skill_name=skill_name,
        skill_root=skill_root,
        references=tuple(
            str(record.get("resourcePath"))
            for record in records
            if record.get("kind") == "skill_resource_activation"
        ),
    )
    if records != expected:
        raise ValueError("compiled skill activation does not match host-owned files")
    paths = tuple(record["resourcePath"] for record in records[1:])
    if not paths:
        raise ValueError("compiled skill activation requires at least one reference")
    if len(paths) != len(set(paths)):
        raise ValueError("compiled skill activation contains a duplicate reference")
    if any(path not in allowed_references for path in paths):
        raise ValueError("compiled skill activation contains an unapproved reference")


def authority_read_record(
    *, authority: str, authority_id: str, value: Any, sequence: int = 1,
) -> dict[str, Any]:
    return {
        "sequence": sequence,
        "kind": "authority_read",
        "owner": "harmonia_coordinator",
        "authority": authority,
        "authorityId": authority_id,
        "contentDigest": _digest(value),
    }


def validate_authority_read(
    record: dict[str, Any], *, authority: str, authority_id: str, value: Any,
) -> None:
    expected = authority_read_record(
        authority=authority, authority_id=authority_id, value=value,
        sequence=int(record.get("sequence", 1)),
    )
    if record != expected:
        raise ValueError("authority-read record does not match the trusted value")
