# Interactive Architecture Explorer Design

> **Historical design — superseded 2026-08-28.** Earlier agent names in this record are not current product claims. Use [`docs/reference/agent-runtime-inventory.mdx`](../../reference/agent-runtime-inventory.mdx) and [`docs/architecture-explorer.mdx`](../../architecture-explorer.mdx) for the maintained contract.

**Date:** 2026-08-26
**Status:** Approved

## Purpose

Harmonia needs a judge-ready, interactive architecture explorer that turns the checked-in architecture into a progressively disclosed system map. The explorer must help a judge understand the system in under thirty seconds, while letting engineers inspect agents, models, prompts, workflow stages, APIs, state ownership, approval boundaries, verification, and operational controls without relying on the static blueprint as architectural truth.

The repository implementation and public documentation are authoritative. The explorer must never invent capabilities, expose private parent-workspace paths, or present offline contract verification as authenticated production evidence.

## Route and Product Surface

Add an authenticated `/dashboard/architecture` route and an `Architecture` item to the existing dashboard navigation rail. The route uses the normal dashboard frame but owns a full-height dark technical canvas so the graph remains suitable for screen sharing.

The desktop surface contains:

- a compact title and status summary;
- search, layer/status filters, presets, expand/collapse, reset, and fit controls;
- a React Flow graph with ELK-computed hierarchical orthogonal layout;
- a persistent or popover legend whose edge meanings do not depend on color alone;
- a detail drawer that opens without resetting pan, zoom, expansion, or filters.

On narrow screens, replace the freeform canvas with an accessible hierarchical architecture list. The list keeps search, filters, presets, expansion, selection, URL sharing, and the same detail drawer. This is an intentional mobile presentation, not a reduced graph hidden behind horizontal scrolling.

## Architecture Data Model

Store architecture truth separately from React presentation. A Zod schema validates a typed dataset containing:

- nodes and parent groups;
- edges and semantic edge types;
- layers, implementation statuses, authority, data scopes, and runtimes;
- model and prompt/instruction responsibilities;
- tool, skill, route, source-file, and documentation references;
- default expansion and preset membership;
- inputs, outputs, approval, idempotency, verification, limitations, and state-lifetime metadata.

The public dataset references repository-relative paths under `src/`, `agent/`, and `docs/` only. It cannot contain `/Users/`, parent-workspace `resources/`, credentials, private evidence, or unsupported deployment claims.

Validation runs at module initialization and in tests. It rejects:

- duplicate node or edge IDs;
- dangling edge endpoints;
- unknown parents or cyclic group ownership;
- unknown enum values;
- external-effect nodes without an inbound approval relationship;
- executed effects without a verification path;
- agent nodes that claim approval, publishing, credential mutation, destructive, or effect-execution authority;
- Agent Engine marked as durable workflow state;
- Firestore omitted as the durable workflow owner;
- pending-live integrations marked live or fully verified;
- private absolute paths in public references.

## Required Architecture Content

The initial overview contains meaningful summary nodes for operator surfaces, the Next.js control plane, APIs, durable workflow, ADK worker, Agent Engine, agent team, state, effects and verification, external services, and observability.

Expansion reveals:

- operator surfaces: dashboard, A2UI conversational console, Telegram, and Google authentication;
- control plane: chat, upload, decisions, calendar, authentication/tenancy, A2UI, streaming, and public/internal route families;
- workflow: ingest, transcribe, analyze, ideate, draft, await approval, publish/export/render, verify, and learn;
- agent team: Harmonia coordinator; Ryan; Sophia; Flo; Maya; Nova;
- Flo: the exact sequential Nimi → Dara → Temi flow;
- Nova: five runtime skills and six read-only tools with public or workspace data scope;
- effect safety: approval receipt → idempotency key → effect claim → provider/artifact execution → execution receipt → independent read-back → verification record, plus the uncertain-claim reconciliation branch;
- state: Firestore collections, Pub/Sub delivery, exact-scope Memory Bank eligibility, asset storage, reservations, usage, claims, receipts, and verification records;
- APIs: authenticated route families and representative existing endpoints, plus the service-authenticated internal worker boundary;
- observability: W3C propagation, metadata-only traces, usage normalization, reservations, and budget controls.

Agent and model allocation is exact:

- Harmonia coordinator — Gemini 3.5 Flash-Lite;
- Ryan strategist — Gemini 3.5 Flash;
- Sophia multimodal analyst — Gemini 3.5 Flash;
- Flo — ADK `SequentialAgent` exposed through `AgentTool`;
- Nimi copywriter — Gemma 3 12B IT;
- Dara editor — Gemini 3.5 Flash;
- Temi planner — Gemini 3.5 Flash-Lite;
- Maya A2UI presenter — Gemini 3.5 Flash;
- Nova insight liaison — Gemini 3.5 Flash.

Authority labels state that the coordinator delegates only, cognitive agents cannot approve or execute effects, Temi proposes but does not execute, Nova is read-only, Agent Engine is ephemeral cognition, and Firestore is durable truth.

## Projection, Expansion, and Layout

Groups are structural nodes with `summary` and `children`. Collapsed groups project to one summary node; expanded groups project their children and may retain a lightweight labeled container. Edges whose endpoint is hidden are lifted to the nearest visible ancestor, deduplicated, and labeled with their original semantic relationship.

Expansion state is independent from filters. Filtering does not destroy a user's expanded groups. Search temporarily reveals matching descendants and their ancestor chain, while clearing search restores the prior projection.

ELK receives only the visible structural graph and a layout profile. Layout uses layered direction, orthogonal routing, fixed spacing, and stable node dimensions. Results are cached by a deterministic signature of visible node IDs, visible edge IDs, expansion, preset, and responsive mode. Selecting a node, opening the legend, or changing drawer state does not trigger layout. During a genuine layout change the UI keeps the prior graph visible with a small updating indicator, then fits only when the user requested a preset, reset, or initial load.

## Interaction and URL Contract

URL query parameters are the shareable source for deliberate navigation state:

- `preset`: selected preset ID;
- `node`: selected node ID;
- `expanded`: comma-separated expanded group IDs;
- `layers`: comma-separated active layer filters;
- `statuses`: comma-separated active status filters;
- `q`: search query.

Invalid values are ignored and normalized without crashing. Initial state comes from the URL; subsequent actions use `router.replace` so normal exploration does not flood browser history. Node and preset links remain directly shareable. Pan and zoom are intentionally session-local, because encoding continuous viewport changes would make URLs noisy and unstable.

Presets define expansion, filters, focus nodes, and fit behavior for system overview, agent team, content workflow, approval/effect safety, state ownership, APIs/integrations, and observability/cost.

Keyboard behavior includes labeled buttons, visible focus, Enter/Space node activation, Escape drawer dismissal, standard React Flow keyboard navigation where supported, and a non-graph mobile/list equivalent. Search results and filter counts are announced through polite live regions.

## Edge Semantics and Visual Language

Edges use color plus a textual label, marker shape, dash pattern, and legend icon:

- durable transition/state transport — cyan solid arrow;
- agent delegation — violet solid branch arrow;
- human decision/approval — amber solid gate marker;
- external effect — green solid effect marker after approval;
- independent verification read-back — green double/dashed return arrow;
- read-only retrieval — gray dashed arrow;
- Memory Bank retrieval — violet dotted database arrow;
- telemetry propagation — cyan dotted trace arrow;
- failure, uncertainty, or blocked authority — red dashed stop marker.

Nodes use Harmonia's blueprint palette while preserving the existing product's typography, spacing, rounded panels, and restrained glass treatment. Provider logos are not added. Existing generic icons may be reused; otherwise CSS and text symbols provide semantic markers.

## Detail Drawer

The drawer renders only fields present on the selected typed node. Depending on the component, it shows role, category, runtime, model, prompt responsibility, inputs/outputs, tools and permissions, data scope, state lifetime, approval/idempotency/verification behavior, implementation status, limitations, representative routes, source files, and links to public documentation.

Source references are display-only repository-relative paths. Documentation links target the public docs page names. The drawer always exposes a copyable deep link and a close button, retains graph position, traps no focus unnecessarily, and returns focus to the selected node or list item when closed.

## Documentation

Add `docs/architecture-explorer.mdx` as the explorer entry point and include it in the Overview section of `docs/docs.json`. The page explains navigation, progressive disclosure, edge semantics, agent authority, workflow, state ownership, effect safety, skills/tools, models, route families, observability/cost, status vocabulary, accessibility, and dataset maintenance.

It links to, rather than duplicates, `architecture`, `pipeline`, `agent-platform`, `state-ownership`, `approval-and-audit`, `tool-contracts`, `observability`, and `models-cost-evaluation`. The application explorer links back to this page and relevant node-specific documents.

## Testing Strategy

Use Vitest and the repository's existing static-contract style for pure modules. Add a lightweight React DOM test environment only if already supported by installed dependencies; otherwise component behavior is split into tested pure state/view-model functions plus server-renderable accessibility contracts to avoid introducing a large testing stack solely for this feature.

Tests cover:

- valid dataset parsing and all required node content;
- duplicate IDs, dangling edges, parent cycles, private paths, and enum rejection;
- approval, verification, agent-authority, Firestore ownership, and Agent Engine lifetime invariants;
- group projection, lifted edges, collapse/expand, search, filters, and presets;
- URL parse/serialize and invalid deep-link restoration;
- node selection and detail view-model content;
- accessible labels, non-color edge semantics, keyboard-operable controls, and mobile list fallback;
- route/navigation/docs integration.

The completion gate is the focused red-green test cycle followed by the full Vitest suite, TypeScript checking, ESLint, and `next build`. The explorer is not described as complete unless each command exits successfully in a fresh verification run.

## Dependencies and Boundaries

Add `@xyflow/react` for the graph and `elkjs` for layout, preserving npm and the existing lockfile. Zod is already present. No new backend service, storage, authentication mechanism, telemetry destination, or external data integration is introduced.

This feature documents and explores existing architecture. It does not execute jobs, approve actions, call providers, alter credentials, create deployment evidence, or change Harmonia's runtime authority boundaries.
