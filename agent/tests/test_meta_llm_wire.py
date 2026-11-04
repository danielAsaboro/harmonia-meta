"""What a role's model call actually sends to Meta's Chat Completions endpoint."""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from google.adk.models.llm_request import LlmRequest
from google.genai import types

from harmonia_agent.meta_llm import MetaLlm


def _serve(bodies: list[dict]) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - http.server API
            bodies.append(json.loads(self.rfile.read(int(self.headers["content-length"]))))
            payload = json.dumps({
                "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": bodies[-1]["model"],
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11},
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
    return server


def test_role_call_sends_model_reasoning_effort_and_its_cache_key(monkeypatch):
    bodies: list[dict] = []
    server = _serve(bodies)
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("META_API_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    model = MetaLlm(model_id="muse-wonder-1.0", provider="meta", reasoning_effort="high", cache_key="harmonia-ryan_strategist", num_retries=0)
    request = LlmRequest(
        model=model.model,
        contents=[types.Content(role="user", parts=[types.Part(text="hello")])],
        config=types.GenerateContentConfig(system_instruction="You are Ryan."),
    )

    async def call():
        return [response async for response in model.generate_content_async(request)]

    try:
        responses = asyncio.run(call())
    finally:
        server.shutdown()

    assert responses and bodies
    body = bodies[0]
    assert body["model"] == "muse-wonder-1.0"
    assert body["reasoning_effort"] == "high"
    assert body["prompt_cache_key"] == "harmonia-ryan_strategist"
    assert body["messages"][0] == {"role": "system", "content": "You are Ryan."}


def test_baseten_roles_send_no_meta_cache_key():
    model = MetaLlm(model_id="meta-models/muse-spark-open-1026", provider="baseten", reasoning_effort="low", cache_key="harmonia-x")
    assert "extra_body" not in model._additional_args
