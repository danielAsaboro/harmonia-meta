# Dara Editor End-to-End Refinement

## Scope

Dara reviews one exact Noni draft against one immutable `CopywriterInput`. Dara may accept the draft or return bounded correction instructions. Dara never rewrites copy, invents facts, approves an effect, schedules, publishes, verifies, or mutates workflow state. Deterministic application code owns review identity, lineage, timestamps, revision limits, persistence, and advancement.

## Audit findings

The current boundary is strong on tool denial, evidence-ID allow-listing, and revision count, but weak on review completeness. The model currently authors workflow metadata, an empty issue list stands in for a complete review, issue paths are free-form, and a final acceptance does not explicitly attest that every prior issue was resolved. Public evals cover malformed lineage and invented references but not false acceptance, missing rubric dimensions, or resolution completeness. Some current documentation still names a removed Flo wrapper.

## Recommended architecture

Dara's ADK output becomes `EditorialAssessment`, an agentic judgment with:

- exactly one check for each required dimension: `grounding`, `brief_alignment`, `brand_voice`, `platform_constraints`, `cta`, `safety`, and `clarity`;
- each check containing `status` (`pass` or `fail`), a concise rationale, and supplied evidence/constraint references;
- a verdict of `accepted` or `revise`;
- bounded structured issues with a closed field path, severity, instruction, and supplied provenance;
- `resolvedIssueIds`, empty on an original review and exactly equal to the prior issue set when a revision is accepted.

Deterministic code converts a validated assessment into `EditorialReview`, assigning a stable review ID from production lineage and pass number, copying exact lineage and draft revision, and supplying the current UTC timestamp. The persisted review retains the assessment checks so operators can audit why Dara accepted or rejected the draft.

## Validation

The validator fails closed unless:

- all seven dimensions appear exactly once;
- accepted means every check passes and issues are empty;
- revise means at least one check fails, every failed dimension has an issue, every issue category has a failed check, and no passing dimension has an issue;
- all evidence and constraint references come from the exact input;
- grounding rationales or issues that discuss supplied claims cite supplied evidence;
- brand/safety rationales or issues cite applicable constraints when constraints exist;
- issue paths belong to the closed draft field set and match their category;
- instructions describe corrections without replacement post copy, alternatives, authority claims, schedules, receipts, or effect payloads;
- original assessments resolve no issue IDs;
- revision acceptance resolves exactly all prior issue IDs; revision rejection may resolve a subset but cannot invent IDs;
- Dara cannot accept a draft that fails the deterministic Noni validator.

The ASCII-only safety boundary remains explicit until every semantic guard is Unicode-aware. This deliberately rejects internationalized assessment text rather than allowing Unicode authority or audience bypasses.

## Runtime and persistence

The worker invokes Dara with `EditorialReviewInput`. ADK returns only `EditorialAssessment`. The deterministic wrapper validates it, builds `EditorialReview`, and continues the existing one-revision maximum. Firestore persists the complete original/revision drafts and rubric-bearing reviews under the canonical production-trace digest. UI surfaces show every rubric check, failed issue, resolution status, and deterministic review timestamp.

## Evaluation and verification

Tests cover complete acceptance, detected grounding/brief/voice/platform/CTA/safety/clarity defects, missing or duplicate dimensions, false acceptance, invented references, invalid paths, replacement copy, authority overreach, original/revision resolution lineage, ignored issues, and attempted third pass. Python and TypeScript schemas must remain exact peers. Completion requires the full Python suite, full Vitest suite, ESLint, `tsc --noEmit`, production build, `git diff --check`, critical diff inspection, and a feature-branch commit before local fast-forward merge.

No paid calls, deployment, publication, authenticated evidence capture, backward compatibility, aliases, dual reads, or migration adapters are in scope.
