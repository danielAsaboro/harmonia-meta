# Harmonia Generative A2UI Workspace Design

**Date:** 2026-08-23  
**Status:** Approved direction  
**Scope:** Authenticated Harmonia studio and its streamed A2UI response surfaces

## Summary

Harmonia will make its working canvas a genuine agent-composed interface. A dedicated Google ADK presentation agent will choose a layout from a trusted Harmonia A2UI catalog based on the operator's request and current campaign state. The model will reference persisted entities rather than author their trusted contents. A server-side hydrator will resolve those references, enforce authorization and lifecycle rules, and emit validated A2UI operations through the existing durable chat-run event stream.

The stable product shell remains human-designed: navigation, conversation history, composer, canvas boundary, and approval boundary. Inside that shell, the active work surface changes shape around the operator's task. A request to find moments produces a media-analysis surface; a drafting request produces an editorial comparison surface; an approval request produces a decision surface; a completed action produces verification evidence.

This replaces the current pattern in which a deterministic function translates every chat response into the same generic component column and the studio hides that column inside an “Agent-generated interface” disclosure.

## Problem

The current implementation has useful protocol foundations:

- strict Zod validation for catalog components and stream events;
- an official A2UI processor and React renderer;
- durable, sequenced chat-run events with replay;
- protected confirmation actions;
- attachment and asset routes bound to persisted records; and
- visible failure states for malformed protocol data.

However, it is not yet generative UI in the product sense. `buildResponseSurface()` deterministically maps a fixed `ChatResponse` into a `Column` containing generic elements such as `MessageContent`, `TaskView`, `PlanView`, and `QueueView`. The ADK agent does not select the interface. `partitionStudioOperations()` then discards the generated hierarchy by flattening components into fixed conversation, canvas, and approval groups. Finally, `WorkingCanvas` treats the result as supplemental diagnostics.

The result communicates agent telemetry, but it does not let the interface become the natural answer to the operator's request.

## Goals

- Let an ADK agent select and compose the most useful interface for the current operator intent and campaign state.
- Make generated surfaces feel native to Harmonia's editorial and multimodal design language.
- Bind every displayed draft, moment, source, asset, action, and receipt to authorized persisted state.
- Preserve durable streaming, replay, error visibility, approval receipts, idempotency, and existing backend contracts.
- Support written-only, uploaded-media, and YouTube-backed campaigns without treating any one path as a fallback.
- Make the generative surface the primary working canvas rather than a collapsible technical appendix.
- Keep the first slice narrow enough to demonstrate one real ingest-to-verification workflow reliably.

## Non-goals

- Arbitrary model-generated HTML, CSS, JavaScript, JSX, or iframe applications.
- MCP Apps support.
- Replacing the normal conversation interface or the stable studio shell.
- Allowing A2UI actions to bypass existing server authorization, approval, or idempotency checks.
- Changing Firestore job shapes, Pub/Sub stage contracts, publishing behavior, or verification semantics solely to simplify rendering.
- Fabricating media, sources, receipts, model success, or external execution state when persisted evidence is absent.
- Migrating the A2UI protocol version during the first slice. The existing v0.9 protocol surface remains in place until the product behavior is verified.

## Considered Approaches

### More deterministic templates

The server could choose among hand-authored templates based on `ChatResponse.intent`. This is low risk and visually controllable, but the interface would still be a fixed routing table. Adding a new operator need would require another manually coded response path. This does not meet the desired generative behavior.

### Agent-generated component data

The agent could emit complete A2UI component trees including all visible content. This is expressive, but it allows model output to duplicate or contradict Firestore state. It also makes approval, cost, provenance, and receipt data harder to trust.

### Agent-generated plan with trusted hydration

The selected approach separates composition from truth. The agent generates a strict `SurfacePlan` containing layout intent, component types, and references to persisted entities. The web application resolves those references and constructs the final A2UI component properties. This preserves model-driven composition while preventing the model from inventing trusted operational data.

## Architectural Model

The system has five distinct responsibilities.

### Stable studio shell

The shell owns global navigation, campaign identity, long conversation history, composer behavior, resizable pane geometry, the current canvas slot, and the global approval boundary. These areas remain predictable across requests.

### Presentation context builder

The web service constructs a bounded `UiContext` from the authenticated operator request and persisted application state. It includes identifiers and concise presentation-safe summaries for the active job, drafts, moments, sources, assets, actions, receipts, failures, and current selection. It never includes credentials, unrestricted URLs, private reasoning, or raw records the presentation agent does not need.

### ADK presentation agent

A dedicated presentation specialist receives the `UiContext`, the supported Harmonia catalog, and a description of available surface slots. It returns a strict `SurfacePlan`. The agent decides what to emphasize, how to group related information, and which supported interaction should be offered. It cannot introduce unknown component types or arbitrary executable behavior.

The agent may generate editorial labels, short explanatory copy, and headings when they are clearly marked as generated presentation text. It may not generate authoritative job state, source claims, action risk, cost, destination, or verification status.

### Trusted surface hydrator

The hydrator validates the `SurfacePlan`, resolves every entity reference against the authenticated persisted snapshot, computes trusted derived properties, and produces A2UI operations. Missing, stale, cross-tenant, or state-incompatible references fail closed into an explicit unresolved surface. They never silently disappear and never become simulated success.

### Native A2UI renderer

The existing React host renders the validated surface with Harmonia-native components. Generated hierarchy is preserved. The renderer dispatches only allow-listed actions, and protected actions return to existing server endpoints for authorization and state validation.

## Surface Placement

The application supports three explicit slots, each represented by its own A2UI surface instead of splitting one component tree after generation.

- **Canvas:** the primary, persistent work surface. It may use the full available canvas and contain complex editorial or multimodal composition.
- **Conversation:** a compact inline surface linked to a particular turn. It summarizes what changed or offers a small local interaction without duplicating the canvas.
- **Approval:** a focused decision surface mounted inside the existing global approval boundary.

Surface identity includes the run, slot, and revision. Slot selection is part of the validated plan envelope, not inferred from individual component names. Components keep their original parent-child relationships within each surface.

## Harmonia Catalog

The first product-specific catalog includes the following components.

### `CampaignBrief`

Presents the current campaign direction, audience, narrative constraints, and source-backed creative premise. Trusted campaign references are hydrated from persisted job state; generated framing is visibly distinguished from persisted facts.

### `JobProgress`

Shows the asynchronous workflow as meaningful production stages with active, completed, blocked, failed, and waiting-for-approval states. It replaces the generic plan list for job-backed work.

### `MomentExplorer`

Combines authorized source media, transcript segments, detected moments, time ranges, evidence markers, and selection state. It supports synchronized seeking and moment selection without changing the underlying job record until an explicit action is submitted.

### `DraftComparison`

Compares real draft variants, their platforms, validation state, source links, and editorial differences. It supports selecting a working variant and requesting a revision through allow-listed actions.

### `PlatformPreview`

Renders a platform-native preview using persisted draft text and authorized assets. It is a Harmonia preview, not an imitation that implies endorsement by the destination platform.

### `SourceEvidence`

Connects claims, drafts, transcript segments, moments, and external HTTP(S) sources. Links remain protocol-validated and provenance remains visible.

### `ApprovalReview`

Presents the exact persisted action, destination, content, risk, estimated cost when available, policy outcome, and expected external effect. Its decision controls dispatch existing protected approval actions; it cannot create or mutate an action definition.

### `VerificationReceipt`

Displays a persisted execution receipt and independently reread verification state. It distinguishes planned, executed, verified, unresolved, and failed outcomes.

### Shared state components

`SurfaceLoading`, `SurfaceEmpty`, `SurfaceUnresolved`, and `SurfaceFailure` express honest incomplete states. Existing `ActivityTrace`, `ToolActivity`, and `ReasoningSummary` remain available for compact conversation summaries and expandable technical details, but they are not the primary canvas vocabulary.

Basic A2UI layout primitives remain available where they map directly to Harmonia's design system. Unsafe primitives and arbitrary HTML are not registered.

## Data Flow

1. The operator submits a conversational request with zero or more ready attachments.
2. The chat run is created and `run_started` is persisted.
3. Existing intent and application logic performs the requested read or creates the authorized asynchronous job.
4. The presentation context builder reads the resulting persisted snapshot and constructs `UiContext`.
5. The ADK presentation agent emits a validated `SurfacePlan` for one or more slots.
6. The hydrator resolves entity references and emits `createSurface` plus incremental component and data updates.
7. Each A2UI operation is persisted before it is streamed to the browser.
8. The client progressively renders or updates the surface.
9. A user interaction dispatches an allow-listed action with the originating surface and component identity.
10. Client-local presentation actions update selection only. Agent or workflow actions are validated by the server, recorded, and may produce a revised surface.
11. Reconnection replays the same durable operations in sequence, reconstructing the latest surface without regenerating it.

## Surface Plans and Truth Boundaries

A `SurfacePlan` describes composition; it does not carry authoritative domain records. Each component instance contains:

- a stable component ID;
- a catalog component name;
- a slot;
- presentation options from a bounded schema;
- references such as `jobId`, `draftIds`, `momentIds`, `sourceIds`, `assetActionIds`, or `actionIds`; and
- child component IDs when composition requires nesting.

The hydrator owns:

- loading records under the current tenant;
- enforcing reference cardinality and size limits;
- deriving media preview routes;
- calculating display status from persisted lifecycle state;
- excluding missing or unauthorized fields;
- verifying action state before exposing controls; and
- producing visible unresolved components when a reference cannot be satisfied.

This boundary makes the model responsible for relevance and composition while the application remains responsible for truth and authority.

## Interaction Model

Actions fall into three classes.

### Local presentation actions

Selecting a moment, changing a comparison tab, seeking media, expanding evidence, or changing preview format may remain client-local. These actions cannot mutate persisted workflow state or initiate external effects.

### Agent revision actions

Requests such as “revise this variant,” “use these moments,” or “compare a different angle” become normal authenticated chat or agent requests. They include stable entity references and produce a new surface revision through the durable stream.

### Protected workflow actions

Approval, rejection, retry, publish, export, and any other material side effect use existing protected server operations. The component sends identifiers and the requested decision, never replacement action data. The server re-reads the action, tenant, current state, approval requirements, and idempotency record before accepting it.

## Streaming, Persistence, and Revision

The existing chat-run event log remains the source of replay truth. A surface may be progressively assembled and updated during one run. A later interaction creates a new run and revision rather than rewriting historical events.

The canvas shows the latest valid revision for its active campaign while conversation turns retain links to the surface revision they produced. This preserves the product model: the conversation is the decision history; the canvas is the current working truth.

If generation stops mid-surface, the latest structurally valid revision remains visible with a failure or interrupted state. The client never treats an incomplete operation sequence as a successful finished surface.

## Error Handling

- Invalid presentation-agent output is a visible permanent protocol failure for that run.
- Unknown components, actions, slots, or references are rejected before rendering.
- Missing persisted references become explicit unresolved states with retry or navigation affordances when safe.
- Transient agent or transport failures remain retryable without replaying protected actions.
- A surface action submitted from a stale revision is rejected or refreshed before mutation.
- Media preview failure does not imply asset failure; the UI distinguishes delivery errors from missing stored assets.
- Approval and verification failures retain their receipts and remain visible until resolved.

## Responsive and Accessible Behavior

Desktop keeps the established conversation-and-canvas composition, with the generated canvas receiving the larger share. Mobile presents conversation and working surface as deliberate peer views with persistent indicators for active work and pending decisions.

Catalog components define semantic roles, labels, focus order, keyboard behavior, and reduced-motion behavior as part of their implementation contract. The presentation agent may choose components and hierarchy, but it cannot remove required labels, hide approval consequences, encode meaning only through color, or create inaccessible control patterns.

Complex components degrade structurally rather than only shrinking. `MomentExplorer`, for example, moves from synchronized side-by-side panes to a media-first sequence with transcript and moment drawers. `DraftComparison` becomes swipe- or tab-based while retaining explicit variant names and selection state.

## Testing Strategy

Contract tests verify every catalog component, surface-plan variant, reference bound, slot, and action. Unknown or unsafe values must fail closed.

Hydration tests prove that generated plans can only display persisted authorized records, that stale references become unresolved states, and that protected component properties are derived rather than accepted from model output.

Processor and replay tests prove that incremental operations materialize through the official A2UI processor and reconstruct identically from the durable event log.

Action tests verify local versus server actions, tenant isolation, stale revision rejection, approval idempotency, and the inability to alter trusted action data from the client.

Intent-level tests evaluate whether the presentation agent selects an appropriate component family for representative requests without asserting exact pixel placement. Deterministic catalog and hydration tests continue to assert exact safety behavior.

Browser tests verify the first vertical slice at desktop and mobile widths, including progressive generation, media synchronization, keyboard focus, approval review, error recovery, and verification evidence. Visual inspection remains required in addition to automated tests.

## First Demonstrable Slice

The first slice begins with one real YouTube or uploaded-video job and covers:

- a generated `JobProgress` surface while processing;
- a `MomentExplorer` backed by persisted transcript segments and detected moments;
- a `DraftComparison` with source traceability;
- an `ApprovalReview` bound to a real planned action or content-pack export;
- the existing protected approval flow; and
- a `VerificationReceipt` backed by persisted execution and independent verification evidence.

Written-only jobs reuse the same catalog through `CampaignBrief`, `DraftComparison`, `PlatformPreview`, `ApprovalReview`, and `VerificationReceipt`, with no empty video-shaped shell.

## Consequences

The architecture adds a presentation-agent invocation and therefore latency, cost, and another failure boundary. Progressive operations and retention of the last valid surface reduce the perceived and operational cost. The plan/hydration split also adds implementation complexity, but it is the mechanism that lets Harmonia claim genuine agent-composed UI without surrendering truth, safety, or brand consistency.

The result is intentionally not an infinitely open interface generator. Harmonia gains expressive composition by expanding a curated domain catalog. New product capabilities require new trusted components, while new combinations of existing capabilities can be generated without another fixed dashboard template.
