"""Every specialist's first request, captured on the wire, is one Meta accepts.

Each agent in the built team runs one turn against a local server that speaks
Chat Completions. The captured body must carry the role's model, reasoning
effort and cache key, a structured-output schema inside Meta's strict subset
and limits (docs/meta/structured-output.md), and no parameter Muse Spark
rejects. A request that never leaves the process (for example a missing
dependency on the tool-calling path) fails here instead of on launch day.
"""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from google.adk.runners import InMemoryRunner
from google.genai import types

from harmonia_agent.agents import build_agent_team

REJECTED_PARAMS = {"logprobs", "top_logprobs", "temperature", "top_k"}


def _strict_subset_problems(schema: dict, path: str = "$", depth: int = 0) -> list[str]:
    problems: list[str] = []
    if depth > 10:
        problems.append(f"{path}: nesting deeper than 10")
    for key in ("allOf", "oneOf"):
        if key in schema:
            problems.append(f"{path}: {key} is not supported")
    if schema.get("type") == "object" or "properties" in schema:
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is not False:
            problems.append(f"{path}: additionalProperties must be false")
        if sorted(schema.get("required", [])) != sorted(properties):
            problems.append(f"{path}: required must list every property")
        for name, child in properties.items():
            problems += _strict_subset_problems(child, f"{path}.{name}", depth + 1)
    if isinstance(schema.get("items"), dict):
        problems += _strict_subset_problems(schema["items"], f"{path}[]", depth + 1)
    for option in schema.get("anyOf", []):
        problems += _strict_subset_problems(option, path, depth)
    for name, child in (schema.get("$defs") or {}).items():
        problems += _strict_subset_problems(child, f"$defs.{name}", depth)
    return problems


@pytest.fixture()
def captured(monkeypatch):
    bodies: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - http.server API
            bodies.append({"path": self.path, **json.loads(self.rfile.read(int(self.headers["content-length"])))})
            payload = json.dumps({
                "id": "c", "object": "chat.completion", "created": 0, "model": "m",
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "{}"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    for name in ("STRATEGIST_MODEL_ID", "STRATEGIST_PROVIDER", "ANALYST_PROVIDER", "COPYWRITER_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("META_API_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    yield bodies
    server.shutdown()


async def _one_turn(agent) -> None:
    runner = InMemoryRunner(agent=agent, app_name="wire")
    session = await runner.session_service.create_session(app_name="wire", user_id="u")
    try:
        async for _event in runner.run_async(
            user_id="u", session_id=session.id, new_message=types.Content(role="user", parts=[types.Part(text="{}")]),
        ):
            pass
    except Exception:  # noqa: BLE001 - the canned reply is not a valid output; only the request matters
        pass


def test_every_specialist_sends_a_request_meta_accepts(captured):
    team = build_agent_team()
    results: dict[str, dict] = {}
    for agent in team.sub_agents:
        # Run each specialist on its own: no input contract, no host callbacks.
        agent.input_schema = None
        agent.before_model_callback = None
        agent.mode = "chat"
        before = len(captured)
        asyncio.run(_one_turn(agent))
        assert len(captured) > before, f"{agent.name} never sent a request"
        results[agent.name] = captured[before]

    assert len(results) == 13
    for name, body in results.items():
        assert body["path"] == "/v1/chat/completions", name
        assert body["model"] in {"muse-spark-1.3", "muse-wonder-1.0"}, name
        assert body["reasoning_effort"] in {"minimal", "low", "medium", "high", "xhigh", "max"}, name
        assert body["prompt_cache_key"].startswith("harmonia-"), name
        assert not REJECTED_PARAMS & body.keys(), (name, REJECTED_PARAMS & body.keys())
        response_format = body.get("response_format")
        if name == "nova_liaison":
            assert response_format is None
            continue
        assert response_format["type"] == "json_schema", name
        assert response_format["json_schema"]["strict"] is True, name
        schema = response_format["json_schema"]["schema"]
        assert schema.get("type") == "object" and "anyOf" not in schema, name
        assert _strict_subset_problems(schema) == [], (name, _strict_subset_problems(schema)[:5])

    assert results["ryan_strategist"]["model"] == "muse-wonder-1.0"
    assert {tool["function"]["name"] for tool in results["noni_copywriter"]["tools"]} >= {"load_skill", "noni_web_search"}
    assert {tool["function"]["name"] for tool in results["nova_liaison"]["tools"]} >= {"load_skill"}
