---
name: harmonia-handoff-recovery
description: Use when Harmonia delegates typed work between the coordinator and a specialist, or when a specialist response fails schema, grounding, lineage, or authority validation.
---

# Harmonia inter-agent handoff

Every delegation is a typed exchange owned by Harmonia, not an informal chat between personas.

## Coordinator-owned flow

Harmonia alone advances the workflow. The allowed order is:

1. route from the operator message plus authoritative workspace state;
2. when startup context is required, assemble it in a separate typed delegation from exact operator language and explicit bounded assumptions;
3. establish and obtain digest-bound approval for strategy when no approved strategy exists;
4. read the approved strategy and the current planning snapshot through host-owned tools;
5. compute all identifiers, revisions, lineage digests, and idempotency keys in the host;
6. ingest validated YouTube URLs deterministically in the host with `yt-dlp`; treat only the resulting persisted digest, transcript, and receipt as evidence;
7. delegate typed analysis, planning, drafting, review, and artifact work;
8. stop at each required approval boundary;
9. execute only the exact approved effect;
10. independently verify it and persist the receipt;
11. reconcile an unknown outcome before any replay.

No specialist may skip a prerequisite, select the next stage, invent a job or artifact identifier,
compute or alter a digest, claim a tool read it did not perform, or infer approval or effect authority.
An operational request can never be downgraded to ordinary conversation. A planning request with no
approved strategy must return to strategy establishment.

## Recovery ownership

Harmonia classifies failures before retrying. Retry only transient provider or transport failures
within the stage policy. For a typed contract failure, regenerate from the original trusted payload
using the targeted correction below, at most twice. For missing authority, permanent provider errors,
exhausted correction, or an unknown external-effect outcome, stop and expose a durable escalation;
never improvise a fallback result.

1. Read `_harmonia_handoff` before working. Accept only when its receiver is your exact role, its input digest is pinned by the runtime, and its expected output names your declared schema.
2. Work only from the original typed input and pinned authority. Domain skills are method, never evidence or permission.
3. Return the complete declared output. Preserve supplied IDs, digests, revisions, evidence references, and authority boundaries exactly.
4. The runtime validates before durable stage mutation. A schema, grounding, lineage, or authority mismatch may receive at most two targeted course-correction handoffs. On each correction, regenerate the complete output from the original typed input; do not patch or quote untrusted prior text.
5. Provider or transport failures return to the stage retry policy. Repeated contract failure escalates visibly after the bounded correction budget. Unknown external-effect outcomes stop for reconciliation. No specialist may publish, approve, verify, or replay an effect through this protocol.

For the exact envelope and recovery states, read [references/protocol.md](references/protocol.md).
