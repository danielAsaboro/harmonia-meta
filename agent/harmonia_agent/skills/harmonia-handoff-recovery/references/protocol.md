# Handoff and recovery contract

Protocol version: `harmonia.handoff/v1`.

The runtime creates an immutable envelope containing the handoff ID, sender, receiver, task, operation ID, digest of the original typed input, expected output contract, and authority mode. It acknowledges the handoff only after receiver and schema preflight succeeds.

| State | Meaning | Next action |
|---|---|---|
| accepted | Runtime accepted the typed handoff | Specialist may work |
| completed | Output passed deterministic validation | Persist the stage result |
| repair_requested | Output failed a repairable contract check | Start a fresh targeted correction session, up to two total |
| repaired | Fresh output passed validation | Persist it and record every attempt |
| escalated | Both bounded corrections failed | Stop with a safe protocol failure |

The correction request contains only a stable error code, safe schema path, attempt number, and targeted bounded instruction. It never includes raw model output, private source text, credentials, or a validator exception message. Every correction uses a fresh session and operation ID but keeps the same sender, receiver, task, original typed input, input digest, and authority boundary as the original handoff.

Retries are never a permission mechanism. They cannot broaden tools, add evidence, change approved digests, or repeat an external effect. Any claimed, dispatched, unknown, or uncertain external effect must be reconciled before another attempt.
