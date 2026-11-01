# Authenticated Record/Replay Design

**Date:** 2026-08-26  
**Status:** Approved design  
**Scope:** Cost-controlled local development from sanitized authenticated Harmonia runs

## Purpose

Harmonia needs a trustworthy way to continue developing its dashboard, conversational console, A2UI surfaces, approvals, monitoring, recovery, and scheduled autonomy without repeatedly paying for authenticated Google Cloud execution. The record/replay subsystem captures a small number of real authenticated runs as sanitized, versioned bundles and replays their observable application events locally.

Replay is a development aid, not a provider emulator, workflow authority, or evidence generator. Firestore remains the live workflow source of truth. A replay session is isolated, read-only, visibly disclosed, and incapable of invoking approval, publishing, credential, or other external-effect paths.

## Trust Model and Runtime Modes

Harmonia exposes exactly three execution modes:

1. `fixture`: deterministic synthetic inputs used only by automated tests.
2. `recorded_replay`: sanitized observations captured from a prior authenticated run and replayed locally.
3. `live`: authenticated execution against configured Google and external services.

Every replay event carries `executionMode: "recorded_replay"`, its bundle identity, and its original capture timestamp. Replay endpoints and clients use a separate namespace from live mutation endpoints. A replay dispatcher never imports replayed state into production Firestore and never calls decision, retry, publish, receipt, credential, or internal effect routes.

The application shell permanently displays a prominent banner while replay mode is active:

> Recorded authenticated run — replay mode · captured {capture date} · bundle {bundle identity}

The banner cannot be hidden by a recorded event or bundle field. Replay screens also state that the session is historical and cannot serve as fresh provider, deployment, or submission evidence.

## Bundle Boundary

### Envelope

Each bundle is canonical JSON with:

- schema name and semantic version;
- immutable bundle ID and scenario;
- capture start/end timestamps;
- source environment classification and authenticated-run identifiers;
- sanitizer version and explicit public-release approval state;
- ordered event records;
- expected terminal-state digest;
- provenance manifest;
- integrity block containing the canonicalization algorithm and SHA-256 digest.

The bundle schema is strict and fail-closed. Unknown keys, unsupported versions, malformed timestamps, duplicate or non-monotonic sequence numbers, unsupported event kinds, and invalid payload shapes cause import failure. The digest is calculated over the envelope excluding the digest value itself and is verified before any event is dispatched.

### Allowlisted Records

The first schema supports sanitized forms of:

- job snapshots and stage transitions;
- ADK specialist handoffs and safe activity summaries;
- transcript segments authorized for capture;
- moments, drafts, actions, approvals, effect claims, receipts, and independent verification records;
- Pub/Sub delivery and Scheduler trigger metadata;
- A2UI events and surface revisions;
- timing, token usage, estimated cost, trace correlation, and typed failures.

The schema records observable summaries only. It does not preserve arbitrary provider payloads, HTTP traffic, raw logs, prompts, model thoughts, or hidden agent state.

### Explicitly Forbidden Data

Bundles may never contain:

- credentials, access tokens, refresh tokens, API keys, cookies, session secrets, private keys, authorization headers, or signed URLs;
- private chain-of-thought, hidden reasoning, raw prompts, provider request bodies, or unsanitized model responses;
- arbitrary headers, environment dumps, stack traces, or unsanitized logs;
- source material without recorded authorization to include it;
- reusable approval capabilities or any value that can authorize a live effect.

The sanitizer combines an allowlist projector with recursive forbidden-key and forbidden-value detection. It rejects the candidate bundle if dangerous material is encountered; it does not silently preserve unknown data. Source text is accepted only when the recorder receives an explicit capture authorization flag for that source. Approval records are inert historical summaries and exclude authenticators or reusable decision tokens.

## Components

### Bundle Schema and Canonicalizer

A focused TypeScript module defines strict Zod schemas and public types for the envelope, provenance manifest, event union, terminal state, and integrity record. A canonicalizer recursively sorts object keys while preserving array order and emits stable UTF-8 JSON for SHA-256 hashing.

### Sanitizer

The sanitizer accepts typed live observations through event-specific projectors. Each projector constructs a new allowlisted object rather than cloning an input record. A final recursive inspection rejects secret-like keys, bearer/basic credentials, private-key markers, cookie material, and unsafe URL query credentials. Sanitization produces either a valid unsigned candidate bundle or a typed rejection; there is no permissive fallback.

### Recorder

The authenticated recorder is an operator-run command, not an always-on network interceptor. It reads selected persisted Harmonia records through existing authenticated data adapters, normalizes them into ordered observations, invokes the sanitizer, calculates terminal state, and writes a candidate bundle to private parent-level evidence storage.

The recorder does not automatically copy output into the public repository. A separate explicit release operation requires a provenance flag confirming that the sanitized bundle was reviewed and approved for public inclusion. Raw evidence stays under the private parent workspace.

### Importer

The importer parses JSON, validates the strict schema, verifies sequence invariants and the integrity digest, rejects bundles without the appropriate release classification for their destination, and recomputes the expected terminal state. It fails closed before creating a replay session.

### Replay Dispatcher

The dispatcher is an in-memory state machine over an immutable imported bundle. It supports:

- original-time playback and configurable speed multipliers;
- pause, resume, and stop;
- reconnection from an exclusive sequence number;
- deterministic immediate playback for tests;
- monotonically ordered event delivery;
- typed failure and recovery events;
- deterministic final-state calculation and comparison with the manifest.

Playback timing uses event offsets from capture start, not wall-clock capture timestamps. Reconnection returns events after the requested sequence and cannot skip integrity validation. Pausing prevents new dispatches but does not mutate bundle state.

### Replay API and UI Integration

Replay session routes live under a dedicated replay namespace. They return historical events and controls only. They do not proxy requests into live chat-run or job mutation routes. API responses include immutable replay disclosure metadata.

The dashboard and A2UI console consume replay events through the existing reducers where compatible, with an adapter that preserves `executionMode` and provenance. The application shell reads replay-session metadata independently and renders the mandatory banner above all replay surfaces. Mutation controls are disabled or replaced with historical outcome labels during replay.

### Evidence Classification

Replay output is marked `historical_replay` in monitoring and export surfaces. Evidence verification scripts reject it anywhere fresh authenticated proof is required. Only the original raw authenticated evidence and its independently captured cloud identifiers may satisfy deployment, provider, or final-demo evidence requirements.

## Event Ordering and Deterministic State

Every event has a zero-based contiguous sequence, capture timestamp, relative offset in milliseconds, event kind, and strictly validated payload. Events sharing a timestamp remain ordered by sequence. A bundle with gaps, duplicates, decreasing timestamps, decreasing offsets, or events outside the capture window is invalid.

Terminal state is reduced from the initial sanitized snapshot and ordered events using pure functions. The recorder stores the expected terminal-state digest. The importer and completed dispatcher independently recompute it, allowing tests and local development to prove that replay reaches the same sanitized terminal state as capture.

## Failure and Recovery

Typed failures distinguish transient provider failure, permanent provider failure, policy quarantine, authorization failure, delivery failure, verification failure, and replay-integrity failure. Recovery is represented by later ordered events; replay does not rewrite or omit the preceding failure.

Tampered, unsupported, unsafe, or unauthorized bundles are rejected before playback. Runtime dispatcher errors terminate the replay session visibly and never fall through to live execution. Missing scenario bundles are reported as unavailable rather than synthesized.

## Golden Scenario Registry

The repository maintains a registry with these scenario identities:

- success;
- awaiting approval;
- rejection;
- transient failure followed by recovery;
- permanent failure;
- duplicate-effect suppression;
- scheduled autonomy;
- Memory Bank retrieval;
- Telegram approval.

Each entry records `not_captured`, `private_candidate`, or `approved_public_bundle`. No bundle is generated until its scenario has occurred during a real authenticated run. The first authenticated vertical slice should create only the scenarios genuinely observed in that run.

## Tests and Acceptance Criteria

Implementation is test-driven. Automated tests must demonstrate:

- strict rejection of unknown fields and unsupported versions;
- rejection of credentials, tokens, cookies, authorization headers, signed secrets, private keys, raw reasoning, and unsafe logs at arbitrary nesting depths;
- source text rejection without explicit capture authorization;
- stable canonicalization and digest verification;
- tamper detection;
- ordered dispatch, speed control, pause/resume, and reconnect-after-sequence behavior;
- deterministic terminal state across repeated playback;
- transient recovery, permanent failure, duplicate suppression, and approval-wait behavior using fixtures;
- replay routes and controls cannot invoke live mutations or external effects;
- required banner text, capture date, and bundle identity remain visible;
- replay artifacts are rejected as fresh authenticated evidence.

Fixtures exercise behavior but are permanently classified as `fixture`. Recorded bundles are not committed until a real authenticated capture is sanitized and explicitly approved.

## Delivery Sequence

1. Implement schema, canonicalizer, sanitizer, importer, reducer, and dispatcher with failing tests first.
2. Add isolated replay APIs, UI disclosure, mutation suppression, and evidence classification.
3. Add the private recorder command and public scenario registry without fabricating bundles.
4. Run unit, integration, security, type, lint, and build verification.
5. Resume deployment and perform one meaningful authenticated cloud run.
6. Produce and privately inspect the first candidate golden bundle.
7. Verify local replay reaches the captured sanitized terminal state.
8. Explicitly approve any public bundle, then scale down costly resources.

Cloud deployment retries remain paused until steps 1–4 pass. Repeated live runs are reserved for meaningful backend milestones and final evidence capture.
