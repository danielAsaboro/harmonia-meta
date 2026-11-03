"""One live call to every Meta model Harmonia uses, recorded without content.

Run it the moment a key exists, before a recording or a deploy:

    cd agent && .venv/bin/python -m harmonia_agent.meta_probe --out ../evidence/meta-probe.json

Each check makes the smallest real request its model accepts and records only
metadata: model id, HTTP status, Meta's request id, latency, and reported usage.
No prompts or outputs are kept, so the file is safe to publish as proof that
the calls happened. Muse Image costs money per picture and runs only with
``--with-image``; Muse Spark Open runs only when ``BASETEN_API_KEY`` is set.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

from . import meta_api
from .content import _normalize_to_wav, image_model, model_used as transcriber_model
from .meta_llm import PROVIDER_ENDPOINTS
from .role_models import BASETEN_OPEN_MODEL, load_role_model_catalog
from .segmentation import segmentation_model

PING_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
}
PING_INPUT = 'Reply with {"ok": true}.'
SPOKEN_LINE = "Harmonia is live on Meta Model API."


def _request_id(response: httpx.Response) -> str | None:
    for header in ("x-request-id", "x-meta-request-id", "request-id"):
        if response.headers.get(header):
            return response.headers[header]
    return None


def _record(check: str, model: str, call: Callable[[], httpx.Response], usage: Callable[[dict], Any]) -> dict[str, Any]:
    started = time.monotonic()
    try:
        response = call()
    except (httpx.HTTPError, RuntimeError, OSError) as exc:
        return {"check": check, "model": model, "ok": False, "error": type(exc).__name__}
    result: dict[str, Any] = {
        "check": check, "model": model, "ok": response.status_code < 300,
        "httpStatus": response.status_code, "latencyMs": round((time.monotonic() - started) * 1000),
        "requestId": _request_id(response),
    }
    if result["ok"]:
        try:
            body = response.json()
        except ValueError:
            body = {}
        result["responseId"] = body.get("id") if isinstance(body.get("id"), str) else None
        result["usage"] = usage(body)
    else:
        result["error"] = response.text[:200]
    return result


def _responses_usage(body: dict) -> dict[str, Any]:
    usage = body.get("usage") or {}
    return {key: usage.get(key) for key in ("input_tokens", "output_tokens") if key in usage}


def _ping(model: str) -> dict[str, Any]:
    return {
        "model": model, "input": PING_INPUT, "max_output_tokens": 256, "reasoning": {"effort": "low"},
        "text": {"format": {"type": "json_schema", "name": "Ping", "schema": PING_SCHEMA, "strict": True}},
    }


def _speech(workdir: Path) -> bytes:
    """A short spoken line: macOS ``say`` when present, otherwise a test tone."""
    if shutil.which("say"):
        aiff = workdir / "line.aiff"
        subprocess.run(["say", "-o", str(aiff), SPOKEN_LINE], check=True, timeout=60)
        return _normalize_to_wav(aiff.read_bytes())
    tone = workdir / "tone.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    str(tone)], check=True, timeout=60)
    return _normalize_to_wav(tone.read_bytes())


def _clip(workdir: Path) -> bytes:
    clip = workdir / "clip.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "testsrc2=size=320x240:rate=5:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(clip)], check=True, timeout=60)
    return clip.read_bytes()


def run_probe(*, with_image: bool = False, client: httpx.Client | None = None) -> dict[str, Any]:
    catalog = load_role_model_catalog()
    text_models = sorted({role.model_id for role in catalog.roles() if role.provider == "meta"})
    checks: list[dict[str, Any]] = [{"check": "status", **meta_api.fetch_status()}]
    owned = client is None
    client = client or meta_api.client(120.0, purpose="the live Meta probe")
    try:
        for model in text_models:
            counted = meta_api.count_input_tokens(client, _ping(model))
            checks.append({"check": "count_input_tokens", "model": model, "ok": counted is not None, "inputTokens": counted})
            checks.append(_record("responses", model, lambda m=model: client.post("/responses", json=_ping(m)), _responses_usage))
        with tempfile.TemporaryDirectory() as td:
            workdir = Path(td)
            wav = _speech(workdir)
            checks.append(_record(
                "transcribe", transcriber_model(),
                lambda: client.post(
                    "/asr/transcribe", params={"sessionId": "harmonia-probe"}, headers={"Accept": "application/json"},
                    files={
                        "request": (None, json.dumps({"model": transcriber_model(), "mode": "ENDPOINTING",
                                                      "audioEncoding": "WAV"}), "application/json"),
                        "audio": ("audio.wav", wav, "audio/wav"),
                    },
                ),
                lambda body: {"words": len(str(body.get("transcript") or "").split())},
            ))
            video = _clip(workdir)

            def segment() -> httpx.Response:
                with meta_api.video_input(client, video) as part:
                    return client.post("/responses", json={
                        "model": segmentation_model(),
                        "input": [{"type": "message", "role": "user", "content": [
                            {"type": "input_text", "text": "circle"}, part,
                        ]}],
                        "metadata": {"mask_encoding": "one_bit"},
                    })

            checks.append(_record("segment_video", segmentation_model(), segment,
                                  lambda body: {"video_frames_processed": (body.get("usage") or {}).get("video_frames_processed")}))
        if with_image:
            checks.append(_record("generate_image", image_model(), lambda: client.post("/images/generations", json={
                "model": image_model(), "prompt": "A small green leaf on white paper", "n": 1,
                "response_format": "b64_json", "output_format": "png",
            }), lambda body: {"images": len(body.get("data") or [])}))
    finally:
        if owned:
            client.close()
    if os.environ.get("BASETEN_API_KEY"):
        base_env, default_base, key_env = PROVIDER_ENDPOINTS["baseten"]
        with httpx.Client(
            base_url=os.environ.get(base_env, default_base), timeout=120.0,
            headers={"Authorization": f"Bearer {os.environ[key_env]}"}, transport=meta_api.RetryTransport(),
        ) as baseten:
            checks.append(_record("chat_completions", BASETEN_OPEN_MODEL, lambda: baseten.post("/chat/completions", json={
                "model": BASETEN_OPEN_MODEL, "max_tokens": 64,
                "messages": [{"role": "user", "content": PING_INPUT}],
            }), lambda body: {key: (body.get("usage") or {}).get(key) for key in ("prompt_tokens", "completion_tokens")}))
    return {
        "probe": "harmonia-meta-models",
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": meta_api.base_url(),
        "passed": all(check.get("ok", check.get("alive", False)) for check in checks),
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, help="also write the JSON report here")
    parser.add_argument("--with-image", action="store_true", help="also generate one Muse Image picture (billed)")
    args = parser.parse_args(argv)
    report = run_probe(with_image=args.with_image)
    text = json.dumps(report, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    for check in report["checks"]:
        mark = "ok " if check.get("ok", check.get("alive")) else "FAIL"
        sys.stderr.write(f"{mark} {check['check']:<20} {check.get('model', ''):<36} {check.get('latencyMs', '')}\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
