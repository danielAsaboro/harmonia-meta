import base64
import hashlib
import json

import pytest

from harmonia_agent.effect_executor import (
    ProviderEffectNotStarted,
    artifact_export_adapter,
    execute_effect_command,
    x_thread_publish_adapter,
)
from harmonia_agent.operation_context import operation_scope


def _command():
    return {
        "id": "command-1", "jobId": "job-1", "actionId": "action-1",
        "actionType": "publish_x_post", "payload": {"text": "Launch"},
        "payloadDigest": "a" * 64,
    }


def test_non_execute_claim_never_enters_provider():
    for outcome in ("in_progress", "already_applied", "uncertain", "paused", "cancelled"):
        calls = []
        result = execute_effect_command(
            _command(), adapters={"publish_x_post": lambda _payload, _context: calls.append("provider")},
            claim=lambda _payload, outcome=outcome: {"outcome": outcome, "receiptId": "r1"},
            transition=lambda _phase, _payload: None,
            finalize=lambda _payload: calls.append("finalize"), trace_id="b" * 32, claim_token="owner-1",
        )
        assert calls == []
        assert result.outcome == outcome


def test_execute_claim_uses_command_payload_and_finalizes_once():
    calls = []
    result = execute_effect_command(
        _command(),
        adapters={"publish_x_post": lambda payload, _context: calls.append(payload) or {"outcome": "applied", "detail": {"id": "post-1"}}},
        claim=lambda _payload: {"outcome": "execute", "attempt": 1, "operationEpoch": 1},
        transition=lambda _phase, _payload: None,
        finalize=lambda payload: calls.append(payload), trace_id="b" * 32, claim_token="owner-1",
    )
    assert calls[0] == {"text": "Launch"}
    assert calls[1]["commandId"] == "command-1"
    assert result.outcome == "applied"


def test_dispatch_is_persisted_before_provider_and_observation_before_receipt():
    calls = []
    execute_effect_command(
        _command(),
        adapters={"publish_x_post": lambda payload, _context: calls.append(("provider", payload)) or {"outcome": "applied", "detail": {"id": "post-1"}}},
        claim=lambda _payload: {"outcome": "execute", "attempt": 1, "operationEpoch": 4},
        transition=lambda phase, payload: calls.append((phase, payload)),
        finalize=lambda payload: calls.append(("receipt", payload)),
        trace_id="b" * 32, claim_token="owner-1",
    )
    assert [entry[0] for entry in calls] == ["dispatched", "provider", "observed", "receipt"]
    assert calls[0][1]["operationEpoch"] == 4
    assert calls[2][1]["outcome"] == "applied"


def test_typed_not_started_failure_restores_retry_without_claiming_provider_entry():
    calls = []
    with pytest.raises(ProviderEffectNotStarted):
        execute_effect_command(
            _command(),
            adapters={"publish_x_post": lambda _payload, _context: (_ for _ in ()).throw(ProviderEffectNotStarted("socket never opened"))},
            claim=lambda _payload: {"outcome": "execute", "attempt": 1, "operationEpoch": 2},
            transition=lambda phase, payload: calls.append((phase, payload)),
            finalize=lambda payload: calls.append(("receipt", payload)),
            trace_id="b" * 32, claim_token="owner-1",
        )
    assert [entry[0] for entry in calls] == ["dispatched", "provider_not_started"]


def test_ordinary_post_dispatch_failure_becomes_unknown_and_is_never_finalized_failed():
    calls = []
    result = execute_effect_command(
        _command(),
        adapters={"publish_x_post": lambda _payload, _context: (_ for _ in ()).throw(TimeoutError("response lost"))},
        claim=lambda _payload: {"outcome": "execute", "attempt": 1, "operationEpoch": 2},
        transition=lambda phase, payload: calls.append((phase, payload)),
        finalize=lambda payload: calls.append(("receipt", payload)),
        trace_id="b" * 32, claim_token="owner-1",
    )
    assert result.outcome == "unknown"
    assert [entry[0] for entry in calls] == ["dispatched", "unknown"]
    assert "TimeoutError" in calls[1][1]["reason"]


def test_receipt_commit_failure_after_durable_observation_remains_observed_for_recovery():
    calls = []
    with pytest.raises(RuntimeError, match="receipt store unavailable"):
        execute_effect_command(
            _command(),
            adapters={"publish_x_post": lambda _payload, _context: {"outcome": "applied", "detail": {"id": "post-1"}}},
            claim=lambda _payload: {"outcome": "execute", "attempt": 1, "operationEpoch": 2},
            transition=lambda phase, payload: calls.append((phase, payload)),
            finalize=lambda _payload: (_ for _ in ()).throw(RuntimeError("receipt store unavailable")),
            trace_id="b" * 32, claim_token="owner-1",
        )
    assert [entry[0] for entry in calls] == ["dispatched", "observed"]


def test_artifact_export_adapter_records_both_immutable_object_identities():
    value = {
        "id": "artifact-1", "jobId": "job-1", "outputPlanId": "plan-1",
        "outputPlanDigest": "a" * 64, "outputType": "x_post", "revision": 1,
        "title": "Launch", "sourceSegmentRefs": ["source-1:segment-1"],
        "producer": {"role": "noni", "model": "muse-spark-1.3", "traceId": "b" * 32},
        "review": {"role": "dara", "traceId": "c" * 32, "decision": "accept"},
        "mimeType": "text/markdown", "createdAt": "2026-08-30T00:00:00.000Z",
        "payload": {"kind": "x_post", "text": "Launch"},
    }
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    artifact = {**value, "contentDigest": hashlib.sha256(canonical).hexdigest()}
    stored = []

    def create(**kwargs):
        stored.append(kwargs)
        content = kwargs["content"]
        return {"id": f"object-{len(stored)}", "sha256": hashlib.sha256(content).hexdigest()}

    with operation_scope("job:job-1:effect:command-1", 1):
        result = artifact_export_adapter(
            {"artifactId": "artifact-1", "artifactDigest": artifact["contentDigest"]},
            job_id="job-1", fetch=lambda *_args: artifact, create=create,
        )

    assert result["outcome"] == "applied"
    assert result["detail"]["markdownObjectId"] == "object-1"
    assert result["detail"]["jsonObjectId"] == "object-2"
    assert base64.b64decode(base64.b64encode(stored[1]["content"])) == stored[1]["content"]


def _sealed_artifact(artifact_id, payload, output_type):
    value = {
        "id": artifact_id, "jobId": "job-1", "outputPlanId": "plan-1",
        "outputPlanDigest": "a" * 64, "outputType": output_type, "revision": 1,
        "title": artifact_id, "sourceSegmentRefs": ["source-1:segment-1"],
        "producer": {"role": "noni", "model": "muse-spark-1.3", "traceId": "b" * 32},
        "review": {"role": "dara", "traceId": "c" * 32, "decision": "accept"},
        "mimeType": "text/markdown", "createdAt": "2026-08-30T00:00:00.000Z",
        "payload": payload,
    }
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return {**value, "contentDigest": hashlib.sha256(canonical).hexdigest()}


def test_content_pack_export_rejects_constituent_without_verified_bytes():
    constituent = _sealed_artifact("post-1", {"kind": "x_post", "text": "Launch"}, "x_post")
    pack = _sealed_artifact("pack-1", {"kind": "content_pack", "artifacts": [
        {"artifactId": constituent["id"], "digest": constituent["contentDigest"]},
    ]}, "content_pack")
    artifacts = {item["id"]: item for item in (constituent, pack)}
    with operation_scope("job:job-1:effect:command-pack", 1):
        with pytest.raises(ValueError, match="no verified export receipt"):
            artifact_export_adapter(
                {"artifactId": pack["id"], "artifactDigest": pack["contentDigest"]},
                job_id="job-1", fetch=lambda _job, artifact_id, _digest: artifacts[artifact_id],
                fetch_receipts=lambda _job: [], create=lambda **_kwargs: {},
            )


def test_content_pack_export_rereads_and_verifies_every_constituent():
    from harmonia_agent.artifact_export import export_content_artifact
    from harmonia_agent.content_artifacts import ContentArtifactRecord

    constituent = _sealed_artifact("post-1", {"kind": "x_post", "text": "Launch"}, "x_post")
    pack = _sealed_artifact("pack-1", {"kind": "content_pack", "artifacts": [
        {"artifactId": constituent["id"], "digest": constituent["contentDigest"]},
    ]}, "content_pack")
    objects = {}
    def store(content, _content_type):
        object_id = f"object-{len(objects) + 1}"
        objects[object_id] = content
        return {"id": object_id, "sha256": hashlib.sha256(content).hexdigest()}
    detail = export_content_artifact(ContentArtifactRecord.model_validate(constituent), store=store)
    artifacts = {item["id"]: item for item in (constituent, pack)}
    receipts = [{"actionType": "export_content_artifact", "outcome": "applied", "detail": detail}]
    with operation_scope("job:job-1:effect:command-pack", 1):
        result = artifact_export_adapter(
            {"artifactId": pack["id"], "artifactDigest": pack["contentDigest"]},
            job_id="job-1", fetch=lambda _job, artifact_id, _digest: artifacts[artifact_id],
            fetch_receipts=lambda _job: receipts,
            read=lambda object_id, **_window: {"dataBase64": base64.b64encode(objects[object_id]).decode()},
            create=lambda **kwargs: store(kwargs["content"], kwargs["content_type"]),
        )
    assert result["outcome"] == "applied"


def test_x_thread_adapter_resumes_from_durable_progress_and_persists_each_new_id():
    calls = []

    def publish(posts, token, *, confirmed, persist_confirmed):
        calls.append((posts, token, list(confirmed)))
        persist_confirmed([*confirmed, "x-2"])
        return {"postIds": [*confirmed, "x-2"], "rootId": confirmed[0], "url": "https://x.com/i/web/status/x-1"}

    command = {
        **_command(), "actionType": "publish_x_thread",
        "payload": {"posts": [{"id": "p1", "text": "One"}, {"id": "p2", "text": "Two"}]},
        "progress": {"kind": "x_thread", "confirmedPostIds": ["x-1"]},
    }
    transitions = []
    result = execute_effect_command(
        command,
        adapters={"publish_x_thread": lambda payload, context: x_thread_publish_adapter(
            payload, "token", context=context, publish=publish,
        )},
        claim=lambda _payload: {"outcome": "execute", "attempt": 2, "operationEpoch": 3},
        transition=lambda phase, payload: transitions.append((phase, payload)),
        finalize=lambda _payload: None, trace_id="b" * 32, claim_token="owner-1",
    )
    assert calls[0][2] == ["x-1"]
    assert [phase for phase, _ in transitions] == ["dispatched", "progress", "observed"]
    assert transitions[1][1]["progress"]["confirmedPostIds"] == ["x-1", "x-2"]
    assert result.outcome == "applied"
