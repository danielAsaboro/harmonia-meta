# Visual and clip analysis

## Load when
The source includes frames or a moment needs visual, crop, or caption assessment.

## Questions and required inputs
What is visibly present, does it add meaning, and is the observed composition usable?
Requires supplied frame IDs and media bounds; absence of frames means no visual conclusion.

## Method
1. Describe only objects, text, actions, and composition visible in supplied frames.
2. Link every visual statement to exact frame IDs.
3. Test whether the visual adds meaning beyond the transcript.
4. Assess crop suitability from composition and continuity, not from unseen footage.
5. Describe caption-safe space only when visible evidence supports it.

## Contract effect
Evidence-bound visual hooks and production observations, or no visual claim.

## Expected output
Optional visual fields on an otherwise grounded `Moment`; not a clip authorization or edit decision.

## Failure modes and authority
Do not infer identity, emotion, off-frame action, continuity, licensing, or production permission.
