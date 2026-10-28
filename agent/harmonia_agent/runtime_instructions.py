"""Project host-owned runtime contracts into every real ADK model request."""

import json

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest


def project_runtime_instructions(callback_context: CallbackContext, llm_request: LlmRequest) -> None:
    # Session state is not automatically model-visible. This callback is serialized
    # with the team and runs identically in Agent Engine and the local runner.
    # Never mutate shared agent instructions or expose audit/credential envelopes.
    for key, label in (
        ("_harmonia_output_contract", "HOST-AUTHORIZED PAYLOAD CONTRACT: follow exactly inside payloadJson; no extra fields"),
        ("_harmonia_repair", "ACTIVE COURSE CORRECTION: regenerate from the original trusted input and fix these contract violations"),
    ):
        value = callback_context.state.get(key)
        if value:
            llm_request.append_instructions([f"{label}\n{json.dumps(value, sort_keys=True)}"])
