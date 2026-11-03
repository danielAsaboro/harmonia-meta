import hashlib
import json

import pytest

from harmonia_agent.artifact_export import (
    ArtifactVerificationError,
    export_content_artifact,
    render_json,
    render_markdown,
    verify_content_artifact_export,
)
from harmonia_agent.content_artifacts import ContentArtifactDraft, ContentArtifactRecord


@pytest.mark.parametrize(
    ("artifact", "expected_fragment"),
    [
        ({"id": "a1", "outputPlanItemId": "o1", "outputType": "x_post", "title": "Post", "sourceSegmentRefs": ["s:1"], "payload": {"kind": "x_post", "text": "Proof, not promises."}}, "Proof, not promises."),
        ({"id": "a2", "outputPlanItemId": "o2", "outputType": "linkedin_post", "title": "LinkedIn", "sourceSegmentRefs": ["s:1"], "payload": {"kind": "linkedin_post", "body": "Operational proof", "title": "Launch", "cta": "Read more"}}, "Operational proof"),
        ({"id": "a3", "outputPlanItemId": "o3", "outputType": "newsletter", "title": "Letter", "sourceSegmentRefs": ["s:1"], "payload": {"kind": "newsletter", "subject": "Launch", "preheader": "Evidence", "introduction": "Hello", "sections": [{"id": "sec-1", "heading": "Proof", "body": "Nine days became forty hours.", "sourceSegmentRefs": ["s:1"]}], "cta": "Try it"}}, "## Proof"),
    ],
)
def test_renderers_are_deterministic_and_preserve_format_content(artifact, expected_fragment):
    parsed = ContentArtifactDraft.model_validate(artifact)
    first_markdown = render_markdown(parsed)
    second_markdown = render_markdown(parsed)
    first_json = render_json(parsed)
    assert first_markdown == second_markdown
    assert expected_fragment.encode() in first_markdown
    assert first_json == render_json(parsed)
    assert json.loads(first_json)["id"] == artifact["id"]
    assert b"createdAt" not in first_json


def test_markdown_escapes_untrusted_heading_markup():
    artifact = ContentArtifactDraft.model_validate({
        "id": "article", "outputPlanItemId": "out", "outputType": "blog_article",
        "title": "Article", "sourceSegmentRefs": ["s:1"],
        "payload": {"kind": "blog_article", "headline": "# Injected", "dek": "Dek",
                    "sections": [{"id": "s1", "heading": "[Proof](javascript:alert(1))", "body": "Body", "sourceSegmentRefs": ["s:1"]}],
                    "conclusion": "Done", "cta": "Try it", "citations": ["s:1"]},
    })
    rendered = render_markdown(artifact).decode()
    assert "javascript:" not in rendered
    assert "\\# Injected" in rendered


def _sealed_artifact() -> ContentArtifactRecord:
    value = {
        "id": "artifact-1", "jobId": "job-1", "outputPlanId": "plan-1",
        "outputPlanDigest": "a" * 64, "outputType": "linkedin_post", "revision": 2,
        "title": "Launch", "sourceSegmentRefs": ["source-1:segment-1"],
        "producer": {"role": "noni", "model": "muse-spark-1.3", "traceId": "b" * 32},
        "review": {"role": "dara", "traceId": "c" * 32, "decision": "accept"},
        "mimeType": "text/markdown", "createdAt": "2026-08-30T00:00:00Z",
        "payload": {"kind": "linkedin_post", "body": "Operational proof", "cta": "Read more"},
    }
    meaning = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return ContentArtifactRecord.model_validate({
        **value, "contentDigest": hashlib.sha256(meaning).hexdigest(),
    })


def test_export_stores_immutable_markdown_and_json_objects_and_verifies_exact_bytes():
    objects: dict[str, bytes] = {}

    def store(content: bytes, content_type: str) -> dict:
        object_id = f"object-{len(objects) + 1}"
        objects[object_id] = content
        return {"id": object_id, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "contentType": content_type}

    artifact = _sealed_artifact()
    detail = export_content_artifact(artifact, store=store)

    assert detail == {
        "artifactId": "artifact-1", "artifactRevision": 2,
        "artifactDigest": artifact.contentDigest,
        "markdownObjectId": "object-1", "markdownSha256": hashlib.sha256(objects["object-1"]).hexdigest(),
        "markdownBytes": len(objects["object-1"]),
        "jsonObjectId": "object-2", "jsonSha256": hashlib.sha256(objects["object-2"]).hexdigest(),
        "jsonBytes": len(objects["object-2"]),
    }
    verified = verify_content_artifact_export(
        artifact, detail, read=lambda object_id, expected_bytes: objects[object_id],
    )
    assert verified["artifactId"] == artifact.id
    assert verified["artifactDigest"] == artifact.contentDigest


@pytest.mark.parametrize("failure", ["missing", "mutated"])
def test_verification_fails_closed_for_missing_or_mutated_object_bytes(failure):
    objects: dict[str, bytes] = {}

    def store(content: bytes, content_type: str) -> dict:
        object_id = f"object-{len(objects) + 1}"
        objects[object_id] = content
        return {"id": object_id, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "contentType": content_type}

    artifact = _sealed_artifact()
    detail = export_content_artifact(artifact, store=store)
    if failure == "missing":
        del objects[detail["markdownObjectId"]]
    else:
        objects[detail["jsonObjectId"]] = b"{}"

    with pytest.raises(ArtifactVerificationError):
        verify_content_artifact_export(
            artifact, detail,
            read=lambda object_id, expected_bytes: objects.get(object_id),
        )
