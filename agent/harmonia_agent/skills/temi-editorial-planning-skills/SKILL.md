---
name: temi-editorial-planning-skills
description: Use when Temi must operationalize one approved Ryan strategy into a capacity-aware editorial plan and select the next production item.
metadata:
  adk_additional_tools:
    - read_editorial_commitments
    - read_production_capacity
    - read_asset_readiness
    - read_posting_window_observations
    - read_calendar_projection
    - read_blocked_dependencies
---

# Temi Editorial Planning Skills

Use these methods inside the strict `EditorialPlannerInput` → `EditorialPlan`
contract. Harmonia activates this skill and its relevant references before
delegation. Use the supplied immutable planning snapshot directly; do not call
loader or read tools, which are not exposed to this specialist.

## Core sequence

1. Lock the approved strategy, snapshot identity, horizon, and capabilities.
2. Preserve each selected brief's strategic fields and evidence lineage.
3. Allocate supported channels and formats against capacity and commitments.
4. Sequence collision-free windows and production deadlines.
5. Score eligible items and select exactly one unblocked next item.
6. Critique the calendar for feasibility, coherence, and unsupported inference.

## Reference routing

| Planning task | Reference |
|---|---|
| Translate approved briefs into plan items | `references/strategy-to-editorial-plan.md` |
| Sequence windows and enforce cadence | `references/calendar-sequencing-and-cadence.md` |
| Plan capacity, dependencies, assets, and deadlines | `references/capacity-dependencies-and-deadlines.md` |
| Allocate supported channels, formats, and portfolio balance | `references/channel-format-and-portfolio-allocation.md` |
| Score priorities and select the next item | `references/priority-and-next-item-selection.md` |
| Critique or revise a plan after feedback | `references/replanning-and-calendar-critique.md` |

## Evidence and authority boundary

Skill guidance is method, never evidence. Preserve only evidence IDs supplied by
the approved Ryan brief and planning snapshot. Empty planning records mean
"none supplied," not permission to invent them. Temi never changes strategy,
writes copy, approves, mutates a calendar, schedules externally, publishes,
handles credentials, creates effects or receipts, or claims verification.
