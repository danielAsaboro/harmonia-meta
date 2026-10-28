# Evidence, learning, confidence, and revision

## Load when

Ryan uses performance or Memory Bank context, evidence is incomplete, confidence
must be calibrated, or operator feedback requests strategy revision.

## Questions answered

- Which statements are supplied facts, analysis, verified outcomes, memory, or
  assumptions?
- How much should prior performance influence the next strategy?
- Is a memory fact still applicable to this audience and objective?
- What must change in revision two while evidence remains immutable?

## Method

1. Build a closed evidence catalog by kind: operator context, Nimi source,
   verified performance, and eligible memory.
2. Use source evidence for source claims, performance IDs for performance-led
   recommendations, memory IDs for memory-led recommendations, and operator IDs
   for company/campaign facts.
3. Treat a prior winner as a conditional learning, not a universal rule. Check
   audience, channel, format, objective, and recency fit using supplied context.
4. Treat memory as advisory. It cannot grant approval, capability, permission,
   policy exception, schedule, or effect authority.
5. Calibrate confidence: high requires direct, mutually consistent support and
   no material assumptions; medium permits bounded inference; low marks a useful
   hypothesis with explicit uncertainty.
6. For revision two, preserve immutable evidence and lineage. Address operator
   feedback explicitly, change only affected strategy decisions, and require
   fresh approval of the new digest.
7. Omit any claim whose support cannot be identified exactly.

## Required inputs

The full `StrategistInput`, including exact evidence IDs, Firestore provenance,
revision number, and operator feedback when present.

## Expected contract effect

Correct evidence references, bounded assumptions, calibrated confidence,
performance-informed choices, and an issue-focused revised `ContentStrategy`.

## Failure modes

Skill text as evidence, invented IDs, memory as authority, unverified metrics,
overfitting one winner, unexplained high confidence, changing immutable source
facts, or silently ignoring rejection feedback.

## Evidence and authority

Firestore provenance establishes eligibility, not truth beyond the stored fact
and never authorization. Strategy revision remains a proposal and requires a
new digest-bound human decision.

Public research is permitted only for an explicit typed `researchRequest`. It
runs through the isolated request-bound web search tool, retains its `search-*`
evidence IDs and Meta web search provenance, and cannot replace Nimi source
analysis, manufacture customer research, or authorize an action.
