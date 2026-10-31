# Governed Resident Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, tenant-scoped resident autonomy control plane with hourly Heartbeats, post-job Micro-reflections, nightly Dream Cycles, morning Wakeup Calls, bounded experiments, conservative automatic tuning, rollback, and a truthful operations view.

**Architecture:** Firestore owns immutable cycle identities, leases, evidence, agendas, experiments, and configuration revisions. Cloud Scheduler only wakes a private Cloud Run boundary; deterministic TypeScript policy and Python orchestration decide which independent arms may run, while ADK/Gemini receive sanitized typed inputs and never obtain scheduling, approval, budget, effect, or configuration-write authority. Existing precise scheduled-effect wakes and idempotent effect commands remain unchanged.

**Tech Stack:** TypeScript 5, Zod 4, Firestore transactions, Next.js 16, React 19, Vitest 4, Python 3.14, Google ADK, pytest, Cloud Run, Pub/Sub, Cloud Scheduler.

**Spec:** `docs/superpowers/specs/2026-08-27-governed-resident-autonomy-design.md`

## Global Constraints

- Runtime documentation distinguishes `implemented`, `configured`, `deployed`, and `evidenced`.
- No model may change code, prompts, agents, models, policies, approvals, budgets, credentials, permissions, tools, integrations, workflow stages, source-rights rules, or infrastructure.
- Automatic changes are limited to posting windows, format weights, topic-fatigue suppression, bounded retry/backoff values, and preferences among approved templates.
- Replay, fixture, mock, synthetic, unverified, and unauthorized evidence never qualifies for learning or promotion.
- Every cognitive arm reserves autonomy budget before invocation; paid-arm failure pauses that arm while free maintenance continues.
- Effect-bearing work continues through immutable commands, atomic claims, receipts, and independent verification.
- Resident schedules remain disabled locally and are not deployed or evidenced by this plan.
- Existing unrelated untracked files under `.superpowers/`, `public/architecture/`, and `public/brand/` remain untouched.

---

### Task 1: Strict Resident-Autonomy Contracts and Eligibility Policy

**Files:**
- Create: `src/lib/residentAutonomy/contracts.ts`
- Create: `src/lib/residentAutonomy/policy.ts`
- Test: `tests/residentAutonomyContracts.test.ts`
- Test: `tests/residentAutonomyPolicy.test.ts`

**Interfaces:**
- Produces: strict Zod schemas and types for `AutonomyCycle`, `Observation`, `Reflection`, `Hypothesis`, `Experiment`, `ConfigurationRevision`, `Agenda`, `AgendaItem`, `AttentionRequest`; `eligibleEvolutionEvidence(record)`; `classifyAgendaAuthority(item)`; `validateAutoTuneCandidate(candidate, policy)`.
- Consumes: no storage or model dependencies.

- [ ] Write failing tests that reject unknown fields, invalid cycle transitions, non-scoped records, replay/fixture/mock evidence, protected tuning categories, multi-variable experiments, missing rollback pointers, and out-of-bounds retry/posting/weight candidates.
- [ ] Run `npx vitest run tests/residentAutonomyContracts.test.ts tests/residentAutonomyPolicy.test.ts` and confirm failure because the modules do not exist.
- [ ] Implement strict schemas with literal cycle states/types, typed failure classes, authority classes, evidence provenance, UTC timestamps plus workspace timezone, immutable experiment variable definitions, and explicit protected categories.
- [ ] Implement pure deterministic eligibility and bounds functions; protected candidates return `propose`, never `auto_tune`.
- [ ] Re-run focused tests and commit `feat: add resident autonomy contracts`.

### Task 2: Cycle Identity, Lease, Transition, and Recovery State Machine

**Files:**
- Create: `src/lib/residentAutonomy/cycles.ts`
- Test: `tests/residentAutonomyCycles.test.ts`

**Interfaces:**
- Consumes: Task 1 cycle contracts.
- Produces: `cycleIdentity(scope, type, scheduledWindow)`, `claimCycle(existing, claim)`, `transitionCycle(cycle, transition)`, `recoverableMissedCycles(cycles, now, policy)`.

- [ ] Write failing tests for deterministic tenant-scoped identity, duplicate suppression, active lease denial, expired non-effect lease recovery, expired effect-bearing uncertainty, legal terminal transitions, one-time missed recovery, and stale Wakeup Call expiry.
- [ ] Run the focused suite and observe RED.
- [ ] Implement SHA-256 identities, explicit transition table, lease-token digest comparison, and recovery usefulness windows without provider calls.
- [ ] Run focused tests GREEN and commit `feat: add durable autonomy cycle state machine`.

### Task 3: Firestore Repositories and Transactional Commands

**Files:**
- Create: `src/lib/residentAutonomy/repository.ts`
- Modify: `src/lib/firestore.ts`
- Test: `tests/residentAutonomyRepository.test.ts`
- Test: `tests/residentAutonomyFirestore.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 contracts/state transitions and existing `currentTenant()` collection paths.
- Produces: create/claim/finalize/list cycle, append/list observation, reflection/hypothesis/experiment/config revision, create/claim/finalize agenda item, and attention-request repository functions.

- [ ] Write failing in-memory command tests and emulator-gated transaction tests for tenant paths, create-only immutable records, atomic lease claims, deduplication, agenda-arm isolation, and compare-and-set configuration revision promotion/rollback.
- [ ] Run focused tests and observe RED or emulator skips only where the repository’s existing integration convention requires it.
- [ ] Implement repositories using workspace/brand-scoped collections and Firestore transactions; never expose unrestricted collection handles.
- [ ] Run tests GREEN and commit `feat: persist resident autonomy state`.

### Task 4: Explicit Hourly Heartbeat Controller

**Files:**
- Create: `agent/harmonia_agent/heartbeat.py`
- Modify: `agent/harmonia_agent/durable_tick.py`
- Modify: `agent/harmonia_agent/main.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Test: `agent/tests/test_heartbeat.py`
- Test: `agent/tests/test_durable_tick.py`

**Interfaces:**
- Consumes: cycle claim/finalize endpoints, existing stage-outbox, retention, budget, provider-health, and precise scheduler dispatcher.
- Produces: `run_heartbeat(scope, scheduled_at, dependencies) -> CycleOutcome`; private authenticated heartbeat route; isolated arm results.

- [ ] Write failing pytest cases proving cheap deterministic arms run without model calls, duplicate identities suppress work, one failed arm does not block others, paid arms pause on budget exhaustion, stuck/expired work creates attention, and precise scheduled effects are not delayed or duplicated.
- [ ] Run the focused pytest files and observe RED.
- [ ] Implement the controller and adapt `run_durable_tick` as a compatibility wrapper around explicit Heartbeat orchestration.
- [ ] Run tests GREEN and commit `feat: orchestrate hourly heartbeat`.

### Task 5: Event-Driven Micro-reflection

**Files:**
- Create: `src/lib/residentAutonomy/microReflection.ts`
- Create: `src/app/api/internal/autonomy/observe/route.ts`
- Modify: job completion/failure, verification, proposal-decision, and engagement persistence boundaries in `src/lib/firestore.ts`
- Test: `tests/microReflection.test.ts`
- Test: `tests/microReflectionTriggers.test.ts`

**Interfaces:**
- Produces: `deriveEligibleObservations(event)`, deterministic observation IDs, internal authenticated ingestion endpoint.

- [ ] Write failing tests for completion, failure, verification, approval/rejection, and mature engagement observations; reject raw prompts, logs, source text, replay, fixtures, and unverified claims; deduplicate by source record and observation type.
- [ ] Observe RED, implement allowlisted fact projectors and transactionally append observations at existing durable boundaries.
- [ ] Run GREEN and commit `feat: record governed micro reflections`.

### Task 6: Nightly Dream Cycle with Bounded ADK Synthesis

**Files:**
- Create: `agent/harmonia_agent/dream_cycle.py`
- Create: `agent/harmonia_agent/autonomy_models.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Test: `agent/tests/test_dream_cycle.py`
- Test: `agent/tests/test_autonomy_models.py`

**Interfaces:**
- Consumes: sanitized eligible observations, autonomy budget reservation, configured Gemini role policy.
- Produces: typed reflection/hypothesis/experiment proposals with safe summaries and stable evidence references.

- [ ] Write failing tests that skip with no new evidence, batch eligible observations, reserve before model invocation, reject malformed/unsupported outputs, persist no private reasoning, and isolate transient/permanent/budget failures.
- [ ] Observe RED, implement strict Pydantic contracts and a bounded ADK specialist that receives no tools or write authority; deterministic server code persists validated outputs.
- [ ] Run GREEN and commit `feat: add governed nightly dream cycle`.

### Task 7: Morning Wakeup Call and Durable Agenda Dispatcher

**Files:**
- Create: `src/lib/residentAutonomy/agenda.ts`
- Create: `agent/harmonia_agent/wakeup_call.py`
- Create: `agent/harmonia_agent/agenda_dispatcher.py`
- Test: `tests/residentAutonomyAgenda.test.ts`
- Test: `agent/tests/test_wakeup_call.py`
- Test: `agent/tests/test_agenda_dispatcher.py`

**Interfaces:**
- Consumes: persisted Dream results, operational state summaries, Task 1 authority policy, Task 3 agenda commands.
- Produces: deterministic durable agenda IDs/items, briefing, idempotent independent dispatch.

- [ ] Write failing tests for the four authority classes, evidence/cost/deadline requirements, reuse of nightly synthesis, no duplicate agenda, independent item failure, and protected changes becoming proposals.
- [ ] Observe RED, implement Wakeup Call assembly and dispatcher without publishing/configuration credentials.
- [ ] Run GREEN and commit `feat: create durable wakeup agendas`.

### Task 8: Experiment Evaluation, Conservative Promotion, and Rollback

**Files:**
- Create: `src/lib/residentAutonomy/experiments.ts`
- Create: `src/lib/residentAutonomy/configuration.ts`
- Create: `src/app/api/internal/autonomy/experiments/evaluate/route.ts`
- Test: `tests/residentAutonomyExperiments.test.ts`
- Test: `tests/residentAutonomyConfiguration.test.ts`

**Interfaces:**
- Consumes: verified eligible evidence, policy bounds, budget status, immutable experiments.
- Produces: `evaluateExperiment`, `promoteCandidate`, `rollbackRevision`, versioned CAS configuration revisions.

- [ ] Write failing tests for sample thresholds, unresolved contradiction, weak before/after confidence, holdout evaluation, expiry/rejection, reversible promotion, concurrent revision conflict, later guardrail rollback, and protected-category denial.
- [ ] Observe RED, implement pure evaluation plus transactional promotion/rollback through repository interfaces.
- [ ] Run GREEN and commit `feat: govern reversible autonomy tuning`.

### Task 9: Scheduler Configuration and Missed-wake Recovery

**Files:**
- Modify: `infra/setup.sh`
- Modify: `infra/deploy.sh`
- Modify: `.env.example`
- Test: `tests/residentAutonomyInfra.test.ts`

**Interfaces:**
- Consumes: Heartbeat/Dream/Wakeup authenticated routes.
- Produces: disabled-by-default schedule creation commands with OIDC service account, workspace timezone handling, and scale-to-zero Cloud Run configuration.

- [ ] Write failing source-contract tests for hourly Heartbeat, nightly Dream, morning Wakeup, OIDC audience/service account, Scheduler API, no public invoker, and an explicit `HARMONIA_ENABLE_RESIDENT_AUTONOMY=0` default.
- [ ] Observe RED and implement idempotent schedule provisioning guarded by explicit enablement; preserve precise scheduled-effect wakes.
- [ ] Run GREEN and commit `infra: configure governed autonomy schedules`.

### Task 10: Autonomous Operations API, Dashboard, and Replay Events

**Files:**
- Create: `src/app/api/autonomy/route.ts`
- Create: `src/components/AutonomousOperationsView.tsx`
- Modify: `src/app/dashboard/monitoring/page.tsx` to expose the Autonomy tab
- Modify: `src/components/NavRail.tsx`
- Modify: `src/lib/recordReplay/schema.ts`
- Modify: `src/lib/recordReplay/sanitize.ts`
- Test: `tests/autonomousOperationsView.test.ts`
- Test: `tests/residentAutonomyReplay.test.ts`

**Interfaces:**
- Consumes: tenant-scoped repository summaries and inert replay events.
- Produces: judge-visible cycle/agenda/experiment/revision/attention/cost view with provenance labels.

- [ ] Write failing tests for last/next Heartbeat, Dream, Wakeup briefing, agendas, observations, experiments, revisions, rollback, costs, paused arms, attention, workspace isolation, safe summaries, and permanent historical replay labeling.
- [ ] Observe RED, implement read-only API and dashboard with loading/empty/failure states and no chain-of-thought fields.
- [ ] Run GREEN and commit `feat: show resident autonomy operations`.

### Task 11: Truthful Documentation and Local Completion Gate

**Files:**
- Create: `docs/resident-autonomy.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/deployment.mdx`
- Modify: `docs/operational-model.mdx`
- Modify: `README.md`
- Test: `tests/residentAutonomyDocs.test.ts`

**Interfaces:**
- Consumes: Tasks 1–10 actual behavior.
- Produces: implementation/configuration/deployment/evidence matrix and operator runbook.

- [ ] Write failing documentation tests for authority boundaries, schedules disabled by default, cycle model, recovery, evidence exclusions, cost controls, acceptance gaps, and explicit `not deployed`/`not evidenced` status.
- [ ] Observe RED, write Diataxis-separated explanation and configuration/runbook material without production claims.
- [ ] Run focused docs tests, then `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:agent`, infrastructure tests, and `git diff --check`.
- [ ] Confirm no cloud schedule, authenticated run, paid call, or evidence artifact was created; commit `docs: explain governed resident autonomy`.
