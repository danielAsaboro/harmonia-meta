# Noni Copywriter End-to-End Design

## Purpose

Noni converts exactly one persisted Temi editorial item, its matching approved Ryan brief, and only its referenced Nimi evidence into one platform-native content draft. Noni owns copy creation and bounded revision, but never strategy, planning, approval, scheduling, publishing, effects, receipts, verification, credentials, or workflow mutation.

The production graph remains:

```text
persisted selected Temi item
  → Noni original draft
  → Dara structured review
  ↘ accepted
  ↖ one bounded Noni revision
  → deterministic final-content persistence
  → human effect approval
```

## Current Weaknesses

The current `Draft` contract contains only an ID, X platform, optional moment/angle ID, and text. It does not bind output to the plan, selected item, Ryan brief, objective, funnel stage, CTA, format, constraints, or provenance lineage. Grounding checks only whether an optional reference ID exists; it cannot reject a factual claim unsupported by that evidence. Noni's broad inline prompt lacks a writing method, claim discipline, explicit uncertainty behavior, or structured revision protocol. Dara returns another undifferentiated `DraftSet`, so acceptance, revision feedback, and addressed issues are implicit. Current evaluations cover unknown IDs and retained draft IDs, but not unsupported claims, brief deviation, CTA failure, authority overreach, incomplete copy, or bounded revision quality.

## Input Boundary

Deterministic stage code constructs one strict `CopywriterInput` from Firestore truth. It includes:

- `planId`, `planDigest`, `strategyDigest`, `editorialItemId`, and `briefId`;
- the exact selected `EditorialPlanItem`;
- the exact immutable approved Ryan `ContentBrief`;
- only Nimi moments and angles referenced by that item and brief;
- bounded company/product/brand-voice context and applicable constraints;
- the supported platform and format;
- either an `original` pass or a `revision` pass;
- for a revision, the immutable prior draft and Dara's structured revision instructions.

The input rejects mismatched lineage, brief/item divergence, missing or extra evidence, unsupported platform/format, unrecognized revision targets, and revision context on an original pass. Memory Bank content is not supplied directly and cannot become drafting or effect authority.

## Output Boundary

Noni returns exactly one strict `ContentDraft`, not a collection. It contains:

- immutable plan, editorial-item, and brief lineage;
- a stable draft ID and explicit revision number;
- supported platform and format;
- final candidate text for Dara review;
- CTA treatment and intended conversion alignment;
- all evidence references used by the draft;
- structured factual claims, each mapped to one or more supplied evidence IDs;
- assumptions limited to non-factual creative choices;
- confidence;
- applied constraint IDs or exact constraint text references;
- for revisions, the prior draft ID and addressed Dara issue IDs.

The contract forbids extra fields, effect payloads, receipts, approval decisions, external schedule mutations, publication claims, fabricated performance or trend data, and multiple alternative posts. X text remains at most 280 characters. A factual claim must cite supplied evidence; creative phrasing may be uncited only when it introduces no source assertion.

## Writing Method and Prompt

Noni becomes a focused, tool-free Google ADK agent with instructions in `noni_prompt.py`. The prompt requires this method:

1. Lock to the selected item, exact brief, platform, format, audience, objective, funnel intent, and CTA.
2. Build a claim ledger from supplied Nimi evidence; do not infer facts beyond it.
3. Choose one platform-native hook and structure consistent with brand voice and constraints.
4. Write one concise candidate, preserving factual qualifications and avoiding invented specificity.
5. Map every factual claim to evidence IDs and report assumptions/confidence.
6. On revision, change only what Dara requested, preserve lineage, and enumerate addressed issue IDs.

Noni may use persuasive language, but cannot manufacture testimonials, metrics, customer research, trends, product capabilities, urgency, endorsements, or outcomes.

## Grounding and Deterministic Validation

Application validation uses the exact supplied ID sets and normalized source text. It rejects:

- unknown, missing, or unused required evidence references;
- claims whose cited evidence does not textually support their substantive terms;
- factual draft statements absent from the structured claim ledger;
- divergence from the selected brief's objective, audience, funnel intent, conversion, CTA, platform, or format;
- missing applicable constraints or prohibited/excluded language;
- invented metrics, performance results, trends, testimonials, or product capabilities;
- final-copy alternatives, approval decisions, publishing/scheduling statements, effect commands, receipts, URLs not supplied as context, or credentials;
- invalid revision lineage, unaddressed required Dara issues, and confidence outside the strict enum.

Textual support validation remains deliberately conservative and fail-closed. When evidence is insufficient, Noni must omit the claim or express a clearly labeled non-factual creative assumption; it may not compensate with Memory Bank or general model knowledge.

## Dara Loop Contract

Dara receives the exact `ContentDraft` plus the same bounded production authority. Dara returns a structured `EditorialReview`:

- `accepted` or `revise`;
- immutable draft and lineage IDs;
- typed issues covering grounding, brief alignment, brand voice, platform constraints, CTA, safety, or clarity;
- each revision issue has a stable ID, severity, field/path, instruction, and relevant evidence/constraint references.

Deterministic code ends immediately on acceptance. One revision is allowed; Noni receives only the rejected draft and Dara issue list. Dara reviews revision 2 once. If it still requires revision, the production job fails closed for operator attention rather than starting a third automatic pass. Dara cannot create replacement copy, approve effects, or publish.

## Persistence and Handoff

Firestore persists the original draft, every review, the one optional revision, validation results, immutable lineage, and the final accepted candidate. Draft completion and editorial-item lifecycle changes are atomic and idempotent. The dashboard renders original versus revised text, claim provenance, assumptions, confidence, constraints, Dara issues, and acceptance state from persisted truth.

Only the accepted exact content becomes input to deterministic effect-proposal construction. Human approval remains bound to the exact final content/effect digest. Noni and Dara never construct or authorize publish commands.

## Evaluation and Verification

Evaluation fixtures cover:

- strong grounded, brief-aligned platform-native copy;
- missing and invented evidence references;
- unsupported factual claims and invented metrics/trends/testimonials;
- objective, audience, funnel, format, and CTA deviation;
- brand exclusions, safety constraints, and platform limits;
- approval, scheduling, publishing, receipt, credential, and effect overreach;
- incomplete claim mappings or output fields;
- accepted original draft;
- successful one-pass revision with every required issue addressed;
- invalid revision lineage, ignored Dara issues, and attempted third pass;
- Memory Bank or general knowledge treated as factual or authorization context.

Verification uses focused Python and TypeScript tests during TDD, then complete agent and application suites, ESLint, `tsc --noEmit`, the production Next.js build, `git diff --check`, and independent final review. No paid model calls, deployments, publishing, authenticated evidence, mocks, placeholders, aliases, or migration adapters are introduced.
