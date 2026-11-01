# Harmonia A2UI Generative Art Direction Design

**Date:** 2026-08-24  
**Status:** Approved direction  
**Scope:** Visual composition, semantic color, and stateful motion for trusted Harmonia A2UI surfaces

## Summary

Harmonia's A2UI workspace already lets Maya select product-specific components and bind them to trusted persisted records. The remaining gap is visual authorship: different plans currently resolve into a largely uniform cream-and-purple stack of similarly shaped cards. The component graph is generative, but the rendered response does not yet feel visually composed for the work being performed.

This design adds a constrained generative art-direction grammar. Maya may select safe, semantic presentation tokens for each surface and component; the trusted hydrator validates them; and the native catalog maps them to Harmonia-owned color, layout, density, and motion treatments. Maya never emits CSS, arbitrary colors, executable code, animation values, or trusted operational content.

The target is a living creative studio: strategy, analysis, drafting, approval, and verification should have visibly different rhythms and silhouettes while remaining recognizably Harmonia.

## Reference Interpretation

The approved reference is valuable for its visual grammar, not as a screen to copy. Its strongest qualities are:

- saturated color carries meaning instead of acting as background decoration;
- black editorial fields create hierarchy and focus;
- acid green, vivid blue, coral, and violet identify distinct artifact and state families;
- large hero statements coexist with compact operational blocks;
- media, waveform, graph, and text artifacts use different silhouettes;
- active work feels alive through restrained state motion; and
- the composition reads as a creative workspace rather than a dashboard of repeated cards.

Harmonia will retain its own shell, typography, trust boundaries, and domain components while adopting this more expressive response language.

## Problem

The current workspace is structurally capable but visually same-shaped:

- most catalog components use the same white panel, thin border, and small shadow;
- purple is the default accent regardless of semantic role;
- plans can change component order and content but cannot express visual hierarchy;
- state changes mostly replace text rather than transform the surface;
- streaming operations appear without a coordinated reveal sequence; and
- interactive selections do not consistently create a linked visual response elsewhere in the surface.

Adding random gradients or animation would make the UI louder without making it more generative. The missing capability is a bounded vocabulary through which the presentation agent can direct emphasis, rhythm, and response behavior.

## Goals

- Make each generated surface visibly respond to its content, workflow phase, and operator intent.
- Use color semantically and consistently across the A2UI catalog.
- Give Maya meaningful art-direction choices without accepting arbitrary styling.
- Make real streaming, selection, revision, approval, and verification changes perceptible.
- Increase variation in scale, silhouette, and composition without weakening usability.
- Preserve authoritative hydration, strict schemas, replay determinism, accessibility, and reduced-motion support.
- Keep the stable navigation, conversation, composer, and approval boundary predictable.

## Non-goals

- Arbitrary model-generated CSS, class names, HTML, SVG, JavaScript, or animation timelines.
- A campaign-brand extraction system in this slice.
- Decorative continuous motion that implies work when no work is occurring.
- Replacing operational labels with color-only meaning.
- Making historical replay visually nondeterministic.
- Redesigning backend workflow stages or approval semantics.
- Copying the reference design literally.

## Considered Approaches

### Deterministic state theming

Each component could derive its color and motion solely from its persisted state. This is safe and simple, but it leaves composition fixed and gives Maya no visual authorship. It improves polish without materially advancing custom generative UI.

### Free-form model styling

Maya could emit colors, CSS values, class names, or animation instructions. This offers maximum variety but creates unsafe and inconsistent output, weak accessibility guarantees, visual drift, and difficult replay testing. It is rejected.

### Constrained generative art direction

The selected approach gives Maya a small enum-only grammar for semantic tone, layout role, density, and motion intent. The application owns every concrete style and transition. This creates meaningful variation while keeping rendering deterministic and reviewable.

## Art-Direction Grammar

Presentation metadata is optional. A plan that omits it receives safe component-specific defaults. Unknown values fail schema validation rather than falling through to arbitrary styling.

### Surface-level tokens

- `rhythm`: `editorial`, `operational`, `cinematic`, or `evidence`
- `composition`: `stack`, `split`, `mosaic`, or `rail`
- `energy`: `quiet`, `active`, or `resolved`

These tokens control grid behavior, spacing rhythm, relative emphasis, and coordinated reveal behavior. They do not change source data or action availability.

### Component-level tokens

- `tone`: `paper`, `ink`, `acid`, `blue`, `coral`, or `violet`
- `role`: `hero`, `feature`, `support`, `strip`, or `inline`
- `density`: `airy`, `balanced`, or `compact`
- `motion`: `none`, `reveal`, `pulse`, or `trace`

The catalog defines which values are valid for each component. For example, an `ApprovalReview` may use `paper`, `ink`, or `coral`, but it cannot use an acid success treatment when approval is unresolved. Hydration may override a model-selected token when it conflicts with trusted lifecycle state.

## Semantic Palette

Harmonia owns one consistent high-chroma palette inspired by the approved reference:

- `ink`: strategic focus, strong framing, active production blocks;
- `acid`: selected creative direction, successful resolution, confirmed choice;
- `blue`: media, audio, transcript, and analytical artifacts;
- `coral`: attention, unresolved policy, risk, rejection, or failure;
- `violet`: generated alternatives, creative branching, and model-authored framing; and
- `paper`: long-form reading, evidence, detailed review, and neutral context.

Every treatment must retain text contrast, borders or labels where needed, and non-color indicators for status. Concrete color values remain design tokens in CSS, never plan data.

## Catalog Treatment

The existing catalog remains the domain vocabulary, but its components gain distinct visual identities:

- `CampaignBrief` can become an ink hero with oversized direction text and compact source-backed constraints.
- `JobProgress` becomes an operational strip or rail with real stage movement, active pulses, and clear blocked states.
- `MomentExplorer` uses blue media fields, transcript traces, and acid selection markers.
- `DraftComparison` uses violet branching with an acid selected variant and visibly linked preview state.
- `PlatformPreview` behaves as a media artifact rather than another document card.
- `SourceEvidence` uses a quieter paper or compact evidence treatment with explicit provenance links.
- `ApprovalReview` uses ink for consequence framing and coral for unresolved risk, while preserving the global approval boundary.
- `VerificationReceipt` uses acid only when persisted verification is successful; unresolved and failed outcomes remain visibly distinct.
- shared loading, empty, unresolved, and failure components receive honest state-specific treatments and never imitate completed content.

Component anatomy may vary by role, but controls, status language, provenance, and approval consequences remain stable.

## Composition Behavior

The generated canvas will support real variable composition rather than a fixed vertical column:

- `hero` spans the available composition and establishes the response's primary idea;
- `feature` receives dominant grid area for the current task artifact;
- `support` forms secondary tiles around the feature;
- `strip` presents compact horizontal operational state; and
- `inline` remains suitable for conversation-linked summaries.

The renderer maps valid role combinations into bounded CSS grid templates. Maya cannot specify coordinates, dimensions, breakpoints, z-index, or overlap. Invalid or overcrowded combinations fall back to an accessible stack.

On narrow screens, every composition reduces to a deliberate ordered sequence based on role and source order. No content is hidden merely to preserve a desktop composition.

## Motion and Dynamic Response

Motion communicates actual state change:

- newly streamed components reveal according to their hierarchy and A2UI operation order;
- the active persisted workflow stage may pulse while the job is genuinely active;
- progress connections trace only when a stage transition occurs;
- selecting a moment or draft creates an immediate linked update in its preview and selection markers;
- a new surface revision briefly identifies changed artifacts without replaying the entire entrance sequence;
- approval resolution transitions the decision surface into its persisted outcome; and
- successful independent verification resolves into the acid treatment only after trusted receipt hydration.

Continuous decorative loops are excluded except for subtle active-state indicators. Motion must be interruptible, must not block controls, and must not delay trusted content from becoming readable.

`prefers-reduced-motion` replaces movement with immediate state changes, color or border transitions, and persistent labels. Replay and reconnection reconstruct the final state deterministically; they do not replay historical celebratory motion.

## Trust and Safety Boundary

The presentation agent remains responsible for relevance and composition, not truth.

1. Maya emits enum-only presentation tokens alongside component references.
2. The `SurfacePlan` schema validates token names, component compatibility, count limits, and allowed compositions.
3. The hydrator resolves authoritative records and derives lifecycle-sensitive presentation constraints.
4. The catalog maps the accepted tokens to fixed component variants and CSS custom properties.
5. The A2UI renderer receives no arbitrary style strings from the model.

Trusted state always wins. A failed action cannot be rendered as verified, an unresolved approval cannot use a success treatment, and a missing record becomes an explicit unresolved surface regardless of requested tone.

## Interaction Behavior

Local interactions should make the response feel connected rather than merely clickable:

- choosing a moment updates the selected marker, transcript focus, media seek position, and relevant preview;
- changing a draft variant updates comparison emphasis and platform preview together;
- expanding evidence preserves the current creative selection;
- requesting revision creates a new durable run and surface revision; and
- protected actions continue through existing authenticated endpoints and approval checks.

The visual layer cannot introduce a new side effect. It may only expose catalog actions already allowed for the hydrated component and current state.

## Implementation Boundary

The first implementation should extend the existing A2UI path rather than fork it:

- extend the plan schema with presentation metadata;
- validate and constrain presentation choices during hydration;
- add typed art-direction props to supported native components;
- introduce shared palette, grid, and motion primitives in the A2UI component styles;
- preserve existing trusted content props and action contracts;
- add revision-aware reveal and change markers at the surface host boundary; and
- update the presentation-agent prompt and examples so token selection follows semantic guidance.

No backend domain schema migration should be necessary. Presentation metadata belongs to the durable A2UI plan and operations for deterministic replay.

## Failure and Fallback Behavior

- Missing presentation metadata uses component defaults.
- Unknown tokens fail plan validation visibly.
- State-incompatible tokens are replaced with trusted variants and recorded in diagnostics.
- Invalid grid combinations collapse to a stable stack.
- Interrupted streaming leaves the latest structurally valid surface visible with an interrupted state.
- Motion initialization failure never blocks content or actions.
- Reduced-motion and low-capability environments receive the same information and controls without animation.

## Testing Strategy

### Contract tests

- accept every supported token and reject arbitrary style values;
- enforce component-specific token compatibility;
- prove lifecycle state overrides misleading presentation choices; and
- verify old plans without presentation metadata remain valid.

### Hydration and replay tests

- prove presentation metadata cannot replace trusted content;
- ensure persisted A2UI operations replay to the same final variants and composition;
- confirm stale or missing references retain honest unresolved treatments; and
- verify changed-artifact markers are based on revision differences rather than model claims.

### Component tests

- verify semantic variants, role-based anatomy, linked selections, and protected action behavior;
- verify keyboard focus and readable status without color;
- verify reduced-motion behavior; and
- verify narrow-screen fallback order.

### Browser and visual verification

- capture representative strategy, active job, moment selection, draft comparison, approval, and verification surfaces at desktop and mobile widths;
- verify variable silhouette and hierarchy rather than a repeated card stack;
- verify real stage and selection transitions;
- inspect high-contrast and reduced-motion modes; and
- compare against the approved reference qualities without requiring pixel imitation.

## Acceptance Criteria

The slice is complete when:

- two valid plans using the same catalog can produce materially different trusted compositions;
- at least five semantic tones appear in appropriate real states across the representative flow;
- strategy, active work, media analysis, draft selection, approval, and verification are visually distinguishable before reading their body copy;
- a real selection updates linked artifacts within the surface;
- a real streamed or persisted stage transition has restrained state motion;
- arbitrary CSS or color input is rejected;
- misleading success styling cannot override persisted state;
- desktop and mobile surfaces remain accessible and usable with reduced motion; and
- existing A2UI hydration, replay, approval, and verification tests continue to pass.

## Consequences

The catalog will require more deliberate variant design and visual regression coverage. Presentation-agent evaluation also expands from component relevance to semantic art-direction choices. In return, Harmonia gains the missing product quality: the agent does not merely decide which data cards to show; it composes a safe, expressive working response whose visual language reflects the creative and operational task at hand.
