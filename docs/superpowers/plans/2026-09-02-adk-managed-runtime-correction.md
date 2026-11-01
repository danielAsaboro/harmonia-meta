# ADK Managed Runtime Architecture Correction

## Root cause

The deployed ADK coordinator delegates correctly, but every model call is sent to the Vertex AI `us-central1` publisher path. That endpoint returns `404 NOT_FOUND` for `gemini-3.5-flash` in this project. The deprecated synchronous Agent Engine stream runs ADK in a worker thread and exposes the failure as an empty stream, causing Harmonia to misclassify a provider/configuration failure as missing output state.

## Correction

1. Package the coordinator as a current ADK `App` with an explicit root agent.
2. Select the Gemini Developer API explicitly for Gemini 3.5 and inject its server-side key; do not infer Vertex routing from the Agent Engine environment.
3. Invoke Agent Engine only through its asynchronous session and streaming APIs so provider exceptions remain observable.
4. Accept specialist results only from ADK event state deltas or the persisted managed session. Never recover authority-bearing output from response text.
5. Keep identifiers, digests, handoffs, approval authority, receipts, validation, bounded contract correction, and escalation in deterministic Harmonia code.
6. Retry only transient provider failures. Configuration/model 4xx failures terminate immediately with a stable, safe error.
7. Prove the correction with unit tests, a live managed invocation, the full test/build suite, and the existing Daniel Chrome workflow.

## Verification gates

- Agent Engine emits a specialist event and persists the typed `output_key`.
- A provider 4xx is surfaced as a provider error, never an empty-state protocol error.
- Model response text without an ADK state delta is rejected.
- Full Python and web suites and production build pass.
- The same browser request reaches job creation, approval, content-pack export, verification receipt, and duplicate suppression.
