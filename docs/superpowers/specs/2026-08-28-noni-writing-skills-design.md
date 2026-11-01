# Noni Writing Skills Design

## Goal

Give Noni one real Google ADK filesystem skill, `noni-writing-skills`, that
encodes ten complete areas of professional content-writing judgment while
preserving Harmonia's closed-world evidence and authority boundaries.

The methods are an original operational synthesis of practical lessons
supplied by Harmonia's creator from two years of content-marketing work for
brands. The skill does not identify or imitate another company's voice.

## Runtime architecture

Noni moves from the custom Vertex Gemma endpoint to Gemini 3.5 Flash because
the existing Gemma adapter declares `output_schema_and_tools=False` and cannot
perform ADK skill calls. No compatibility adapter or dual provider path remains.

The Noni agent receives a dedicated `SkillToolset` containing exactly one
filesystem skill and no additional tools. Noni must load `noni-writing-skills`
before drafting and may load only its declared Markdown references. ADK
callbacks record the actual skill/resource trajectory in managed state.
Deterministic validation rejects missing or wrong skill loads, scripts,
unapproved resources, external tools, malformed sequences, and skill guidance
presented as factual evidence.

## Skill structure

`SKILL.md` contains the shared decision method and routes Noni to references:

1. `thought-leadership.md`
2. `hooks-and-introductions.md`
3. `structure-and-mece.md`
4. `case-studies.md`
5. `storytelling.md`
6. `bad-content-diagnosis.md`
7. `persuasion.md`
8. `outlining.md`
9. `titles-and-headlines.md`
10. `convincing-content.md`

`coverage.md` records the ten required topics and their reference paths so
automated tests fail if one disappears. References contain original, concise
instructions rather than copied articles.

## Boundaries

Writing guidance controls structure, emphasis, phrasing, and revision. It is
never evidence about a source, company, product, customer, market, trend, or
result. Noni still receives facts only through the exact Ryan brief, selected
Temi item, and supplied Nimi evidence. Noni cannot research, retrieve Memory
Bank facts, approve, schedule, publish, verify, create receipts, or mutate
workflow state.

The existing strict `CopywriterInput`, `ContentDraft`, claim ledger, revision
limit, deterministic validator, and Dara loop remain authoritative.

## Verification

Tests cover ADK skill validity, ten-topic coverage, exact Noni toolset,
skill/resource trajectory validation, prohibited tools/scripts, missing skill
loads, prompt boundaries, clean Gemini model policy, and existing Noni/Dara
grounding behavior. Completion requires complete Python and application test
suites, lint, TypeScript checking, production build, and diff review.
