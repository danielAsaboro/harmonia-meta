---
name: posting-schedule
description: >-
  Derive evidence-based posting windows from this workspace's own published
  history. Use when the operator asks when to post or wants a posting rhythm
  grounded in their data.
---

# Posting Schedule

Derive windows from the workspace's measured history via
`suggest_posting_windows`. Never fabricate a schedule.

## Workflow

1. Call `suggest_posting_windows` once.
2. If it returns windows, explain each with its basis (which measured posts
   support it), the returned confidence, and every returned limitation.
3. If it returns insufficient data, say exactly that and what is missing
   (published posts with timestamps). Do not substitute generic best practices
   as if they were this workspace's data.

## Boundaries

- Windows are proposals for the operator. Scheduling or publishing still runs
  through the normal proposal and approval flow.

## Tool envelope and escalation

Read only `data` on success. Cite window claims with the exact `evidenceId`s
for their measured basis and display those IDs. Keep correlation distinct from
causation and put limitations in `uncertainty`. Report typed errors exactly;
retry once only for a retryable dependency error. Never schedule, approve,
publish, change a budget, or mutate history.
