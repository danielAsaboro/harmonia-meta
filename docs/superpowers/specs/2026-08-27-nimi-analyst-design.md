# Nimi Analyst Refinement Design

## Purpose

Nimi turns one bounded source package into a durable evidence analysis for Ryan. Nimi may describe observed source material and derive explicitly qualified content angles, but it does not define strategy, write post copy, approve work, schedule, publish, verify effects, or mutate workflow state.

## Current weaknesses

The current contract stores transcript and advisory context as prose, gives moments no transcript references or confidence, gives angles no evidence references, and validates only unknown frame IDs at runtime. Quote presence and timestamp bounds exist only in an evaluation helper. The understand stage truncates the model result before persistence and stores neither a canonical digest nor a complete provenance ledger. Memory Bank facts lose their IDs and Firestore provenance when merged into `prior_learnings`, so they cannot be audited and can be mistaken for authority.

## Input boundary

`AnalystInput` contains:

- immutable source identity, kind (`brief` or `media`), title, channel, and source digest;
- typed transcript segments with stable IDs and bounded start/end times;
- optional media evidence carrying the same digest plus bounded frame evidence;
- verified performance observations with IDs and Firestore evidence references;
- eligible Memory Bank facts with IDs and Firestore evidence references.

Application code assembles this input. Nimi has no tools. Memory and performance are advisory context, never authorization or proof of facts in the source.

## Output boundary

`SourceAnalysis` contains:

- source digest, concise summary, assumptions, and overall confidence;
- grounded moments with exact quote, time bounds, transcript segment references, optional visual observations, frame references, and per-moment confidence;
- grounded content angles with kind (`source`, `performance`, or `memory`), rationale, evidence references, assumptions, and confidence.

Every reference must resolve against the exact input. Source moments must cite transcript segments, exact quotes must occur in the cited segment text, and time bounds must fit those segments and the media duration when present. Visual observations require supplied frame IDs. Performance and memory angles must cite evidence of their declared kind. Source angles must cite moments or transcript segments. Unknown or cross-kind references fail closed.

Nimi may label an idea as an angle; it may not claim that an external trend exists without a supplied verified observation. It must explicitly lower confidence and record assumptions when evidence is incomplete.

## Deterministic workflow

After ADK returns a `SourceAnalysis`, deterministic code validates grounding and authority, computes a canonical SHA-256 digest, and posts the complete analysis plus digest to the internal boundary. Firestore persists the complete object and digest before advancing to Ryan. Ryan and Temi consume that exact persisted object; no truncation or prose serialization is allowed.

## Presentation and evaluation

The studio shows source digest, analysis digest, confidence, assumptions, per-moment transcript/frame provenance, and per-angle evidence. Evaluation fixtures cover grounded analysis, absent quotes, invalid time bounds, invented segment/frame/performance/memory references, ungrounded trend claims, memory as authorization, unsupported visual assertions, incomplete analysis, and strategy/copy/effect authority overreach.

## Safety boundary

The existing conservative ASCII-only semantic boundary remains until all authority and grounding checks are Unicode-aware. No compatibility aliases, dual reads, or migration adapters are introduced.
