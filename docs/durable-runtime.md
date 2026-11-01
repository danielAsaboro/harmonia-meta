# Durable agent runtime

> **Archived implementation note (superseded 2026-08-28).** This detailed build record is preserved for engineering history and is not part of the maintained navigation. Current normative behavior lives in [Failure recovery](./failure-recovery.mdx), [State ownership](./state-ownership.mdx), and [Context and memory continuity](./optimization/context-memory-continuity.mdx).

Harmonia treats a long-running agent as a durable state machine, not as an indefinitely growing chat transcript. Firestore is the system of record; Pub/Sub and external webhooks are at-least-once wake signals; Cloud Run workers are disposable compute. A worker may stop after any durable boundary and another worker may resume from the persisted operation epoch.

The public documentation presents the full context- and memory-rot strategy under
[Context and memory continuity](/optimization/context-memory-continuity).

## The execution contract

Every event is normalized into a versioned envelope with a stable source event ID and payload digest. Inbox acceptance and operation creation are atomic. A worker claims a bounded lease and receives a monotonically increasing operation epoch. Every subsequent write carries that operation ID and epoch, so a paused or restarted worker cannot overwrite newer state.

The runtime writes intent before effect and records the provider observation before a terminal receipt. External effects move through `prepared -> dispatched -> observed -> applied|failed`. An ordinary exception after dispatch becomes `unknown`: unknown is not failed, and it is never automatically retried. Only a typed proof that the provider was not entered returns an effect to `prepared`.

## Context without context rot

The model never receives the unbounded event log as its only memory. Harmonia compiles a deterministic, bounded context projection from current durable state. Authority, policy version, goal digest, approval IDs, unresolved effects, and current revision digests are pinned first. Memory is labeled non-authoritative and external text is labeled untrusted.

Large tool results use prune + spill: the prompt retains a bounded head/tail preview and an opaque artifact reference, while the complete digest-verified value lives in durable storage. Re-reading is range-bounded. A projection stores its compiler version, canonical manifest digest, rendered digest, artifact ID, and character count. Changing the operation epoch, policy, current revision, evidence, or compiler version changes its identity.

## Recovery and external events

The model-free heartbeat scans bounded pages under deadline, retry, and cost limits. Safe expired work becomes replayable; reconcile/never work becomes unknown or operator-required; abandoned inbox and outbox claims are requeued. Observed effects, unverified receipts, and broken artifacts emit idempotent `recovery_work` records. Recovery identities include the persisted attempt generation: repeated scans of one crash deduplicate, while a later crash of the same operation gets fresh recovery authority. Recovery never calls an unknown external effect.

Harmonia can be awakened by Pub/Sub, Cloud Scheduler, Telegram's official webhook, and approved platform webhooks. These sources enter through the same inbox, operation, fencing, approval, and audit path as dashboard requests.

## Operator resolution

An unknown effect has four explicit operator resolution choices:

- Confirm applied: write an operator-confirmed receipt bound to ready audit evidence.
- Confirm not applied: return the command to `prepared` and the operation to `waiting`, permitting a new fenced attempt.
- Compensate: cancel the original operation and create separate pending compensation work; compensation is never silently executed.
- Cancel: terminate the command and operation without claiming the effect succeeded.

Every choice requires a human operator principal, a detailed reason, the current epoch, and at least one ready artifact whose digest is checked inside the transaction. The immutable resolution records the actor, authentication ID, command payload digest, operation goal digest, evidence digests, and decision digest.

## Local verification

Run the Firestore emulator, then execute:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8787
export GOOGLE_CLOUD_PROJECT=harmonia-durable-test
npm test
npm run test:agent
npm run verify:durable-runtime
npm run lint
npm run build
```

The deterministic benchmark covers failure boundaries around inbox acceptance, operation claim, projection persistence, model result, effect preparation, provider dispatch, provider response, receipt commit, and verification. Run it twice and compare its JSON byte-for-byte.

## Honest limits

The emulator and deterministic crash benchmark prove transition rules, fencing, duplicate suppression, artifact integrity checks, bounded projections, and recovery classification. This does not prove multi-week uptime, real provider availability, cloud IAM correctness, or successful external publication. Those claims require an authenticated deployed soak run and provider readback. The monitoring view keeps absent or ambiguous evidence visible rather than converting it into success.
