"""Managed Agent Engine runtime contracts."""

from __future__ import annotations

import asyncio
import json
import os

import pytest
from google.adk.agents import Agent
from google.adk.models._capabilities import LlmCapabilities
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from harmonia_agent.team_runtime import (
    AgentEngineProviderError,
    AgentEngineProtocolError,
    AgentEngineTeamRuntime,
    LocalAdkTeamRuntime,
    _request_scoped_tools,
    _specialist_prompt_payload,
)
from harmonia_agent.agent_models import SourceAnalysis
from harmonia_agent.agent_engine_app import build_agent_engine_app
from harmonia_agent.agent_engine_deploy import build_deployment_config, deploy
from harmonia_agent.agents import _resolve_role_models
from harmonia_agent.coordinator import HarmoniaCoordinator


class _RemoteAgent:
    def __init__(self) -> None:
        self.created: list[dict] = []
        self.queries: list[dict] = []
        self.deleted: list[dict] = []
        self.sessions: dict[str, dict] = {}

    async def async_get_session(self, **kwargs):
        return self.sessions.get(kwargs["session_id"])

    def get_session(self, **kwargs):
        return self.sessions.get(kwargs["session_id"])

    async def async_create_session(self, **kwargs):
        self.created.append(kwargs)
        session = {"id": kwargs["session_id"], "state": dict(kwargs["state"])}
        self.sessions[kwargs["session_id"]] = session
        return session

    def create_session(self, **kwargs):
        self.created.append(kwargs)
        session = {"id": kwargs["session_id"], "state": dict(kwargs["state"])}
        self.sessions[kwargs["session_id"]] = session
        return session

    async def async_stream_query(self, **kwargs):
        self.queries.append(kwargs)
        yield {
            "author": "nimi_analyst",
            "actions": {"state_delta": {
                "source_analysis": {
                    "summary": "Managed analysis",
                    "moments": [],
                    "angles": [],
                },
            }},
        }

    async def async_delete_session(self, **kwargs):
        self.deleted.append(kwargs)


def test_local_specialist_prompt_excludes_runtime_only_projection() -> None:
    payload = {
        "title": "Demo",
        "transcript": "proof",
        "_durable_context_projection": {"manifestDigest": "a" * 64},
    }
    assert _specialist_prompt_payload(payload) == {
        "title": "Demo",
        "transcript": "proof",
    }


def test_nimi_research_tool_is_absent_without_a_typed_research_request() -> None:
    tools = [object()]
    assert _request_scoped_tools("nimi_analyst", {"researchRequest": None}, tools) == []
    assert _request_scoped_tools(
        "nimi_analyst", {"researchRequest": {"mode": "public_web"}}, tools,
    ) == tools


def test_deployed_specialist_selection_requires_typed_research_authority() -> None:
    from harmonia_agent.coordinator import authorized_specialist_name

    assert authorized_specialist_name("nimi_analyst", {"researchRequest": None}) == "nimi_analyst"
    assert authorized_specialist_name(
        "nimi_analyst", {"researchRequest": {"mode": "public_web"}},
    ) == "nimi_research_analyst"
    assert authorized_specialist_name("ryan_strategist", {}) == "ryan_strategist"
    assert authorized_specialist_name("ryan_strategist", {"researchRequest": {"id": "research-1"}}) == "ryan_research_strategist"


class _InvalidStructuredOutputModel(BaseLlm):
    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
            text='{"groundedMoments":[],"gapsAndCritique":[]}',
        )]))


class _ValidStructuredOutputModel(BaseLlm):
    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=(
            '{"sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",'
            '"summary":"Grounded analysis","moments":[],"angles":[{"id":"angle-1",'
            '"angleType":"source_insight","evidenceKind":"source","title":"Source proof",'
            '"rationale":"The supplied source contains a claim.","evidenceRefs":["segment-1"],'
            '"assumptions":[],"confidence":"medium"}],"assumptions":[],"confidence":"medium"}'
        ))]))


def _local_runtime(model: BaseLlm) -> LocalAdkTeamRuntime:
    specialist = Agent(
        name="nimi_analyst", model=model, instruction="Return SourceAnalysis JSON.",
        output_schema=SourceAnalysis, output_key="source_analysis", mode="single_turn",
    )
    root = HarmoniaCoordinator(
        name="harmonia_coordinator",
        sub_agents=[specialist],
    )
    return LocalAdkTeamRuntime(root)


def test_local_runtime_runs_valid_single_turn_specialist_under_a_workflow_root() -> None:
    state = asyncio.run(_local_runtime(_ValidStructuredOutputModel(model="valid-output")).invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo"},
        user_id="workspace:user",
        session_key="job:understand:0",
    ))

    assert state["source_analysis"]["summary"] == "Grounded analysis"


def test_local_runtime_forwards_rejected_output_to_harmonia_contract_repair() -> None:
    state = asyncio.run(_local_runtime(_InvalidStructuredOutputModel(model="invalid-output")).invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo"},
        user_id="workspace:user",
        session_key="job:understand:0",
    ))

    assert state["source_analysis"] == {"groundedMoments": [], "gapsAndCritique": []}


class _AgentEngines:
    def __init__(self, remote: _RemoteAgent) -> None:
        self.remote = remote
        self.get_calls: list[str] = []

    def get(self, *, name: str):
        self.get_calls.append(name)
        return self.remote


class _Client:
    def __init__(self, remote: _RemoteAgent) -> None:
        self.agent_engines = _AgentEngines(remote)


def test_runtime_module_exposes_managed_runtime_only():
    import harmonia_agent.team_runtime as runtime

    assert not hasattr(runtime, "runtime_mode")
    assert not hasattr(runtime, "RuntimeMode")


def test_runtime_configures_managed_client_for_long_role_streams(monkeypatch):
    """Catches the SDK's default request timeout cutting off Ryan mid-stream."""

    import vertexai

    captured = {}

    class AgentEngines:
        def get(self, *, name):
            return {"name": name}

    def client(**kwargs):
        captured.update(kwargs)
        return type("Client", (), {"agent_engines": AgentEngines()})()

    monkeypatch.setattr(vertexai, "Client", client)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "p")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
    )

    runtime._remote()

    assert runtime._client is not None
    assert captured == {
        "project": "p",
        "location": "us-central1",
        "http_options": {"timeout": 300_000},
    }


def test_agent_engine_runtime_seeds_a_deterministic_persistent_session_and_collects_deltas():
    remote = _RemoteAgent()
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(remote),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo", "transcript": "proof"},
        user_id="job-123",
        session_key="job-123:understand:0:nimi_analyst",
    ))

    assert state["source_analysis"]["summary"] == "Managed analysis"
    assert remote.created == [{
        "user_id": "job-123",
        "session_id": remote.created[0]["session_id"],
        "state": {
            "title": "Demo",
            "transcript": "proof",
            "requested_specialist": "nimi_analyst",
        },
    }]
    assert remote.created[0]["session_id"].startswith("harmonia-")
    assert remote.queries[0]["session_id"] == remote.created[0]["session_id"]
    assert json.loads(remote.queries[0]["message"]) == {
        "title": "Demo", "transcript": "proof",
    }
    assert remote.deleted == []


def test_agent_engine_runtime_accepts_async_only_session_api():
    class AsyncOnlyRemote(_RemoteAgent):
        get_session = None
        create_session = None

    remote = AsyncOnlyRemote()
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(remote),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo", "transcript": "proof"},
        user_id="job-123",
        session_key="job-123:understand:0:nimi_analyst",
    ))

    assert state["source_analysis"]["summary"] == "Managed analysis"
    assert len(remote.created) == 1


def test_runtime_creates_session_when_managed_sdk_raises_not_found():
    class SdkAccurateRemote(_RemoteAgent):
        async def async_get_session(self, **kwargs):
            session = self.sessions.get(kwargs["session_id"])
            if session is None:
                raise RuntimeError("Session not found")
            return session

    remote = SdkAccurateRemote()
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(remote),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo", "transcript": "proof"},
        user_id="job-123",
        session_key="job-123:understand:0:nimi_analyst",
    ))

    assert state["source_analysis"]["summary"] == "Managed analysis"
    assert len(remote.created) == 1


def test_runtime_creates_session_when_managed_sdk_wraps_not_found_in_client_error():
    class ClientError(Exception):
        pass

    class RealErrorShapeRemote(_RemoteAgent):
        async def async_get_session(self, **kwargs):
            session = self.sessions.get(kwargs["session_id"])
            if session is None:
                raise ClientError(
                    "400 INVALID_ARGUMENT: Agent Engine Error: Session not found. "
                    "Please create it using .create_session()"
                )
            return session

    remote = RealErrorShapeRemote()
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(remote),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo", "transcript": "proof"},
        user_id="job-123",
        session_key="job-123:understand:0:nimi_analyst",
    ))

    assert state["source_analysis"]["summary"] == "Managed analysis"
    assert len(remote.created) == 1


def test_runtime_rejects_agent_engine_without_async_streaming_interface():
    class SyncOnlyRemote:
        def get_session(self, **kwargs):
            return None

        def create_session(self, **kwargs):
            return {"id": kwargs["session_id"], "state": kwargs["state"]}

        def stream_query(self, **kwargs):
            yield {}

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(SyncOnlyRemote()),
    )

    with pytest.raises(AgentEngineProtocolError, match="required async ADK interface"):
        asyncio.run(runtime.invoke(
            specialist="nimi_analyst", payload={"title": "Demo"},
            user_id="job-123", session_key="op-1",
        ))


def test_async_runtime_recovers_persisted_state_when_stream_terminates_after_handoff():
    class AsyncInterruptedRemote(_RemoteAgent):
        async def async_stream_query(self, **kwargs):
            self.sessions[kwargs["session_id"]]["state"].update({
                "source_analysis": {"summary": "Persisted async analysis", "moments": [], "angles": []},
            })
            raise RuntimeError("managed async SSE stream terminated")
            yield  # pragma: no cover

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(AsyncInterruptedRemote()),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst", payload={"title": "Demo"},
        user_id="job-123", session_key="op-1",
    ))

    assert state["source_analysis"]["summary"] == "Persisted async analysis"


def test_async_runtime_recovers_persisted_state_when_successful_stream_has_no_state_delta():
    class PersistedOnlyRemote(_RemoteAgent):
        async def async_stream_query(self, **kwargs):
            self.sessions[kwargs["session_id"]]["state"].update({
                "source_analysis": {"summary": "Persisted successful analysis", "moments": [], "angles": []},
            })
            yield {"author": "nimi_analyst", "content": {"parts": [{"text": "done"}]}}

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(PersistedOnlyRemote()),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst", payload={"title": "Demo"},
        user_id="job-123", session_key="op-1",
    ))

    assert state["source_analysis"]["summary"] == "Persisted successful analysis"


def test_async_runtime_recovers_valid_structured_content_when_agent_engine_omits_output_state():
    class ContentOnlyRemote(_RemoteAgent):
        async def async_stream_query(self, **kwargs):
            yield {
                "author": "nimi_analyst",
                "content": {"parts": [{"text": json.dumps({
                    "summary": "Provider-emitted analysis",
                    "moments": [],
                    "angles": [],
                    "assumptions": [],
                    "confidence": 0.7,
                })}]},
            }

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(ContentOnlyRemote()),
    )

    state = asyncio.run(runtime.invoke(
        specialist="nimi_analyst", payload={"title": "Demo"},
        user_id="job-123", session_key="op-1",
    ))

    assert state["source_analysis"]["summary"] == "Provider-emitted analysis"


def test_async_runtime_surfaces_terminal_provider_error_event():
    class QuotaErrorRemote(_RemoteAgent):
        async def async_stream_query(self, **kwargs):
            yield {"errorCode": "RESOURCE_EXHAUSTED", "errorMessage": "quota exceeded"}

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(QuotaErrorRemote()),
    )

    with pytest.raises(AgentEngineProviderError) as caught:
        asyncio.run(runtime.invoke(
            specialist="nimi_analyst", payload={"title": "Demo"},
            user_id="job-123", session_key="op-1",
        ))
    assert caught.value.status == 429


def test_runtime_resumes_the_same_managed_session_after_process_restart():
    remote = _RemoteAgent()
    kwargs = dict(
        specialist="nimi_analyst", payload={"title": "Demo", "transcript": "proof"},
        user_id="job-123", session_key="job-123:understand:0:nimi_analyst",
    )
    first = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42", client=_Client(remote),
    )
    asyncio.run(first.invoke(**kwargs))
    restarted = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42", client=_Client(remote),
    )
    asyncio.run(restarted.invoke(**kwargs))

    assert len(remote.created) == 1
    assert len(remote.queries) == 2
    assert remote.queries[0]["session_id"] == remote.queries[1]["session_id"]


def test_runtime_keeps_audit_projection_out_of_model_visible_session_state():
    remote = _RemoteAgent()
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(remote),
    )
    asyncio.run(runtime.invoke(
        specialist="nimi_analyst",
        payload={
            "title": "Demo",
            "_durable_context_projection": {
                "manifestDigest": "a" * 64,
                "rendered": "# AUTHORITY — PINNED, NON-COMPACTABLE",
            },
        },
        user_id="job-123",
        session_key="op-1:projection-a",
    ))
    assert json.loads(remote.queries[0]["message"]) == {"title": "Demo"}
    assert "_durable_context_projection" not in remote.created[0]["state"]
    assert "_durable_context_projection" not in remote.queries[0]["message"]


def test_runtime_never_mutates_the_caller_payload_or_retrieved_session_state():
    class ReadOnlySessionRemote(_RemoteAgent):
        async def async_create_session(self, **kwargs):
            self.created.append(kwargs)
            return {"id": kwargs["session_id"], "state": _MutationTrap()}

    class _MutationTrap(dict):
        def __setitem__(self, key, value):
            raise AssertionError("retrieved session state must not be mutated")

        def update(self, *args, **kwargs):
            raise AssertionError("retrieved session state must not be mutated")

    payload = {"title": "Demo", "nested": {"evidence": "bounded"}}
    original = {"title": "Demo", "nested": {"evidence": "bounded"}}
    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(ReadOnlySessionRemote()),
    )
    asyncio.run(runtime.invoke(
        specialist="nimi_analyst", payload=payload, user_id="job-123", session_key="op-1",
    ))
    assert payload == original


def test_agent_engine_runtime_rejects_response_text_without_authoritative_state():
    class EmptyRemote(_RemoteAgent):
        async def async_stream_query(self, **kwargs):
            yield {"author": "harmonia_coordinator", "content": {"parts": [{"text": "done"}]}}

    runtime = AgentEngineTeamRuntime(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(EmptyRemote()),
    )

    with pytest.raises(AgentEngineProtocolError, match="state delta"):
        asyncio.run(runtime.invoke(
            specialist="nimi_analyst", payload={"title": "Demo", "transcript": "proof"},
            user_id="job-123", session_key="op-1",
        ))


def test_agent_engine_deployment_wraps_the_existing_root_hierarchy():
    class FakeAdkApp:
        def __init__(self, *, app):
            self.app = app

    app = build_agent_engine_app(adk_app_type=FakeAdkApp, model="muse-test")

    assert app.app.name == "harmonia"
    assert app.app.root_agent.name == "harmonia_coordinator"
    assert [agent.name for agent in app.app.root_agent.sub_agents] == [
        "harmonia_intent_router",
        "harmonia_context_assembler",
        "ryan_strategist", "ryan_research_strategist", "nimi_analyst", "nimi_research_analyst", "temi_editorial_planner",
        "noni_copywriter", "dara_editor", "noni_artifact_producer",
        "dara_artifact_editor", "maya_presenter", "nova_liaison",
    ]


def test_agent_engine_serializes_role_models_without_credentials(monkeypatch):
    class FakeAdkApp:
        def __init__(self, *, app):
            self.app = app

    monkeypatch.setenv("MODEL_API_KEY", "must-not-be-serialized")
    app = build_agent_engine_app(adk_app_type=FakeAdkApp)

    router = app.app.root_agent.find_sub_agent("harmonia_intent_router")
    assert router.model.model == "openai/muse-spark-1.3"
    assert "api_key" not in router.model._additional_args
    assert "must-not-be-serialized" not in repr(router.model.model_dump())


def test_agent_engine_deployment_config_is_narrow_and_reproducible():
    config = build_deployment_config(
        staging_bucket="gs://harmonia-agent-staging",
        service_account="harmonia-agent@p.iam.gserviceaccount.com",
        environment={
            "COORDINATOR_MODEL_ID": "muse-spark-1.2",
            "PRESENTER_MODEL_ID": "muse-spark-1.3",
            "COPYWRITER_MODEL_ID": "muse-spark-1.3",
            "WEB_INTERNAL_URL": "https://harmonia-web.example",
            "GEMINI_VERTEX_LOCATION": "global",
            "GOOGLE_CSE_ID": "search-engine-1",
            "GOOGLE_CLOUD_PROJECT": "must-be-runtime-injected",
            "GOOGLE_CLOUD_LOCATION": "must-be-runtime-injected",
            "INTERNAL_API_TOKEN": "must-not-be-forwarded",
        },
    )
    assert config["staging_bucket"] == "gs://harmonia-agent-staging"
    assert config["service_account"] == "harmonia-agent@p.iam.gserviceaccount.com"
    assert "google-cloud-aiplatform[agent_engines,adk]==1.165.1" in config["requirements"]
    assert "google-adk==2.7.1" in config["requirements"]
    assert "litellm==1.106.6" in config["requirements"]
    assert "opentelemetry-exporter-otlp-proto-grpc>=1.42,<2" in config["requirements"]
    assert "google-cloud-firestore>=2.19" in config["requirements"]
    assert config["extra_packages"] == ["harmonia_agent"]
    assert config["env_vars"] == {
        "COORDINATOR_MODEL_ID": "muse-spark-1.2",
        "PRESENTER_MODEL_ID": "muse-spark-1.3",
        "COPYWRITER_MODEL_ID": "muse-spark-1.3",
        "WEB_INTERNAL_URL": "https://harmonia-web.example",
        "INTERNAL_API_TOKEN": {"secret": "internal-api-token", "version": "latest"},
        "MODEL_API_KEY": {"secret": "model-api-key", "version": "latest"},
    }


def test_agent_engine_deploy_initializes_vertex_before_serializing_app(monkeypatch):
    import vertexai
    import harmonia_agent.agent_engine_deploy as deployment

    initialized = {}

    class Remote:
        api_resource = type("Resource", (), {
            "name": "projects/p/locations/us-central1/reasoningEngines/42",
        })()

    class AgentEngines:
        def create(self, **kwargs):
            assert kwargs["agent"] == "serialized-app"
            return Remote()

    monkeypatch.setattr(vertexai, "init", lambda **kwargs: initialized.update(kwargs))
    monkeypatch.setattr(
        vertexai, "Client", lambda **kwargs: type("Client", (), {
            "agent_engines": AgentEngines(),
        })(),
    )
    monkeypatch.setattr(
        deployment, "build_agent_engine_app", lambda **kwargs: "serialized-app",
    )

    resource = deploy(
        project="p", location="us-central1", staging_bucket="gs://p-staging",
        service_account="harmonia-agent@p.iam.gserviceaccount.com",
    )

    assert initialized == {"project": "p", "location": "us-central1"}
    assert resource.endswith("reasoningEngines/42")


def test_role_models_bind_each_provider_endpoint_at_call_time(monkeypatch):
    monkeypatch.setenv("COORDINATOR_MODEL_ID", "muse-spark-1.2")
    monkeypatch.setenv("ANALYST_PROVIDER", "baseten")
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")

    models = _resolve_role_models()

    assert models.coordinator.model == "openai/muse-spark-1.2"
    assert models.coordinator.endpoint() == ("https://api.meta.ai/v1", "meta-key")
    assert models.analyst.model == "openai/meta-models/muse-spark-open-1026"
    assert models.analyst.endpoint() == ("https://inference.baseten.co/v1", "baseten-key")


def test_role_model_call_fails_closed_without_its_api_key(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)

    models = _resolve_role_models()

    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        models.coordinator.endpoint()
