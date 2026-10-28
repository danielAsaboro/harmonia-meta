"""Execution boundary for managed Vertex AI Agent Engine teams."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import traceback
from collections.abc import AsyncIterator
from hashlib import sha256
from typing import Any, Protocol

from pydantic import ValidationError

from .ryan_skills import RYAN_SEARCH_TOOL
from .telemetry import safe_attributes, tracer

logger = logging.getLogger("harmonia.team_runtime")

_SPECIALIST_OUTPUT_KEYS = {
    "harmonia_intent_router": "intent_classification",
    "harmonia_context_assembler": "intent_strategy_context",
    "ryan_strategist": "strategist_result",
    "nimi_analyst": "source_analysis",
    "nimi_research_analyst": "source_analysis",
    "maya_presenter": "surface_plan",
    "noni_copywriter": "copywriter_draft",
    "dara_editor": "editorial_assessment",
    "noni_artifact_producer": "semantic_artifact_draft",
    "dara_artifact_editor": "semantic_artifact_review",
    "temi_editorial_planner": "editorial_plan",
}

class AgentEngineProtocolError(RuntimeError):
    """Managed runtime completed without a valid state handoff."""


class AgentEngineProviderError(RuntimeError):
    """Managed runtime transport or provider execution failed."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _provider_status(exc: BaseException) -> int | None:
    """Recover a safe HTTP-like status from a wrapped provider exception."""
    current: BaseException | None = exc
    while current is not None:
        for attribute in ("status_code", "status", "code"):
            value = getattr(current, attribute, None)
            if isinstance(value, int) and 100 <= value <= 599:
                return value
        current = current.__cause__ or current.__context__
    return None


class TeamRuntime(Protocol):
    async def invoke(
        self,
        *,
        specialist: str,
        payload: dict[str, Any],
        user_id: str,
        session_key: str,
    ) -> dict[str, Any]: ...


def _specialist_prompt_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove runtime envelopes that are not part of a specialist's strict input."""
    return {key: value for key, value in payload.items() if not key.startswith("_")}


def _specialist_session_state(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep audit envelopes outside the model-visible ADK session."""
    state = _specialist_prompt_payload(payload)
    for key in ("_harmonia_repair", "_harmonia_output_contract"):
        if payload.get(key):
            state[key] = payload[key]
    return state


def _invalid_adk_output(exc: ValidationError) -> dict[str, Any] | None:
    """Recover only the model object rejected by ADK's output-schema hook.

    Harmonia owns the richer typed handoff validator and bounded repair loop.
    Letting ADK turn this specific validation failure into a provider error
    bypasses that course-correction path entirely.
    """
    frames = traceback.extract_tb(exc.__traceback__)
    if not any(frame.name in {"validate_schema", "__maybe_save_output_to_state"} for frame in frames):
        return None
    candidates = [
        item.get("input") for item in exc.errors(
            include_url=False, include_context=False, include_input=True,
        )
        if isinstance(item.get("input"), dict)
    ]
    return max(candidates, key=len) if candidates else None


def _request_scoped_tools(specialist: str, payload: dict[str, Any], tools: list[Any]) -> list[Any]:
    if specialist == "nimi_analyst" and payload.get("researchRequest") is None:
        return []
    if specialist == "ryan_strategist" and payload.get("researchRequest") is None:
        return [tool for tool in tools if getattr(tool, "name", "") != RYAN_SEARCH_TOOL]
    return tools


class LocalAdkTeamRuntime:
    """Run the real ADK hierarchy in-process for local browser verification."""

    def __init__(self, agent: Any) -> None:
        self.agent = agent

    async def invoke(self, *, specialist: str, payload: dict[str, Any], user_id: str, session_key: str) -> dict[str, Any]:
        from google.adk.runners import InMemoryRunner
        from google.genai import types
        from .coordinator import authorized_specialist_name

        specialist_agent = self.agent.find_sub_agent(
            authorized_specialist_name(specialist, payload),
        )
        if specialist_agent is None:
            raise AgentEngineProtocolError(f"unknown local ADK specialist: {specialist}")
        runtime_tools = _request_scoped_tools(
            specialist, payload, list(specialist_agent.tools),
        )
        specialist_agent.tools = runtime_tools
        runner = InMemoryRunner(agent=self.agent, app_name="harmonia-local")
        session_id = f"harmonia-{sha256(f'{user_id}|{session_key}'.encode()).hexdigest()[:40]}"
        state: dict[str, Any] = {}
        response_texts: list[str] = []
        prompt = json.dumps(_specialist_prompt_payload(payload), separators=(",", ":"), ensure_ascii=False)
        try:
            await runner.session_service.create_session(
                app_name="harmonia-local",
                user_id=user_id,
                session_id=session_id,
                state={**_specialist_session_state(payload), "requested_specialist": specialist},
            )
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=types.Content(role="user", parts=[types.Part(text=prompt)]),
            ):
                state.update(_state_delta(event))
                content = getattr(event, "content", None)
                for part in getattr(content, "parts", []) or []:
                    if isinstance(getattr(part, "text", None), str):
                        response_texts.append(part.text)
            completed_session = await runner.session_service.get_session(
                app_name="harmonia-local", user_id=user_id, session_id=session_id,
            )
            if completed_session is not None:
                state.update(dict(completed_session.state))
            if specialist_agent.output_key and isinstance(state.get(specialist_agent.output_key), str):
                candidate = state[specialist_agent.output_key].strip()
                if candidate.startswith("```"):
                    candidate = candidate.removeprefix("```json").removeprefix("```")
                    candidate = candidate.removesuffix("```").strip()
                start, end = candidate.find("{"), candidate.rfind("}")
                if start >= 0 and end > start:
                    try:
                        state[specialist_agent.output_key] = json.loads(candidate[start:end + 1])
                    except json.JSONDecodeError:
                        pass
            if specialist_agent.output_key and specialist_agent.output_key not in state:
                for candidate in reversed(response_texts):
                    candidate = candidate.strip()
                    if candidate.startswith("```"):
                        candidate = candidate.removeprefix("```json").removeprefix("```")
                        candidate = candidate.removesuffix("```").strip()
                    start, end = candidate.find("{"), candidate.rfind("}")
                    if start >= 0 and end > start:
                        try:
                            state[specialist_agent.output_key] = json.loads(candidate[start:end + 1])
                            break
                        except json.JSONDecodeError:
                            continue
        except ValidationError as exc:
            invalid_output = _invalid_adk_output(exc)
            if invalid_output is None or not specialist_agent.output_key:
                raise AgentEngineProviderError(
                    f"local ADK invocation failed: {exc}", status=_provider_status(exc),
                ) from exc
            logger.warning(
                "local ADK output contract rejected for %s; forwarding to Harmonia repair validation",
                specialist,
            )
            state[specialist_agent.output_key] = invalid_output
        except Exception as exc:  # noqa: BLE001 - normalized runtime boundary
            chain: list[str] = []
            current: BaseException | None = exc
            while current is not None and len(chain) < 6:
                code = getattr(current, "status_code", None) or getattr(current, "code", None)
                chain.append(f"{type(current).__name__}:{code}" if code is not None else type(current).__name__)
                current = current.__cause__ or current.__context__
            logger.warning(
                "local ADK invocation failed for %s; exception chain=%s; stack=%s",
                specialist,
                " -> ".join(chain),
                " -> ".join(
                    f"{frame.name}:{frame.lineno}"
                    for frame in traceback.extract_tb(exc.__traceback__)[-6:]
                ),
            )
            raise AgentEngineProviderError(
                f"local ADK invocation failed: {exc}", status=_provider_status(exc),
            ) from exc
        if not state:
            raise AgentEngineProtocolError("local ADK returned no state delta")
        return state


def _session_id(session: Any) -> str:
    value = session.get("id") if isinstance(session, dict) else getattr(session, "id", None)
    if not value and isinstance(session, dict):
        name = session.get("name")
        value = str(name).rsplit("/", 1)[-1] if name else None
    if not value:
        raise AgentEngineProtocolError("Agent Engine did not return a managed session id")
    return str(value)


def _session_state(session: Any) -> dict[str, Any]:
    value = session.get("state") if isinstance(session, dict) else getattr(session, "state", None)
    return dict(value) if isinstance(value, dict) else {}


def _persisted_delta(session: Any, seeded_state: dict[str, Any]) -> dict[str, Any]:
    state = _session_state(session)
    return {
        key: value for key, value in state.items()
        if key not in seeded_state or value != seeded_state[key]
    }


async def _managed_session_call(remote: Any, operation: str, **kwargs: Any) -> Any:
    """Use Agent Engine's async session surface when it is available.

    Recent Agent Engine remotes expose ``async_get_session`` and
    ``async_create_session`` without their synchronous counterparts. Older
    deployed engines expose the synchronous methods. Support exactly either
    documented surface; a missing operation remains a protocol failure.
    """
    async_method = getattr(remote, f"async_{operation}", None)
    if callable(async_method):
        result = async_method(**kwargs)
        return await result if inspect.isawaitable(result) else result
    method = getattr(remote, operation, None)
    if not callable(method):
        raise AgentEngineProtocolError(
            f"Agent Engine does not expose {operation} or async_{operation}"
        )
    result = await asyncio.to_thread(method, **kwargs)
    return await result if inspect.isawaitable(result) else result


def _is_missing_session_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "session not found" in message and (
        isinstance(exc, RuntimeError) or "create_session" in message
    )


def _state_delta(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        event = event.model_dump(mode="json") if hasattr(event, "model_dump") else {}
    actions = event.get("actions") or {}
    delta = actions.get("state_delta") or actions.get("stateDelta") or {}
    return dict(delta) if isinstance(delta, dict) else {}


def _structured_content(event: Any) -> dict[str, Any] | None:
    """Read only a JSON object actually emitted in an ADK response event."""
    if not isinstance(event, dict):
        event = event.model_dump(mode="json", by_alias=True) if hasattr(event, "model_dump") else {}
    content = event.get("content") or {}
    for part in reversed(content.get("parts") or []):
        text = part.get("text") if isinstance(part, dict) else None
        if not isinstance(text, str):
            continue
        candidate = text.strip()
        if candidate.startswith("```"):
            candidate = candidate.removeprefix("```json").removeprefix("```")
            candidate = candidate.removesuffix("```").strip()
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            continue
        try:
            value = json.loads(candidate[start:end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _raise_for_event_error(event: Any) -> None:
    """Turn ADK terminal error events into provider failures before state recovery."""
    if not isinstance(event, dict):
        event = event.model_dump(mode="json", by_alias=True) if hasattr(event, "model_dump") else {}
    code = event.get("error_code") or event.get("errorCode")
    message = event.get("error_message") or event.get("errorMessage")
    if not code and not message:
        return
    normalized = str(code or "").upper()
    status = {
        "RESOURCE_EXHAUSTED": 429,
        "DEADLINE_EXCEEDED": 504,
        "UNAVAILABLE": 503,
        "UNAUTHENTICATED": 401,
        "PERMISSION_DENIED": 403,
        "INVALID_ARGUMENT": 400,
    }.get(normalized)
    raise AgentEngineProviderError(
        f"managed ADK event failed: {normalized or 'UNKNOWN'}", status=status,
    )


def _invoke_sync_remote(
    remote: Any, *, user_id: str, session_id: str,
    seeded_state: dict[str, Any], prompt: str,
) -> dict[str, Any]:
    try:
        session = remote.create_session(
            user_id=user_id, session_id=session_id, state=seeded_state,
        )
    except Exception as create_exc:
        try:
            session = remote.get_session(user_id=user_id, session_id=session_id)
        except Exception:
            raise create_exc
        if session is None:
            raise create_exc
    if _session_id(session) != session_id:
        raise AgentEngineProtocolError("Agent Engine returned the wrong managed session")
    state: dict[str, Any] = {}
    try:
        for event in remote.stream_query(
            user_id=user_id, session_id=session_id, message=prompt,
        ):
            _raise_for_event_error(event)
            state.update(_state_delta(event))
    except Exception:
        # Agent Engine may durably commit the specialist handoff before its SSE
        # transport terminates. Recover only state that differs from our seed;
        # downstream specialist validators still fail closed on partial output.
        recovered = _persisted_delta(
            remote.get_session(user_id=user_id, session_id=session_id), seeded_state,
        )
        if not recovered:
            raise
        state.update(recovered)
    else:
        # Agent Engine can commit output_key directly to durable session state
        # while emitting only text/status stream events. Merge that authoritative
        # delta after a successful stream as well as after transport recovery.
        try:
            state.update(_persisted_delta(
                remote.get_session(user_id=user_id, session_id=session_id), seeded_state,
            ))
        except Exception:
            if not state:
                raise
    return state


class AgentEngineTeamRuntime:
    """Managed runtime adapter with deterministic, restart-resumable sessions."""

    def __init__(self, *, resource_name: str, client: Any | None = None) -> None:
        if not resource_name.startswith("projects/") or "/reasoningEngines/" not in resource_name:
            raise ValueError("AGENT_ENGINE_RESOURCE must be a full reasoning engine resource name")
        self.resource_name = resource_name
        self._client = client

    def _remote(self) -> Any:
        client = self._client
        if client is None:
            try:
                import vertexai
            except ImportError as exc:  # pragma: no cover - deployment dependency
                raise AgentEngineProviderError(
                    "google-cloud-aiplatform agent_engines support is not installed"
                ) from exc
            project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
            location = os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
            if not project or not location:
                raise AgentEngineProviderError(
                    "GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required "
                    "for the managed Agent Engine client"
                )
            client = vertexai.Client(
                project=project,
                location=location,
                http_options={"timeout": 300_000},
            )
            # Engine handles share the parent's BaseApiClient. Retain the
            # parent for this runtime's lifetime or its async transport may be
            # finalized before async_get_session/async_stream_query executes.
            self._client = client
        try:
            return client.agent_engines.get(name=self.resource_name)
        except Exception as exc:  # noqa: BLE001 - normalized at provider boundary
            raise AgentEngineProviderError(
                f"failed to resolve Agent Engine: {exc}", status=_provider_status(exc),
            ) from exc

    async def invoke(
        self,
        *,
        specialist: str,
        payload: dict[str, Any],
        user_id: str,
        session_key: str,
    ) -> dict[str, Any]:
        remote = self._remote()
        seeded_state = _specialist_session_state(payload)
        seeded_state["requested_specialist"] = specialist
        session_id = f"harmonia-{sha256(f'{user_id}|{session_key}'.encode()).hexdigest()[:40]}"
        state: dict[str, Any] = {}
        with tracer().start_as_current_span("harmonia.agent_runtime.invoke") as span:
            span.set_attributes(safe_attributes({
                "runtime": "agent_engine",
                "agent": specialist,
                "resource": self.resource_name,
            }))
            try:
                if not callable(getattr(remote, "async_stream_query", None)) or not any(
                    callable(getattr(remote, name, None))
                    for name in ("get_session", "async_get_session")
                ) or not any(
                    callable(getattr(remote, name, None))
                    for name in ("create_session", "async_create_session")
                ):
                    raise AgentEngineProtocolError(
                        "Agent Engine does not expose Harmonia's required async ADK interface"
                    )
                try:
                    session = await _managed_session_call(
                        remote, "get_session", user_id=user_id, session_id=session_id,
                    )
                except Exception as exc:  # provider SDK wraps this in multiple exception types
                    if not _is_missing_session_error(exc):
                        raise
                    session = None
                if session is None:
                    try:
                        session = await _managed_session_call(
                            remote, "create_session",
                            user_id=user_id, session_id=session_id, state=seeded_state,
                        )
                    except Exception:  # a concurrent creator may have won
                        session = await _managed_session_call(
                            remote, "get_session", user_id=user_id, session_id=session_id,
                        )
                        if session is None:
                            raise
                if _session_id(session) != session_id:
                    raise AgentEngineProtocolError("Agent Engine returned the wrong managed session")
                prompt = json.dumps(
                    _specialist_prompt_payload(payload),
                    separators=(",", ":"), ensure_ascii=False,
                )
                emitted_output: dict[str, Any] | None = None
                try:
                    events: AsyncIterator[Any] = remote.async_stream_query(
                        user_id=user_id,
                        session_id=session_id,
                        message=prompt,
                    )
                    async for event in events:
                        _raise_for_event_error(event)
                        state.update(_state_delta(event))
                        if candidate := _structured_content(event):
                            emitted_output = candidate
                except Exception:
                    recovered = _persisted_delta(
                        await _managed_session_call(
                            remote, "get_session", user_id=user_id, session_id=session_id,
                        ),
                        seeded_state,
                    )
                    if not recovered:
                        raise
                    state.update(recovered)
                else:
                    # See the synchronous adapter: a completed managed stream
                    # is not guaranteed to carry the output_key state delta.
                    try:
                        state.update(_persisted_delta(
                            await _managed_session_call(
                                remote, "get_session", user_id=user_id, session_id=session_id,
                            ),
                            seeded_state,
                        ))
                    except Exception:
                        if not state:
                            raise
                output_key = _SPECIALIST_OUTPUT_KEYS.get(specialist)
                if output_key and output_key not in state and emitted_output is not None:
                    # Managed Agent Engine can return a provider-authored structured
                    # response without mirroring ADK's output_key into session state.
                    # Preserve that exact object; the caller's specialist validator
                    # remains the sole authority on whether it is acceptable.
                    state[output_key] = emitted_output
            except (AgentEngineProtocolError, AgentEngineProviderError):
                raise
            except Exception as exc:  # noqa: BLE001 - normalized at provider boundary
                chain: list[str] = []
                current: BaseException | None = exc
                while current is not None and len(chain) < 6:
                    chain.append(type(current).__name__)
                    current = current.__cause__ or current.__context__
                logger.warning(
                    "managed Agent Engine invocation failed status=%s chain=%s stack=%s",
                    _provider_status(exc), " -> ".join(chain),
                    " -> ".join(
                        f"{frame.name}:{frame.lineno}"
                        for frame in traceback.extract_tb(exc.__traceback__)[-8:]
                    ),
                )
                raise AgentEngineProviderError(
                    f"Agent Engine invocation failed: {exc}", status=_provider_status(exc),
                ) from exc
            if not state:
                raise AgentEngineProtocolError("Agent Engine returned no state delta")
            span.set_attribute("state.key_count", len(state))
            return state
