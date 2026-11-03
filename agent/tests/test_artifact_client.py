from __future__ import annotations

from harmonia_agent import web_client
from harmonia_agent.operation_context import operation_scope
from harmonia_agent.tenant_context import tenant_scope


def test_artifact_client_uploads_and_reads_by_opaque_id(monkeypatch) -> None:
    calls = []

    class Response:
        status_code = 200
        text = ""

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, path, json):
            calls.append(("post", path, json))
            response = Response({"artifact": {"id": "artifact-1", "sha256": "a" * 64}})
            response.status_code = 201
            return response

        def get(self, path, params):
            calls.append(("get", path, params))
            return Response({"artifact": {"id": "artifact-1"}, "text": "tail"})

    monkeypatch.setattr(web_client, "_client", lambda: Client())
    with tenant_scope("workspace-1", "brand-1"):
        with operation_scope("job:job-1:stage:draft", 2):
            artifact = web_client.create_artifact(
                job_id="job-1",
                operation_id="job:job-1:stage:draft",
                content=b"full tool result",
                content_type="text/plain",
                trust="external_untrusted",
                producer={"kind": "tool", "id": "search", "version": "1"},
                retention_class="source",
            )
            page = web_client.read_artifact("artifact-1", line_start=4, line_count=10)

    assert artifact["id"] == "artifact-1"
    assert calls[0][1] == "/api/internal/artifacts"
    assert "dataBase64" in calls[0][2]
    assert calls[1] == (
        "get", "/api/internal/artifacts/artifact-1", {"lineStart": 4, "lineCount": 10}
    )
    assert page["text"] == "tail"


def test_context_projection_client_persists_the_digest_bound_manifest(monkeypatch) -> None:
    calls = []

    class Response:
        status_code = 201
        text = ""

        def json(self):
            return {"projection": {"id": "projection-1"}}

    class Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, path, json):
            calls.append((path, json))
            return Response()

    monkeypatch.setattr(web_client, "_client", lambda: Client())
    manifest = {
        "compilerVersion": "harmonia-context/v1",
        "operationId": "job:job-1:stage:draft",
        "operationEpoch": 2,
    }
    with tenant_scope("workspace-1", "brand-1"):
        with operation_scope("job:job-1:stage:draft", 2):
            result = web_client.save_context_projection(
                job_id="job-1",
                manifest=manifest,
                rendered_digest="a" * 64,
                rendered_chars=1200,
                rendered_artifact_id="018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
            )

    assert result == {"id": "projection-1"}
    assert calls == [("/api/internal/context-projections", {
        "jobId": "job-1",
        "manifest": manifest,
        "renderedDigest": "a" * 64,
        "renderedChars": 1200,
        "renderedArtifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
    })]


def test_content_artifact_client_reads_exact_revision_and_digest(monkeypatch) -> None:
    calls = []

    class Response:
        status_code = 200
        text = ""

        def json(self):
            return {"artifact": {"id": "content-1", "revision": 2, "contentDigest": "a" * 64}}

    class Client:
        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def get(self, path, params):
            calls.append((path, params))
            return Response()

    monkeypatch.setattr(web_client, "_client", lambda: Client())
    artifact = web_client.get_content_artifact("job-1", "content-1", "a" * 64)
    assert artifact["revision"] == 2
    assert calls == [("/api/internal/content-artifacts/content-1", {"jobId": "job-1", "digest": "a" * 64})]
