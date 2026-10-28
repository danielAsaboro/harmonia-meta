"""Deterministic content-artifact serialization, export, and byte verification."""

from __future__ import annotations

import json
import re
import hashlib
from collections.abc import Callable
from typing import Any

from .content_artifacts import ContentArtifactDraft, ContentArtifactRecord


class ArtifactVerificationError(RuntimeError):
    """Stored export bytes no longer prove the accepted content artifact."""


def _heading(value: str) -> str:
    value = re.sub(r"(?i)javascript\s*:", "", value)
    return re.sub(r"([\\`*_[\]<>#+.!|-])", r"\\\1", value).strip()


def render_json(artifact: ContentArtifactDraft | ContentArtifactRecord) -> bytes:
    value = artifact.model_dump(mode="json", by_alias=True, exclude_none=True)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def render_markdown(artifact: ContentArtifactDraft | ContentArtifactRecord) -> bytes:
    payload = artifact.payload.model_dump(mode="json", by_alias=True, exclude_none=True)
    kind = payload["kind"]
    lines = [f"# {_heading(artifact.title)}", ""]
    if kind == "x_post":
        lines.append(payload["text"])
    elif kind == "x_thread":
        for index, post in enumerate(payload["posts"], 1):
            lines.extend([f"## Post {index}", "", post["text"], ""])
    elif kind == "linkedin_post":
        if payload.get("title"): lines.extend([f"## {_heading(payload['title'])}", ""])
        lines.append(payload["body"])
        if payload.get("cta"): lines.extend(["", payload["cta"]])
    elif kind == "blog_article":
        lines = [f"# {_heading(payload['headline'])}", "", payload["dek"], ""]
        for section in payload["sections"]: lines.extend([f"## {_heading(section['heading'])}", "", section["body"], ""])
        lines.extend(["## Conclusion", "", payload["conclusion"], "", payload["cta"], "", "## Sources", "", *[f"- `{ref}`" for ref in payload["citations"]]])
    elif kind == "newsletter":
        lines.extend([f"**Subject:** {payload['subject']}", "", f"**Preheader:** {payload['preheader']}", "", payload["introduction"], ""])
        for section in payload["sections"]: lines.extend([f"## {_heading(section['heading'])}", "", section["body"], ""])
        lines.append(payload["cta"])
        if payload.get("signOff"): lines.extend(["", payload["signOff"]])
    elif kind == "caption":
        lines.extend([f"**Platform:** {payload['platformIntent']}", "", payload["text"]])
        if payload.get("cta"): lines.extend(["", payload["cta"]])
        if payload.get("hashtags"): lines.extend(["", " ".join(payload["hashtags"])])
    elif kind == "carousel_spec":
        for index, slide in enumerate(payload["slides"], 1): lines.extend([f"## Slide {index}: {_heading(slide['headline'])}", "", slide["body"], "", f"Role: `{slide['role']}`", ""])
    elif kind == "quote_card":
        lines.extend([f"> {payload['quote']}", "", f"— {payload['attribution']}", "", f"Render brief: {payload['renderBrief']}"])
    elif kind == "diagram":
        lines.extend([f"**Diagram type:** {payload['diagramType']}", "", payload["renderBrief"], "", "## Nodes", ""])
        lines.extend(f"- `{node['id']}`: {node['label']}" for node in payload["nodes"])
        lines.extend(["", "## Edges", ""])
        lines.extend(f"- `{edge['from']}` → `{edge['to']}`{': ' + edge['label'] if edge.get('label') else ''}" for edge in payload["edges"])
    elif kind == "editorial_calendar":
        lines.extend(["| Intended at | Channel | Artifact | Purpose |", "|---|---|---|---|"])
        lines.extend(f"| {entry['intendedAt']} | {entry['channel']} | `{entry['artifactId']}` | {entry['purpose']} |" for entry in payload["entries"])
    elif kind == "content_pack":
        lines.extend(["## Verified artifacts", "", *[f"- `{item['artifactId']}` — `{item['digest']}`" for item in payload["artifacts"]]])
    else:
        raise ValueError(f"unsupported artifact kind: {kind}")
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


ArtifactStore = Callable[[bytes, str], dict[str, Any]]
ArtifactRead = Callable[[str, int], bytes | None]


def export_content_artifact(
    artifact: ContentArtifactRecord,
    *,
    store: ArtifactStore,
) -> dict[str, Any]:
    """Store separate immutable Markdown and canonical JSON representations."""
    markdown = render_markdown(artifact)
    canonical_json = render_json(artifact)
    markdown_record = store(markdown, "text/markdown")
    json_record = store(canonical_json, "application/json")
    markdown_digest = hashlib.sha256(markdown).hexdigest()
    json_digest = hashlib.sha256(canonical_json).hexdigest()
    if markdown_record.get("sha256") != markdown_digest:
        raise ArtifactVerificationError("artifact store returned the wrong Markdown digest")
    if json_record.get("sha256") != json_digest:
        raise ArtifactVerificationError("artifact store returned the wrong JSON digest")
    return {
        "artifactId": artifact.id,
        "artifactRevision": artifact.revision,
        "artifactDigest": artifact.contentDigest,
        "markdownObjectId": str(markdown_record["id"]),
        "markdownSha256": markdown_digest,
        "markdownBytes": len(markdown),
        "jsonObjectId": str(json_record["id"]),
        "jsonSha256": json_digest,
        "jsonBytes": len(canonical_json),
    }


def verify_content_artifact_export(
    artifact: ContentArtifactRecord,
    detail: dict[str, Any],
    *,
    read: ArtifactRead,
) -> dict[str, str]:
    """Re-read both objects and validate bytes, schema, identity, revision, and digest."""
    if detail.get("artifactId") != artifact.id or detail.get("artifactRevision") != artifact.revision:
        raise ArtifactVerificationError("export receipt artifact identity mismatch")
    if detail.get("artifactDigest") != artifact.contentDigest:
        raise ArtifactVerificationError("export receipt canonical digest mismatch")
    observed: dict[str, bytes] = {}
    for kind in ("markdown", "json"):
        object_id = detail.get(f"{kind}ObjectId")
        expected_bytes = detail.get(f"{kind}Bytes")
        expected_digest = detail.get(f"{kind}Sha256")
        if not isinstance(object_id, str) or not isinstance(expected_bytes, int) or expected_bytes < 1:
            raise ArtifactVerificationError(f"export receipt {kind} identity is incomplete")
        data = read(object_id, expected_bytes)
        if data is None:
            raise ArtifactVerificationError(f"exported {kind} bytes are missing")
        if len(data) != expected_bytes or hashlib.sha256(data).hexdigest() != expected_digest:
            raise ArtifactVerificationError(f"exported {kind} bytes do not match the receipt")
        observed[kind] = data
    try:
        parsed = ContentArtifactRecord.model_validate(json.loads(observed["json"]))
    except Exception as exc:
        raise ArtifactVerificationError("exported JSON is not the exact content artifact schema") from exc
    if parsed.id != artifact.id or parsed.revision != artifact.revision or parsed.contentDigest != artifact.contentDigest:
        raise ArtifactVerificationError("exported JSON artifact identity mismatch")
    if observed["markdown"] != render_markdown(parsed):
        raise ArtifactVerificationError("exported Markdown is not deterministic for the stored JSON")
    return {"artifactId": parsed.id, "artifactDigest": parsed.contentDigest}
