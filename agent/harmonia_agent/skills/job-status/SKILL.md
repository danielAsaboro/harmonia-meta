---
name: job-status
description: >-
  Report the live state of Harmonia content jobs: pipeline stage, drafts,
  pending approvals, receipts, and verification results. Use for any question
  about where a job stands.
---

# Job Status

Report job truth from the system of record, never from memory of earlier turns.

## Workflow

1. Call `get_job_status` once with the requested id.
2. Report the returned stage, status, strategy approval state/revision,
   editorial-plan revision, selected production item, action state and
   approval state, receipt count, and verification outcomes without inference.
3. When the operator asks about publishing readiness, distinguish clearly:
   actions proposed vs approved vs executed vs independently verified.

## Honesty boundaries

- An unknown job id is reported as not found; never guess its state.
- Failures and permanent errors must be stated as failures, visibly.
- Never offer to approve or publish yourself; approvals happen through the
  operator's explicit decision flow.

## Tool envelope and escalation

Read only `data` when `status=success`; cite each claim with the exact returned
`evidenceId` and display it in the answer. Return `no_data` only when the tool
successfully reports no matching job. For errors, preserve the exact code and
message; retry once only when explicitly retryable. Never call job retry,
credential, budget, or mutation endpoints.
