# Operator Workspace Design

## Goal

Turn the studio from an internal execution dashboard into an operator workspace that answers three questions in order: what needs me, what content exists, and what proves the result.

## Interaction hierarchy

1. The action layer presents exactly one plain-language job state: Working, Needs information, Needs approval, Blocked, or Complete. It includes the next safe action and never presents a zero-decision review control.
2. The work layer contains the saved brief, content artifacts, media, sources, and editorial schedule. Content is previewed in a platform-shaped surface. Operators revise immutable artifacts by sending a grounded revision request through chat, never by mutating accepted artifacts in place.
3. The proof layer is an on-demand drawer containing persisted lifecycle, authority, receipts, verification, and event history. Raw identifiers and digests stay in this layer or collapsed provenance disclosures.

## Components and data flow

- `operatorStatusForJob` remains the single mapping from persisted job state to operator copy.
- `JobBriefCard` summarizes the original operator brief, selected outputs, destinations, and source count. It is a checkpoint, not a second source of truth.
- `SinceLastVisit` compares persisted event timestamps with a job-scoped timestamp in local storage. It records presentation state only and grants no workflow authority.
- `WrittenWorkspace` renders platform-native previews and an editable revision composer. Submitting creates a normal grounded chat request through the existing callback.
- `EditorialCalendar` renders the existing persisted editorial-plan items as a schedule grouped by date. The standalone calendar route remains unchanged.
- `ProofDrawer` owns the execution proof and event timeline. The approval boundary remains separate and unchanged in authority.

## Error handling and accessibility

Failures lead with preservation and recovery. Provider and contract metadata appears under Technical details. Primary controls use at least 12px labels, clear focus styles, semantic headings, buttons, status regions, and accessible drawer/dialog labels.

## Constraints

- Do not change workflow stages, approval semantics, receipts, or effect authority.
- Do not mutate accepted artifacts in place.
- Do not introduce mock data or simulated outcomes.
- Do not expose full internal identifiers or digests in primary operator views.

## Verification

Server-rendered component tests cover state mapping, hierarchy, brief display, platform previews, revision requests, calendar grouping, proof drawer placement, and zero-review behavior. The full Vitest suite, focused ESLint, TypeScript, and the production build must pass.
