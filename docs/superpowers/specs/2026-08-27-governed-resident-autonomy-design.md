# Governed Resident Autonomy Design

**Date:** 2026-08-27  
**Status:** Approved design  
**Product terms:** Heartbeat, Dream Cycle, Wakeup Call

## Purpose

Harmonia is currently event-driven and proactively scheduled, but it is not yet a genuinely self-evolving resident system. It has a durable tick, scheduled publishing, proactive proposal generation, bounded memory, and human-governed model promotion. It does not have a first-class heartbeat lifecycle, a nightly reflection system, a morning agenda, or an experiment loop that can safely promote reversible operational improvements.

This design adds those capabilities without giving models control over code, security policy, permissions, budgets, or irreversible effects. The resulting system is evidence-informed, continuously operating, and conservatively self-tuning. It is not self-rewriting.

## Authority Boundary

Harmonia uses governed evolution. It may automatically apply only reversible, low-risk operational tuning within hard-coded limits:

- preferred posting windows;
- content-format weighting;
- topic-fatigue suppression;
- retry and backoff parameters within fixed bounds;
- preference among already-approved strategy templates.

The following always require authenticated human approval:

- prompts and agent instructions;
- model selection or promotion;
- policies and approval requirements;
- budgets;
- credentials and permissions;
- tools and integrations;
- workflow stages;
- source-rights rules;
- application code and infrastructure.

The Dream Cycle may propose protected changes, but it cannot apply them. No model may change its own authority class.

## Architecture

```text
Cloud Scheduler
      │ authenticated wake
      ▼
Heartbeat Controller ─── missed-wake recovery
      │ lease + immutable cycle record
      ▼
Cycle Planner
      ├── hourly Heartbeat
      ├── post-job Micro-reflection
      ├── nightly Dream Cycle
      └── morning Wakeup Call
             │
             ▼
      Pub/Sub work envelopes
             │
             ▼
      Bounded ADK specialists
             │
             ▼
Firestore evidence ledger
  observations → reflections → hypotheses
  → experiments → evaluations → promotions/rollbacks
```

Cloud Scheduler is the clock. Cloud Run is the stateless execution boundary. Firestore owns cycle truth, leases, agendas, observations, experiments, and configuration revisions. Pub/Sub delivers bounded work. Agent Engine and Gemini perform typed cognitive work; they do not own scheduling, authorization, or durable truth.

This approach preserves scale-to-zero behavior and matches Harmonia's existing durable-control-plane architecture. A long-lived Agent Engine session is explicitly rejected as the operational clock because managed cognitive state is not an appropriate lease, recovery, or authorization store. Google Cloud Workflows is also deferred because it would duplicate the existing Firestore state machine.

## Cycle Model

Every cycle has an immutable identity derived from workspace, brand, cycle type, and scheduled window. Its durable state is:

```text
scheduled → claimed → running → completed
                              ↘ partially_completed
                              ↘ failed
                              ↘ uncertain
```

Each record includes scheduled time, actual start and finish, workspace timezone, lease owner and expiry, trigger reason, cycle version, trace ID, arms attempted, evidence inputs, model usage, estimated and observed cost, outcome, and next scheduled wake.

Duplicate cycle identities are suppressed. A missed cycle is recovered exactly once when still useful. Old Wakeup Calls are not replayed indefinitely. An uncertain effect-bearing arm fails closed and requests operator attention; unrelated arms continue.

### Hourly Heartbeat

The Heartbeat runs hourly. It performs cheap deterministic work first and normally makes no model call. It:

- records liveness and the next expected wake;
- detects and recovers eligible missed cycles;
- retries pending stage outboxes;
- detects stuck jobs and expired leases;
- processes non-urgent autonomous maintenance;
- checks workspace budget and provider health;
- records paused arms and attention requests.

Time-sensitive scheduled publishing does not wait for the hourly Heartbeat. Already-authorized publishing retains precise Scheduler or Pub/Sub wakeups.

### Post-job Micro-reflection

Micro-reflection is triggered when a job completes or fails, independent verification arrives, an operator approves or rejects a proposal, or engagement data reaches its measurement window. It produces bounded observations from authenticated, eligible evidence and deduplicates them by source record and observation type.

Micro-reflection cannot change configuration. It records facts such as approval outcome, verified effect outcome, failure category, latency, cost, content format, posting window, and measured engagement. Raw prompts, chain-of-thought, arbitrary logs, credentials, replay output, fixtures, and unverified claims are ineligible.

### Nightly Dream Cycle

The Dream Cycle runs nightly in the workspace's configured timezone and skips when no new eligible evidence exists. “Dream” is a product term for bounded offline synthesis, not consciousness or hidden reasoning.

It:

- groups new observations;
- detects repeated patterns, contradictions, stale beliefs, and evidence gaps;
- creates typed reflections and hypotheses;
- proposes experiments;
- evaluates experiments whose measurement windows have closed;
- recommends promotion, rejection, expiry, or rollback.

Every persisted output contains evidence references, scope, confidence, expiry, expected benefit, risk class, estimated cost, evaluation criteria, and a safe activity summary. Private chain-of-thought is never requested or stored.

### Morning Wakeup Call

The Wakeup Call runs each morning in the workspace timezone. It uses persisted Dream Cycle results rather than repeating nightly analysis. It assembles a visible operator briefing and a durable agenda from:

- unfinished, failed, or uncertain jobs;
- pending approvals and attention requests;
- scheduled content and calendar gaps;
- verified engagement signals;
- content inventory and topic fatigue;
- active experiments and recent configuration changes;
- approved memory;
- workspace budget and provider health.

The briefing explains what happened, what changed, what needs attention, and what Harmonia intends to do. The agenda contains independently executable items with one of four authority classes:

- `execute`: deterministic maintenance or already-authorized scheduled work;
- `auto_tune`: reversible conservative tuning within hard limits;
- `propose`: content or protected evolution candidates requiring review;
- `request_attention`: uncertainty, failures, budget exhaustion, or missing credentials.

Each item has an idempotency key, evidence links, cost reservation, deadline, risk, authority class, execution state, and terminal record. One failed item does not block unrelated agenda items.

## Evidence and Experiment Lifecycle

```text
Observation
  → Reflection
  → Hypothesis
  → Experiment candidate
  → Evaluation window
  → Promote, reject, or expire
  → Roll back if later guardrails fail
```

Experiments are workspace-and-brand scoped and immutable after activation. An experiment specifies one bounded variable, baseline, candidate, hard bounds, evidence threshold, evaluation method, success and failure criteria, maximum cost, start and end times, expiry, and rollback condition.

Automatic promotion requires verified live evidence, sufficient sample size, no unresolved contradiction, deterministic policy approval, budget availability, and a reversible candidate. Fixtures, mocks, recorded replay, synthetic evaluations, and unverified provider claims cannot qualify. Where practical, evaluation uses a holdout; otherwise it uses a declared before-and-after comparison and records the weaker causal confidence.

Every promotion creates a versioned configuration revision with previous and new values, evidence, confidence, policy result, trace, and rollback pointer. Later guardrail failure automatically restores the previous revision and records the reason.

## Security

- Scheduler authenticates to private Cloud Run with OIDC.
- Tenant scope is established before retrieving evidence or memory.
- Dream and Wakeup Call agents receive sanitized evidence summaries and stable references.
- Untrusted source content cannot create experiments or configuration changes.
- Only authenticated operator decisions and independently verified outcomes qualify as evolutionary evidence.
- Deterministic policy revalidates every proposed automatic change after model evaluation.
- Models never receive credentials, approval capabilities, publishing tools, or configuration-write authority.
- Firestore rules and server-side adapters enforce workspace and brand scope.
- Replay and fixture provenance is permanently excluded from live learning and promotion.
- Protected configuration categories require exact-payload human approval.

## Cost Controls

- The hourly Heartbeat uses deterministic checks and invokes no model unless cognitive work is due.
- Micro-reflections are deduplicated and batchable.
- The Dream Cycle skips when there is no new eligible evidence.
- The Wakeup Call reuses persisted nightly synthesis.
- Every cognitive arm reserves budget before Gemini invocation.
- Workspace daily and monthly autonomy budgets complement per-job budgets.
- A candidate that would exceed the current budget envelope cannot auto-promote.
- Expensive media generation remains proposal-only.
- A paid-arm failure pauses that arm while free maintenance continues.

## Autonomous Operations View

The dashboard exposes:

- last and next Heartbeat;
- last Dream Cycle;
- today's Wakeup Call and briefing;
- missed and recovered cycles;
- active, completed, failed, and deferred agenda items;
- observations and evidence references;
- hypotheses and experiments;
- automatic configuration revisions;
- promotion and rollback history;
- token usage and cost;
- paused arms and requests for attention.

The view uses durable records and safe activity summaries. It never fabricates activity, exposes chain-of-thought, or presents replay as current autonomous execution.

## Failure and Recovery

Cycle arms fail independently. Typed failures distinguish transient provider failure, permanent provider failure, policy rejection, authorization failure, budget exhaustion, insufficient evidence, integrity failure, and uncertain effect state. Transient deterministic work can retry within bounded policy. Cognitive retries reserve additional cost. Permanent and uncertain failures become visible attention requests.

Lease expiry does not prove that an effect did not occur. Effect-bearing work continues to use immutable commands, atomic idempotency claims, receipts, and independent verification. The autonomy layer cannot weaken these boundaries.

## Acceptance and Truthfulness

Implementation status must continue to distinguish `implemented`, `configured`, `deployed`, and `evidenced`. The resident autonomy system is accepted only when it has:

- deterministic fixture tests for cycle states, leases, deduplication, safety policy, tuning bounds, promotion, and rollback;
- sanitized replay scenarios for local UX development, visibly historical;
- authenticated Scheduler-to-Cloud-Run-to-Firestore wake evidence;
- missed-wake recovery and duplicate suppression evidence;
- one real Dream Cycle grounded in authorized verified records;
- one real Wakeup Call that persists a durable agenda;
- one reversible experiment promoted or rejected from eligible live evidence;
- correlated cost and trace records across the cycle;
- dashboard evidence showing real cycle and agenda state.

Until those authenticated checks exist, documentation must not claim that resident autonomy or governed evolution works in production.

## Delivery Order

1. Add strict cycle, observation, reflection, hypothesis, experiment, configuration-revision, and agenda contracts.
2. Add Firestore repositories and idempotent lease/state transitions.
3. Replace the generic durable tick with explicit hourly Heartbeat orchestration while preserving precise scheduled-effect wakes.
4. Add event-driven Micro-reflection.
5. Add the nightly Dream Cycle and deterministic eligibility gates.
6. Add the morning Wakeup Call and agenda dispatcher.
7. Add bounded auto-tuning, experiment evaluation, promotion, and rollback.
8. Add the autonomous operations dashboard and replay events.
9. Update architecture truth documentation and deployment configuration.
10. Verify locally before any authenticated deployment or evidence capture.
