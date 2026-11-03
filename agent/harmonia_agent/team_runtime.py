"""In-process execution boundary for the ADK specialist team."""

from __future__ import annotations

import json
import logging
import traceback
from hashlib import sha256
from typing import Any, Protocol

from pydantic import ValidationError

from .ryan_skills import RYAN_SEARCH_TOOL

logger = logging.getLogger("harmonia.team_runtime")


class TeamRuntimeProtocolError(RuntimeError):
    """The team run completed without a valid state handoff."""


class TeamRuntimeProviderError(RuntimeError):
    """The team run's model transport or provider execution failed."""

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


class AdkTeamRuntime:
    """Run the ADK hierarchy in-process inside the worker."""

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
            raise TeamRuntimeProtocolError(f"unknown ADK specialist: {specialist}")
        runtime_tools = _request_scoped_tools(
            specialist, payload, list(specialist_agent.tools),
        )
        specialist_agent.tools = runtime_tools
        runner = InMemoryRunner(agent=self.agent, app_name="harmonia")
        session_id = f"harmonia-{sha256(f'{user_id}|{session_key}'.encode()).hexdigest()[:40]}"
        state: dict[str, Any] = {}
        response_texts: list[str] = []
        prompt = json.dumps(_specialist_prompt_payload(payload), separators=(",", ":"), ensure_ascii=False)
        try:
            await runner.session_service.create_session(
                app_name="harmonia",
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
                app_name="harmonia", user_id=user_id, session_id=session_id,
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
                raise TeamRuntimeProviderError(
                    f"ADK invocation failed: {exc}", status=_provider_status(exc),
                ) from exc
            logger.warning(
                "ADK output contract rejected for %s; forwarding to Harmonia repair validation",
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
                "ADK invocation failed for %s; exception chain=%s; stack=%s",
                specialist,
                " -> ".join(chain),
                " -> ".join(
                    f"{frame.name}:{frame.lineno}"
                    for frame in traceback.extract_tb(exc.__traceback__)[-6:]
                ),
            )
            raise TeamRuntimeProviderError(
                f"ADK invocation failed: {exc}", status=_provider_status(exc),
            ) from exc
        if not state:
            raise TeamRuntimeProtocolError("ADK returned no state delta")
        return state


def _state_delta(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        event = event.model_dump(mode="json") if hasattr(event, "model_dump") else {}
    actions = event.get("actions") or {}
    delta = actions.get("state_delta") or actions.get("stateDelta") or {}
    return dict(delta) if isinstance(delta, dict) else {}
