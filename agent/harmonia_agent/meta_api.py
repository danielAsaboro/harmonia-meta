"""Shared Meta Model API transport: retries per Meta's error-handling guide, and status.

docs/meta/error-handling.md: 429 (rate limit), 500 (transient or model-output
parsing failure, "safe to retry") and 503 (`server_shutting_down`,
`service_overloaded`, `backend_unavailable`) are retryable. Honor `Retry-After`
when present, otherwise back off exponentially with jitter. Other statuses are
returned unchanged so callers keep their own failure classification.
"""

from __future__ import annotations

import asyncio
import base64
import os
import random
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import httpx

DEFAULT_META_API_BASE_URL = "https://api.meta.ai/v1"
RETRYABLE_STATUSES = frozenset({429, 500, 503})
MAX_ATTEMPTS = 4
BASE_DELAY_SECONDS = 1.0
MAX_DELAY_SECONDS = 60.0


def retry_delay(response: httpx.Response, attempt: int, jitter: Callable[[], float] = random.random) -> float:
    header = response.headers.get("retry-after")
    if header:
        try:
            return min(max(float(header), 0.0), MAX_DELAY_SECONDS)
        except ValueError:
            pass
    return min(BASE_DELAY_SECONDS * 2 ** (attempt - 1) * (1 + jitter()), MAX_DELAY_SECONDS)


class RetryTransport(httpx.BaseTransport):
    def __init__(
        self,
        inner: httpx.BaseTransport | None = None,
        *,
        max_attempts: int = MAX_ATTEMPTS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._inner = inner or httpx.HTTPTransport()
        self._max_attempts = max_attempts
        self._sleep = sleep

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        request.read()
        for attempt in range(1, self._max_attempts + 1):
            response = self._inner.handle_request(request)
            if response.status_code not in RETRYABLE_STATUSES or attempt == self._max_attempts:
                return response
            response.read()
            response.close()
            self._sleep(retry_delay(response, attempt))
        raise AssertionError("unreachable")

    def close(self) -> None:
        self._inner.close()


class AsyncRetryTransport(httpx.AsyncBaseTransport):
    def __init__(
        self,
        inner: httpx.AsyncBaseTransport | None = None,
        *,
        max_attempts: int = MAX_ATTEMPTS,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self._inner = inner or httpx.AsyncHTTPTransport()
        self._max_attempts = max_attempts
        self._sleep = sleep

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        await request.aread()
        for attempt in range(1, self._max_attempts + 1):
            response = await self._inner.handle_async_request(request)
            if response.status_code not in RETRYABLE_STATUSES or attempt == self._max_attempts:
                return response
            await response.aread()
            await response.aclose()
            await self._sleep(retry_delay(response, attempt))
        raise AssertionError("unreachable")

    async def aclose(self) -> None:
        await self._inner.aclose()


def base_url() -> str:
    return (os.environ.get("META_API_BASE_URL") or DEFAULT_META_API_BASE_URL).rstrip("/")


def client(timeout: float, *, purpose: str) -> httpx.Client:
    """Authenticated, retrying client for one Meta Model API call site."""
    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError(f"MODEL_API_KEY is required for {purpose}")
    return httpx.Client(
        base_url=base_url(),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=httpx.Timeout(timeout, connect=10.0),
        transport=RetryTransport(),
    )


def fetch_status(get: Callable[[str], httpx.Response] | None = None) -> dict[str, Any]:
    """Summarize the unauthenticated ``GET /status`` for health checks."""
    url = f"{base_url()}/status"
    response = get(url) if get else httpx.get(url, timeout=10.0)
    if response.status_code != 200:
        return {"provider": "meta", "status": "unreachable", "httpStatus": response.status_code}
    body = response.json()
    degraded = sorted(
        str(item.get("model") or item.get("id"))
        for item in body.get("model_statuses") or []
        if isinstance(item, dict) and str(item.get("status") or "operational") != "operational"
    )
    return {
        "provider": "meta",
        "status": str(body.get("service_status") or ("operational" if body.get("is_alive") else "down")),
        "alive": bool(body.get("is_alive")),
        **({"degradedModels": degraded} if degraded else {}),
        **({"message": str(body["service_message"])[:200]} if body.get("service_message") else {}),
    }


# docs/meta/file-handling.md: inline media is capped at 50 MB per request; the
# Files API accepts up to 1 GiB. Uploads expire after an hour and are deleted
# as soon as the call that needed them returns.
MAX_INLINE_MEDIA_BYTES = 45_000_000
UPLOAD_TTL_SECONDS = 3600


def upload_file(client: httpx.Client, data: bytes, *, filename: str, content_type: str) -> str:
    response = client.post(
        "/files",
        data={"purpose": "user_data", "expires_after[anchor]": "created_at",
              "expires_after[seconds]": str(UPLOAD_TTL_SECONDS)},
        files={"file": (filename, data, content_type)},
    )
    if response.status_code >= 300:
        raise RuntimeError(f"Meta Files API upload failed ({response.status_code}): {response.text[:200]}")
    file_id = response.json().get("id")
    if not isinstance(file_id, str) or not file_id:
        raise RuntimeError("Meta Files API upload returned no file id")
    return file_id


def delete_file(client: httpx.Client, file_id: str) -> None:
    try:
        client.delete(f"/files/{file_id}")
    except httpx.HTTPError:
        pass  # the upload expires on its own within UPLOAD_TTL_SECONDS


@contextmanager
def video_input(client: httpx.Client, video: bytes) -> Iterator[dict[str, str]]:
    """An ``input_video`` part: inline when small, otherwise a temporary Files API upload."""
    if len(video) <= MAX_INLINE_MEDIA_BYTES:
        yield {"type": "input_video", "video_url": "data:video/mp4;base64," + base64.b64encode(video).decode()}
        return
    file_id = upload_file(client, video, filename="harmonia-proxy.mp4", content_type="video/mp4")
    try:
        yield {"type": "input_video", "file_id": file_id}
    finally:
        delete_file(client, file_id)
