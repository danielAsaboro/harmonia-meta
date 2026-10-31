# Agent Runtime, Memory Bank, and Generative Media Plan

> Execute directly on `main` at the user's request. Preserve Firestore/Pub/Sub as the durable workflow engine and all existing public contracts.

## Goal

Add an explicit Vertex AI Agent Engine execution option for the ADK cognitive team, exact-scope Memory Bank retrieval/generation, and approval-gated Veo/Lyria asset actions without hidden fallback or simulated success.

## Task 1: Managed cognitive runtime

- Add contract tests for explicit `local` versus `agent_engine` selection, managed-session state seeding, state-delta extraction, output validation, and provider/protocol failure classification.
- Introduce a runtime protocol. Keep the existing in-memory ADK runner as `LocalTeamRuntime`.
- Add `AgentEngineTeamRuntime`, using an injected Vertex client in tests and lazy SDK construction in production.
- Create one managed session per invocation with the current payload as state, stream one coordinator request, extract the required state deltas, validate typed output, and discard the session.
- Add an Agent Engine deployment entry point exposing the existing root ADK hierarchy through `AdkApp`.
- Never fall back from managed execution to local or mock execution.

## Task 2: Scoped persistent memory

- Add tests proving every retrieval and generation uses exact `{workspace_id, brand_id}` scope, is bounded, emits metadata-only spans, and cannot leak across brands.
- Add typed `MemoryScope`, `MemoryFact`, and eligible `MemoryCandidate` contracts.
- Add a Memory Bank client protocol and Vertex implementation using `retrieve` and `generate`.
- Retrieve bounded facts before analyst, strategist, and draft invocations and merge them into the existing input context fields without changing persisted schemas.
- Generate memories only from operator decisions, verified external outcomes, or the deterministic learn-stage summary; reject drafts, raw media/transcripts, errors, and unverified claims.
- Treat malformed memory results as protocol failures and provider failures as retryable; no silent fallback.

## Task 3: Approval-gated Veo and Lyria actions

- Add contract and policy tests for `generate_video` and `generate_music` actions.
- Deterministically propose these actions from reviewed moments/angles, never from an agent planner, and always require operator approval.
- Add provider adapters with injectable transports, long-running operation IDs, polling/resume support, bounded duration, and typed permanent/transient failures.
- Persist operation IDs before polling; upload completed media through the existing asset boundary; derive receipts and verification using existing action IDs and idempotency rules.
- Meter video/audio seconds against explicit reservations and never substitute local or mock media after a provider failure.

## Task 4: Deployment, observability, and documentation

- Add required Agent Engine/Memory Bank/Vertex media service permissions and explicit deployment configuration.
- Add OpenTelemetry spans for runtime invocation, memory retrieval/generation, and media operations with IDs/counts/cost units only—never prompts, transcripts, draft text, or memory facts.
- Update README and architecture diagrams with the cognitive dispatcher, managed runtime, exact-scope Memory Bank, heterogeneous model routing, multimodal inputs, and unchanged approval boundary.
- State that live authenticated Agent Engine, Memory Bank, Veo, Lyria, and Gemini team execution remain unverified until parent-level evidence is captured.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `cd agent && ./.venv/bin/python -m pytest tests -q`

