# Effect claim and recovery design

## Problem

Before this change, Harmonia derived stable idempotency keys and suppressed duplicate receipt writes, but the agent checked existing receipts before performing an external effect. Two concurrent Pub/Sub deliveries could both observe no receipt and both execute. Receipt deduplication after the calls could not prove duplicate-effect prevention.

## Safety model

Every side-effecting action must acquire a tenant-scoped Firestore claim keyed by the existing SHA-256 idempotency key before calling a provider or writing an artifact. The transaction has four outcomes:

- `execute`: this operation created the claim and exclusively owns the first attempt;
- `in_progress`: another operation owns a live claim; the stage remains retryable and performs no effect;
- `already_applied`: an immutable receipt already finalized the claim; the caller performs no effect and receives the original receipt identity;
- `uncertain`: a prior claim expired without a receipt; Harmonia performs no automatic retry because the provider may have applied the effect before the worker crashed.

Claims never grant approval. The claim endpoint verifies that the action is approved or does not require approval, is still executable, and matches the submitted action type and idempotency key.

## Persistence and finalization

Claims live under the job so tenant isolation follows the existing Firestore boundary. A claim stores job/action identity, action type, idempotency key, owner operation and trace IDs, state, attempt count, claimed/expiry timestamps, and optional receipt/finalization identifiers. Receipt finalization runs in a Firestore transaction that validates claim ownership, creates the immutable receipt, marks the action executed or failed, and marks the claim `applied` or `failed` atomically.

Only the authenticated operator replay-proof route writes a durable replay observation referencing the original receipt. Ordinary worker redelivery may receive `already_applied`, but it does not manufacture operator replay evidence. An `uncertain` response becomes a permanent visible failure requiring operator reconciliation; it never becomes simulated success and never automatically repeats a paid or public action.

## Agent behavior

`run_publish` claims each action before any provider call, content-pack write, render, or media generation. Only `execute` enters the existing effect adapter. `already_applied` skips the adapter and reports the observed original receipt. `in_progress` raises a retryable dependency failure. `uncertain` raises a permanent policy failure with a safe public message.

The first hackathon slice uses `export_content_pack`, whose deterministic Firestore artifact and digest are independently verified. The same claim boundary protects X and paid media, while expired non-finalized claims deliberately require reconciliation instead of unsafe automatic replay.

## Replay surface and evidence

The normal authenticated operator UI exposes a replay-proof action only for an already executed, approved action with a finalized claim. That action calls the same claim transaction with a fresh operation/trace ID. It cannot execute an effect; it must return `already_applied` and persist a replay observation. The private collector remains read-only and only captures the resulting records.

## Tests and acceptance

- Concurrent claim attempts produce exactly one `execute` owner.
- Live claims return `in_progress`; expired unfinalized claims return `uncertain`.
- Finalization rejects the wrong owner and atomically links one receipt.
- A later claim returns `already_applied` with the original receipt; only explicit operator replay records replay evidence.
- Agent tests prove no provider/effect adapter runs for non-`execute` outcomes.
- Operator replay cannot approve, reset, or execute an action.
- Existing TypeScript, Python, lint, build, and evidence-collector gates remain green.
