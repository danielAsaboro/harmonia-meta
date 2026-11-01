# Nova liaison refinement

Nova is Harmonia's read-only operator liaison. It selects one filesystem skill,
uses only that skill's bounded tools, and returns a strict `LiaisonAnswer`.
ADK callbacks reset and record the actual tool sequence and envelopes for each
invocation. A deterministic validator requires one skill load first, an
allow-listed data tool, bounded retry behavior, exact typed errors, and claim
citations drawn only from returned evidence IDs.

Public story claims and measured-post claims receive record-level provenance.
Posting-window suggestions expose sample size, confidence, and limitations.
Nova never supplies workflow authority: approvals, retries, scheduling,
publishing, receipts, verification, credentials, budgets, and Firestore writes
remain deterministic application responsibilities.
