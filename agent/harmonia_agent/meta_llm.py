"""ADK model binding for Meta Model API and Muse Spark Open on Baseten."""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from typing import Any, Literal

from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

Provider = Literal["meta", "baseten"]

# provider: (base URL env, default base URL, API key env)
PROVIDER_ENDPOINTS: dict[str, tuple[str, str, str]] = {
    "meta": ("META_API_BASE_URL", "https://api.meta.ai/v1", "MODEL_API_KEY"),
    "baseten": ("BASETEN_API_BASE_URL", "https://inference.baseten.co/v1", "BASETEN_API_KEY"),
}


class MetaLlm(LiteLlm):
    """Muse models over OpenAI-compatible Chat Completions.

    The endpoint and key are read from the runtime environment on every call
    instead of being stored on the instance.
    """

    provider: Provider = "meta"

    def __init__(self, *, model_id: str, provider: Provider, reasoning_effort: str, **kwargs: Any) -> None:
        if provider not in PROVIDER_ENDPOINTS:
            raise ValueError(f"unknown model provider: {provider}")
        super().__init__(
            model=f"openai/{model_id}",
            provider=provider,
            reasoning_effort=reasoning_effort,
            # LiteLLM backs off on 429/5xx; Meta's error-handling guide marks
            # 429, 500 and 503 retryable.
            num_retries=kwargs.pop("num_retries", 3),
            **kwargs,
        )
        self._additional_args.pop("provider", None)

    def endpoint(self) -> tuple[str, str]:
        base_env, default_base, key_env = PROVIDER_ENDPOINTS[self.provider]
        key = os.environ.get(key_env)
        if not key:
            raise RuntimeError(f"missing required environment variable: {key_env}")
        return os.environ.get(base_env, default_base), key

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False,
    ) -> AsyncGenerator[LlmResponse, None]:
        api_base, api_key = self.endpoint()
        self._additional_args["api_base"] = api_base
        self._additional_args["api_key"] = api_key
        async for response in super().generate_content_async(llm_request, stream=stream):
            yield response
