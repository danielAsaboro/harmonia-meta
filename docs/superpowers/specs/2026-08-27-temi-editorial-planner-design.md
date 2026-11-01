# Temi Editorial Planner Design

## Purpose

Temi converts one human-approved Ryan strategy into a durable four-week editorial plan. Temi plans the complete horizon but selects exactly one eligible item for immediate production. Noni writes only that selected item; all remaining items stay in Firestore as future planned work.

## Boundaries

Temi is agentic for editorial judgment: campaign sequencing, brief placement, supported channel and format choice, cadence distribution, production windows, deadlines, dependencies, required assets, priority, and selection rationale.

Deterministic application code owns schema enforcement, strategy-digest binding, horizon and timezone validation, supported-channel enforcement, duplicate-slot and dependency checks, canonical plan digests, persistence, item lifecycle transitions, next-item eligibility, external calendar writes, approvals, publishing, receipts, and verification.

Temi cannot define marketing strategy, alter Ryan briefs, write post copy, approve anything, claim an external schedule exists, mutate Google Calendar, publish, or create receipts/effect payloads.

## Input Contract

`EditorialPlannerInput` contains:

- the exact approved Ryan strategy, digest, version, and approval record;
- Nimi's typed analysis;
- explicit UTC horizon boundaries and IANA timezone;
- supported channel capabilities and formats;
- existing persisted calendar commitments;
- production capacity and cadence constraints;
- optional verified posting-window observations with evidence IDs;
- plan revision and optional replanning feedback.

Memory Bank may influence Ryan before approval. It does not independently authorize Temi choices or calendar effects.

## Output Contract

`EditorialPlan` contains a plan ID, version, approved strategy digest, horizon, timezone, summary, sequencing rationale, cadence rationale, assumptions, confidence, items, and exactly one `selectedNextItemId`.

Every editorial item contains:

- stable item ID and exact Ryan brief ID;
- campaign theme and content pillar;
- objective, audience, funnel stage, intended conversion, CTA intent, and KPI;
- one operationally supported channel and format allowed by the brief;
- source evidence references already present on that brief;
- publication window and production deadline inside the horizon;
- priority, selection score, dependencies, production status, constraints, and required assets;
- planning rationale and confidence.

Temi emits no final copy, external event IDs, approval claims, publishing payloads, receipts, or fabricated scheduled-state claims.

## Validation

Application validation rejects:

- a strategy digest/version mismatch or missing timely approval;
- unknown brief, evidence, pillar, theme, or audience references;
- unsupported channels or formats;
- windows or deadlines outside the horizon;
- non-increasing windows, deadlines after windows, duplicate slots, or cycles/unknown dependencies;
- cadence/capacity overflow;
- incomplete items or multiple/no selected items;
- selection of a blocked, unsupported, or dependency-incomplete item;
- final-copy-shaped fields, approval/publishing authority, external scheduling claims, effect payloads, receipts, and invalid confidence.

## Persistence and Lifecycle

The application persists the complete validated plan, canonical SHA-256 digest, approved strategy binding, revision, evidence lineage, assumptions, confidence, and immutable plan history before Noni runs.

Item states are deterministic: `planned → selected → drafting → reviewed → awaiting_approval → scheduled | published | failed`. Temi proposes initial `planned` state and one selected ID; application code performs the transition to `selected` and then `drafting`.

No additional human approval gate is added between Temi and Noni because Temi operationalizes an already approved strategy without performing an external effect.

## Production Handoff

Noni receives `ProductionDraftInput`, containing only the exact selected editorial item, its Ryan brief, referenced Nimi evidence, bounded brand context, and applicable constraints. Noni cannot choose a different brief, objective, channel, format, or production window. The existing bounded Noni ↔ Dara review loop remains unchanged except for consuming this narrower input.

## Interface

The job workspace renders the persisted plan horizon, timezone, campaign sequence, cadence, items, windows, deadlines, lineage, dependencies, statuses, priority, confidence, selected item, and selection rationale. Display data comes from Firestore, never ephemeral ADK session state.

## Verification

Tests cover coherent plans, missing/invented references, unsupported channels/formats, invalid horizons/windows, collisions, dependency cycles, incomplete items, authority overreach, deterministic selection, Firestore round-trips, exact Noni handoff, non-selected items remaining undrafted, strategy mismatch, failure before Noni, and UI rendering.

No paid model invocation, deployment, publication, external scheduling, or authenticated evidence capture is part of implementation verification.
