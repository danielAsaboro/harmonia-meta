# Non-Submission Product Hardening Design

**Date:** 2026-08-30
**Status:** approved direction; implementation pending
**Scope:** repository-local product correctness and completeness. Live credentials, cloud deployment, provider evidence capture, demo production, submission copy, eligibility paperwork, and deadline freeze operations are explicitly outside this design.

## Objective

Make Harmonia truthful and complete as a product implementation before external deployment work begins. Every selectable output must have an implemented producer, strict review, durable representation, executable effect or export, and independent verifier. Every operator control must resume through the durable runtime rather than mutate Firestore into an inert state. Scheduled source libraries must enforce policy before avoidable provider spend and recover without corrupting healthy snapshots. UI, chat, Telegram, contracts, runtime behavior, observability, tests, and documentation must describe the same system.

No backward compatibility is preserved. Replaced X-only or video-first contracts, aliases, routes, and fallbacks are deleted in the same change that replaces them.

## Product Capability Rule

Harmonia may expose an output only when it is registered with all of the following:

1. a strict producer contract;
2. evidence-lineage validation;
3. format-specific editorial review;
4. an immutable persisted artifact;
5. an executable internal export or approved external effect;
6. independent verification;
7. a truthful capability state in every operator surface.

An output missing any element is unavailable and cannot appear as selectable. Configuration, a UI label, or a model prompt is not implementation evidence.

## Unified Content Artifacts

Introduce one `ContentArtifact` envelope with a discriminated payload for:

- `x_post`;
- `x_thread`;
- `linkedin_post`;
- `blog_article`;
- `newsletter`;
- `caption`;
- `carousel_spec`;
- `quote_card`;
- `diagram`;
- `editorial_calendar`;
- `content_pack`.

The envelope contains artifact ID, job ID, output-plan ID and digest, output type, revision, title, exact source segment references, model and role identity, producer trace reference, review trace reference, canonical content digest, MIME type, creation timestamp, and typed payload. Payload schemas encode real format requirements rather than a generic string:

- X thread: ordered posts with per-post length validation.
- LinkedIn post: body, optional title, CTA, and destination-independent publishing payload.
- Blog article: headline, dek, ordered sections, conclusion, CTA, and citations.
- Newsletter: subject, preheader, introduction, ordered sections, CTA, and optional sign-off.
- Caption: platform intent, caption text, CTA, and hashtags.
- Carousel: title, ordered slides, per-slide headline/body, and final CTA slide.
- Quote card: exact quote, attribution, supporting source reference, and render brief.
- Diagram: diagram type, nodes, edges, labels, and render brief grounded in source evidence.
- Editorial calendar: ordered entries referencing produced artifact IDs, channel, intended date/window, purpose, and dependencies.
- Content pack: manifest of artifact IDs and digests rather than duplicated untyped prose.

Canonical digests cover the full typed payload and lineage fields that determine meaning. A changed artifact creates a new revision and digest; it never mutates an approved or executed payload in place.

## Production and Review

Noni becomes a multi-format copy and content producer. One invocation may return multiple requested artifacts, but each artifact is independently typed and evidence-bound. Noni receives only the approved strategy, selected editorial work, normalized source segments referenced by that work, eligible operator preferences, and the exact output plan. It cannot authorize publishing or invent destinations.

Dara reviews each artifact separately using a shared evidence/safety rubric plus a format-specific rubric. Review results identify the artifact ID and digest and contain explicit checks for grounding, brief alignment, brand voice, platform or medium constraints, CTA, safety, clarity, and structural completeness. At most one issue-bound revision is allowed per artifact. An artifact that remains rejected produces no action.

Application code validates producer and review outputs, assigns authoritative IDs and digests, persists immutable artifacts and traces, and derives actions only from accepted artifact revisions.

## Effects and Verification

Every accepted non-published content artifact receives an `export_content_artifact` action. The executor serializes a deterministic Markdown representation plus a canonical JSON representation, stores both through the artifact boundary, and records byte digests and storage identities. The verifier re-reads both objects, hashes the bytes, parses the JSON back through the exact artifact schema, and confirms identity, revision, and expected digest.

`content_pack` exports a manifest and bundle that reference the verified constituent artifact digests. Pack verification fails if any constituent is missing, unverified, or has a mismatched digest.

X posts and threads use official X effects after exact human approval. A thread is one logical action with an ordered sequence, durable per-post progress, provider IDs, and an uncertainty boundary that prevents unsafe replay after a partial provider response.

LinkedIn posts always receive a verified internal export. When a valid LinkedIn member or organization destination is connected, Harmonia may additionally propose `publish_linkedin_post`. That action requires exact human approval, uses the official LinkedIn API, persists the selected destination identity, records the provider post identity and URL, and verifies with a fresh official API read. A missing or invalid connection leaves the verified export available and does not create a publish action.

Blog articles, newsletters, captions, carousel specifications, quote cards, diagrams, and calendars remain verified internal artifacts until a separately designed official destination integration exists. Harmonia does not imply CMS, email-service, or social publishing support for those artifacts.

## Capability Registry and Operator Surfaces

A single capability registry declares, for each output type:

- producer and reviewer availability;
- export action and verifier;
- optional external publisher;
- connection requirements;
- approval class;
- cost class;
- supported source prerequisites;
- user-facing capability state.

The output planner, Studio selector, chat intent validator, Telegram responses, action derivation, policy engine, monitoring views, and documentation consume this registry or its strict derived types. Capability states are:

- `verified_export`: production plus independently verifiable internal export is implemented;
- `publish_when_connected`: verified export plus an official approval-gated publisher is implemented;
- `unavailable`: hidden from selection and rejected at API boundaries.

Video-only outputs remain conditional on real timed video evidence. Quote cards require a verbatim supported quote. Diagrams require source-supported entities and relationships. No producer may convert absence of evidence into generic creative filler.

## Durable Steering Repair

Pause and resume continue to use an optimistic `controlEpoch`. Cancel must be exposed in the Studio with the exact typed confirmation and must preserve executed receipts while skipping only pending actions.

Redo becomes a durable rewind operation. One Firestore transaction increments the control epoch, records the rewind decision, invalidates only dependent unexecuted artifacts and approvals, sets the target stage, and creates a new attempt-scoped stage-outbox record. The route dispatches that record after commit; the durable tick recovers it after a crash. Previously published or otherwise executed effects are never erased or automatically repeated. Redo to a stage whose downstream effects already executed requires reconciliation and is rejected unless the target is demonstrably safe.

Nudge application records exact invalidation lineage, revokes affected approvals, preserves receipts, and creates the next durable outbox trigger whenever work must resume. A Firestore state mutation without recoverable delivery is forbidden.

## Brand-Library Policy and Recovery

Library sync performs a metadata preflight before downloading or invoking Gemini. File count, declared bytes, MIME allowlist, provider version identity, and configured per-sync spend ceiling are enforced first. Media work uses bounded metadata inspection to derive duration before Gemini extraction; sources without a safely measurable duration fail closed. Written-source extraction uses downloaded byte and expansion limits before model work.

Each extraction reserves budget using a deterministic operation ID before provider invocation and reconciles actual usage afterward. Exceeding a normalized-content limit fails the candidate snapshot without replacing the last healthy snapshot. Partial source records and operation receipts remain visible for recovery and cost audit.

Scheduled synchronization remains driven by the durable tick. A failed sync records a typed failure and next eligible retry time with bounded backoff. Reconnection-required failures do not retry automatically. Empty folders cannot produce healthy snapshots. Unchanged provider-version records are reused only when their normalized artifact still exists and passes digest read-back.

## Cross-Surface Consistency

Dashboard, web chat, Telegram, API contracts, agent prompts, monitoring, architecture data, public documentation, and tests use the same source stages, output vocabulary, capability states, approvals, and artifact identities. Legacy ingest/transcribe job fields, X-only draft assumptions, generic output promises, and video-first UI summaries are removed.

Telegram may request and report every available export format through the canonical chat handler. It may present pending X or LinkedIn decisions, but parsed text never authorizes an effect; authority remains the nonce-bound callback and shared decision engine.

## Observability and Failure Semantics

Spans and audit events record artifact IDs, output types, revisions, digests, producer/reviewer roles, action IDs, provider names, verification outcomes, cost units, and trace correlation. They exclude source content, generated copy, credentials, provider bodies, and private reasoning.

Failures retain the last durable truth:

- producer failure creates no artifact;
- review rejection creates no action;
- export failure retains the accepted artifact and a failed action;
- uncertain external publication enters reconciliation and is never retried blindly;
- verification failure preserves the receipt but marks the effect unresolved;
- one format failure does not fabricate success or silently remove another requested format.

## Testing Strategy

Implementation follows red-green-refactor. Required automated coverage includes:

- every artifact payload schema and invalid boundary;
- canonical digest stability and revision changes;
- exact source-reference validation;
- one producer and review contract per format;
- rejection and one-revision limits;
- capability-registry completeness;
- output planner rejection of unregistered formats;
- deterministic Markdown/JSON export and independent byte read-back;
- content-pack constituent verification;
- X thread partial-progress and uncertainty behavior;
- LinkedIn connection gating, policy approval, execution receipt, and fresh read verification;
- steering pause, resume, cancel, nudge, redo, stale epoch, outbox recovery, and executed-effect preservation;
- library preflight limits, budget reservation, unchanged reuse, missing-artifact rejection, backoff, reconnection, empty-folder failure, and healthy-snapshot preservation;
- chat, Telegram, Studio, monitoring, architecture, and documentation consistency;
- absence of replaced X-only, video-first, ingest, transcribe, alias, and fallback contracts.

The completion gate is the full TypeScript suite, Python suite, Firestore integration suite, ESLint, TypeScript check, production build, `git diff --check`, and targeted legacy/capability scans. Live provider tests remain external evidence work and are not represented by offline success.

## Completion Boundary

This design is complete when every repository-local capability exposed to an operator is implemented and testable under the rules above, all durable controls have recoverable delivery, all scheduled-library policy checks are enforced at the earliest reliable boundary, and all code/docs surfaces agree.

The following remain explicitly outside completion: acquiring credentials, creating cloud resources, deploying revisions, configuring real provider accounts, running authenticated Gemini/Agent Engine/Memory Bank/Drive/GCS/X/LinkedIn/Telegram calls, capturing evidence, producing the demo, writing the final submission, and freezing judged artifacts.
