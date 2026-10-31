# A2UI Generative Art Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Maya-composed A2UI responses visually expressive through safe semantic color, variable composition, and motion tied to real state changes.

**Architecture:** Extend the TypeScript and Python `SurfacePlan` contracts with matching enum-only art-direction metadata. A trusted presentation-policy layer validates or overrides lifecycle-sensitive choices during hydration, and the native React catalog maps accepted tokens to fixed Harmonia variants, bounded grids, and reduced-motion-safe transitions. Existing entity references, durable A2UI operations, approval actions, and verification truth remain authoritative.

**Tech Stack:** Next.js, React, TypeScript, Zod, A2UI v0.9, CSS Modules, Vitest, Python 3.12, Pydantic v2, Google ADK, pytest

**Spec:** `docs/superpowers/specs/2026-08-24-a2ui-generative-art-direction-design.md`

## Global Constraints

- Maya may emit only enum-backed `rhythm`, `composition`, `energy`, `tone`, `role`, `density`, and `motion` values.
- Never accept arbitrary CSS, class names, HTML, SVG, JavaScript, colors, coordinates, dimensions, z-index, or animation timings from the model.
- Persisted lifecycle state always overrides misleading presentation choices.
- Existing plans without presentation metadata remain valid through safe defaults.
- Motion must describe real streaming, selection, revision, approval, or verification state; it must not simulate work.
- Every dynamic treatment must provide a `prefers-reduced-motion` equivalent.
- Existing authorization, approval, idempotency, hydration, replay, and verification contracts remain unchanged.
- No backend domain schema migration is permitted for this slice.

## File Map

- `src/lib/a2ui/presentationContracts.ts`: TypeScript plan grammar and exported presentation token types.
- `agent/harmonia_agent/a2ui_models.py`: Python/Pydantic mirror of the plan grammar used by the managed presenter.
- `src/lib/a2ui/presentationPolicy.ts`: trusted defaults, component compatibility, and lifecycle overrides.
- `src/lib/a2ui/hydrateSurfacePlan.ts`: attach trusted art direction to hydrated catalog records.
- `src/lib/a2ui/contracts.ts`: strict hydrated A2UI component schemas.
- `src/components/a2ui/HarmoniaCatalog.tsx`: runtime catalog validation and surface-level composition wrapper.
- `src/components/a2ui/HarmoniaWorkspaceElements.tsx`: typed visual variants and linked local interactions.
- `src/components/a2ui/HarmoniaWorkspaceElements.module.css`: palette, silhouettes, grid roles, transitions, breakpoints, and reduced motion.
- `agent/harmonia_agent/agents.py`: Maya art-direction guidance.
- `tests/a2uiPresentationContracts.test.ts`, `agent/tests/test_a2ui_models.py`: plan-contract coverage.
- `tests/a2uiHydration.test.ts`: truth-preserving policy and backward-compatibility coverage.
- `tests/a2uiContracts.test.ts`, `tests/a2uiElements.test.ts`: hydrated catalog and component behavior coverage.
- `tests/a2uiStreamIntegration.test.ts`, `tests/a2uiSurface.test.ts`: operation replay and end-to-end surface coverage.
- `agent/tests/test_a2ui_presenter.py`: managed presenter boundary coverage.

---

### Task 1: Add the cross-runtime art-direction contract

**Files:**
- Modify: `src/lib/a2ui/presentationContracts.ts`
- Modify: `agent/harmonia_agent/a2ui_models.py`
- Test: `tests/a2uiPresentationContracts.test.ts`
- Test: `agent/tests/test_a2ui_models.py`

**Interfaces:**
- Produces: `SurfaceArtDirection`, `NodeArtDirection`, and their inferred TypeScript types.
- Produces: Python `SurfaceArtDirection` and `NodeArtDirection` Pydantic models with the same defaults and enum values.
- Consumes: existing `SurfacePlan`, `PlannedSurface`, and `SurfacePlanNode` schemas.

- [ ] **Step 1: Write failing TypeScript contract tests**

Add cases that parse a fully directed plan and reject arbitrary styling:

```ts
it("accepts bounded surface and node art direction", () => {
  const result = surfacePlanSchema.parse({
    version: "harmonia.ui/v1",
    surfaces: [{
      slot: "canvas",
      revision: 1,
      rootId: "brief",
      artDirection: { rhythm: "editorial", composition: "mosaic", energy: "active" },
      nodes: [{
        id: "brief",
        component: "CampaignBrief",
        refs: { jobId: "job-1" },
        artDirection: { tone: "ink", role: "hero", density: "airy", motion: "reveal" },
        children: [],
      }],
    }],
  });
  expect(result.surfaces[0].artDirection.composition).toBe("mosaic");
  expect(result.surfaces[0].nodes[0].artDirection.tone).toBe("ink");
});

it("rejects arbitrary presentation values", () => {
  const result = surfacePlanSchema.safeParse({
    version: "harmonia.ui/v1",
    surfaces: [{
      slot: "canvas",
      revision: 1,
      rootId: "brief",
      artDirection: { rhythm: "editorial", composition: "absolute", energy: "active" },
      nodes: [{ id: "brief", component: "CampaignBrief", refs: {}, style: "color:red", children: [] }],
    }],
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Write matching failing Python contract tests**

```py
def test_surface_plan_accepts_bounded_art_direction() -> None:
    plan = SurfacePlan.model_validate({
        "version": "harmonia.ui/v1",
        "surfaces": [{
            "slot": "canvas", "revision": 1, "rootId": "brief",
            "artDirection": {"rhythm": "editorial", "composition": "mosaic", "energy": "active"},
            "nodes": [{
                "id": "brief", "component": "CampaignBrief", "refs": {"jobId": "job-1"},
                "artDirection": {"tone": "ink", "role": "hero", "density": "airy", "motion": "reveal"},
                "children": [],
            }],
        }],
    })
    assert plan.surfaces[0].artDirection.composition == "mosaic"

def test_surface_plan_rejects_arbitrary_style() -> None:
    with pytest.raises(ValidationError):
        SurfacePlan.model_validate({
            "version": "harmonia.ui/v1",
            "surfaces": [{"slot": "canvas", "revision": 1, "rootId": "brief", "nodes": [
                {"id": "brief", "component": "CampaignBrief", "refs": {}, "style": "color:red", "children": []}
            ]}],
        })
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `pnpm test -- tests/a2uiPresentationContracts.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_models.py -q`

Expected: FAIL because `artDirection` is rejected and the new Python models do not exist.

- [ ] **Step 4: Implement identical strict schemas in TypeScript and Python**

Add these TypeScript schemas and include them with defaults in nodes and surfaces:

```ts
export const surfaceArtDirectionSchema = z.object({
  rhythm: z.enum(["editorial", "operational", "cinematic", "evidence"]).default("editorial"),
  composition: z.enum(["stack", "split", "mosaic", "rail"]).default("stack"),
  energy: z.enum(["quiet", "active", "resolved"]).default("quiet"),
}).strict();

export const nodeArtDirectionSchema = z.object({
  tone: z.enum(["paper", "ink", "acid", "blue", "coral", "violet"]).default("paper"),
  role: z.enum(["hero", "feature", "support", "strip", "inline"]).default("support"),
  density: z.enum(["airy", "balanced", "compact"]).default("balanced"),
  motion: z.enum(["none", "reveal", "pulse", "trace"]).default("none"),
}).strict();
```

Mirror them with frozen `StrictModel` classes and `Literal` fields in Python. Add `artDirection: SurfaceArtDirection = Field(default_factory=SurfaceArtDirection)` to `PlannedSurface` and `artDirection: NodeArtDirection = Field(default_factory=NodeArtDirection)` to `SurfacePlanNode`.

- [ ] **Step 5: Run focused tests and verify success**

Run: `pnpm test -- tests/a2uiPresentationContracts.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_models.py -q`

Expected: both suites PASS, including legacy plans that omit `artDirection`.

- [ ] **Step 6: Commit the contract**

```bash
git add src/lib/a2ui/presentationContracts.ts agent/harmonia_agent/a2ui_models.py tests/a2uiPresentationContracts.test.ts agent/tests/test_a2ui_models.py
git commit -m "feat: add A2UI art direction contracts"
```

### Task 2: Enforce trusted presentation policy during hydration

**Files:**
- Create: `src/lib/a2ui/presentationPolicy.ts`
- Modify: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Test: `tests/a2uiHydration.test.ts`

**Interfaces:**
- Consumes: `SurfaceComponentName`, `NodeArtDirection`, `SurfaceArtDirection`, `JobFull`, and hydrated receipt state.
- Produces: `resolveNodeArtDirection(input): NodeArtDirection`.
- Produces: hydrated catalog properties `tone`, `role`, `density`, `motion`, `surfaceRhythm`, `surfaceComposition`, `surfaceEnergy`, and `revision`.

- [ ] **Step 1: Write failing hydration-policy tests**

Add tests for defaults, allowed choices, and truth overrides:

```ts
it("hydrates bounded art direction onto catalog components", () => {
  const operations = hydrateSurfacePlan({
    runId: "run-1", job, receipts: [],
    plan: plan("canvas", {
      id: "brief", component: "CampaignBrief", refs: { jobId: job.id },
      artDirection: { tone: "ink", role: "hero", density: "airy", motion: "reveal" },
      children: [],
    }, { rhythm: "editorial", composition: "mosaic", energy: "active" }),
  });
  const component = componentFrom(operations, "brief");
  expect(component).toMatchObject({ tone: "ink", role: "hero", surfaceComposition: "mosaic" });
});

it("prevents unresolved and failed state from using success styling", () => {
  const component = componentFrom(hydrateSurfacePlan({ runId: "run-1", job, receipts: [], plan: missingReceiptPlan }), "receipt");
  expect(component).toMatchObject({ component: "SurfaceUnresolved", tone: "coral", motion: "none" });
});
```

Extend the local `plan()` test helper to accept optional surface direction while retaining its old call signature.

- [ ] **Step 2: Run the hydration suite and verify failure**

Run: `pnpm test -- tests/a2uiHydration.test.ts`

Expected: FAIL because hydrated records do not include trusted presentation properties.

- [ ] **Step 3: Implement the policy module**

Use explicit component defaults and lifecycle overrides:

```ts
const DEFAULTS: Record<SurfaceComponentName, NodeArtDirection> = {
  CampaignBrief: { tone: "ink", role: "hero", density: "airy", motion: "reveal" },
  JobProgress: { tone: "ink", role: "strip", density: "compact", motion: "pulse" },
  MomentExplorer: { tone: "blue", role: "feature", density: "balanced", motion: "trace" },
  DraftComparison: { tone: "violet", role: "feature", density: "balanced", motion: "reveal" },
  PlatformPreview: { tone: "blue", role: "support", density: "balanced", motion: "reveal" },
  SourceEvidence: { tone: "paper", role: "support", density: "compact", motion: "none" },
  ApprovalReview: { tone: "coral", role: "feature", density: "balanced", motion: "reveal" },
  VerificationReceipt: { tone: "acid", role: "feature", density: "balanced", motion: "reveal" },
  SurfaceLoading: { tone: "ink", role: "strip", density: "compact", motion: "pulse" },
  SurfaceEmpty: { tone: "paper", role: "inline", density: "compact", motion: "none" },
  SurfaceUnresolved: { tone: "coral", role: "inline", density: "compact", motion: "none" },
  SurfaceFailure: { tone: "coral", role: "feature", density: "balanced", motion: "none" },
};

export function resolveNodeArtDirection({ component, requested, lifecycle }: ResolveArtDirectionInput): NodeArtDirection {
  const resolved = { ...DEFAULTS[component], ...requested };
  if (component === "SurfaceUnresolved" || component === "SurfaceFailure" || lifecycle.failed) {
    return { ...resolved, tone: "coral", motion: "none" };
  }
  if (component === "VerificationReceipt" && !lifecycle.verified) {
    return { ...resolved, tone: lifecycle.failed ? "coral" : "paper", motion: "none" };
  }
  if (component === "ApprovalReview" && lifecycle.approvalPending) {
    return { ...resolved, tone: lifecycle.highRisk ? "coral" : "ink" };
  }
  return resolved;
}
```

Define a compatibility map so unsupported component/token pairs resolve to the component default. Do not silently pass unknown values—the plan schemas reject those earlier.

- [ ] **Step 4: Attach trusted direction in the hydrator**

Change `framing()` to accept the current surface and lifecycle facts, and return only validated properties:

```ts
return {
  title: node.title || fallbackTitle,
  emphasis: node.emphasis,
  agentFraming: Boolean(node.title),
  children: node.children,
  ...resolveNodeArtDirection({ component: node.component, requested: node.artDirection, lifecycle }),
  surfaceRhythm: surface.artDirection.rhythm,
  surfaceComposition: surface.artDirection.composition,
  surfaceEnergy: surface.artDirection.energy,
  revision: surface.revision,
};
```

Pass `PlannedSurface` into `hydrateNode()` rather than reconstructing direction later. Preserve surface IDs and A2UI operation order.

- [ ] **Step 5: Run hydration and presentation contract suites**

Run: `pnpm test -- tests/a2uiHydration.test.ts tests/a2uiPresentationContracts.test.ts`

Expected: PASS with verified receipts eligible for acid and unresolved/failed records forced away from success styling.

- [ ] **Step 6: Commit the trusted policy**

```bash
git add src/lib/a2ui/presentationPolicy.ts src/lib/a2ui/hydrateSurfacePlan.ts tests/a2uiHydration.test.ts
git commit -m "feat: enforce trusted A2UI presentation policy"
```

### Task 3: Extend hydrated catalog validation

**Files:**
- Modify: `src/lib/a2ui/contracts.ts`
- Modify: `src/components/a2ui/HarmoniaCatalog.tsx`
- Test: `tests/a2uiContracts.test.ts`
- Test: `tests/a2uiSurface.test.ts`

**Interfaces:**
- Consumes: trusted art-direction properties produced by Task 2.
- Produces: strict runtime validation for all hydrated art-direction props.
- Produces: `SurfaceFrame` attributes used by CSS composition and revision transitions.

- [ ] **Step 1: Write failing strict catalog tests**

```ts
it("accepts only trusted hydrated presentation tokens", () => {
  expect(() => parseCatalogComponent({
    ...campaignBrief,
    tone: "ink", role: "hero", density: "airy", motion: "reveal",
    surfaceRhythm: "editorial", surfaceComposition: "mosaic", surfaceEnergy: "active", revision: 2,
  })).not.toThrow();
  expect(() => parseCatalogComponent({ ...campaignBrief, tone: "hotpink" })).toThrow();
});
```

Add a surface test that processes directed operations through the official `MessageProcessor` and reads the accepted properties from the resulting component model.

- [ ] **Step 2: Run focused suites and verify failure**

Run: `pnpm test -- tests/a2uiContracts.test.ts tests/a2uiSurface.test.ts`

Expected: FAIL because strict component schemas reject the new fields.

- [ ] **Step 3: Add one shared hydrated presentation schema**

In both `contracts.ts` and `HarmoniaCatalog.tsx`, add matching strict enum fields to the existing `generatedNode` shape:

```ts
const generatedNode = {
  emphasis: z.enum(["primary", "secondary", "compact"]),
  agentFraming: z.boolean(),
  children: z.array(z.string()).max(30),
  tone: z.enum(["paper", "ink", "acid", "blue", "coral", "violet"]),
  role: z.enum(["hero", "feature", "support", "strip", "inline"]),
  density: z.enum(["airy", "balanced", "compact"]),
  motion: z.enum(["none", "reveal", "pulse", "trace"]),
  surfaceRhythm: z.enum(["editorial", "operational", "cinematic", "evidence"]),
  surfaceComposition: z.enum(["stack", "split", "mosaic", "rail"]),
  surfaceEnergy: z.enum(["quiet", "active", "resolved"]),
  revision: z.number().int().positive(),
};
```

Keep `.strict()` on every component schema.

- [ ] **Step 4: Add a deterministic surface frame**

Wrap each rendered `A2uiSurface` in a host-owned element whose attributes come only from parsed component properties or safe defaults:

```tsx
<div className={styles.surfaceFrame} data-composition={composition} data-rhythm={rhythm} data-energy={energy} data-revision={revision}>
  <A2uiSurface surface={surface} />
</div>
```

Derive frame metadata from the surface root component after processing. Fall back to `stack`, `editorial`, `quiet`, revision `1` when absent so replayed legacy operations remain renderable.

- [ ] **Step 5: Run focused suites and verify success**

Run: `pnpm test -- tests/a2uiContracts.test.ts tests/a2uiSurface.test.ts tests/a2uiStreamIntegration.test.ts`

Expected: PASS; arbitrary tokens fail closed and old operation sequences still materialize.

- [ ] **Step 6: Commit catalog validation**

```bash
git add src/lib/a2ui/contracts.ts src/components/a2ui/HarmoniaCatalog.tsx tests/a2uiContracts.test.ts tests/a2uiSurface.test.ts tests/a2uiStreamIntegration.test.ts
git commit -m "feat: validate directed A2UI catalog surfaces"
```

### Task 4: Build the semantic component variants and bounded compositions

**Files:**
- Modify: `src/components/a2ui/HarmoniaWorkspaceElements.tsx`
- Modify: `src/components/a2ui/HarmoniaWorkspaceElements.module.css`
- Test: `tests/a2uiElements.test.ts`

**Interfaces:**
- Consumes: `tone`, `role`, `density`, `motion`, surface token props, and existing trusted component data.
- Produces: a shared `ArtDirectedSection` wrapper and data attributes used by fixed CSS variants.

- [ ] **Step 1: Write failing component markup tests**

Render representative components and assert semantic attributes and non-color state labels:

```ts
const html = renderToStaticMarkup(<CampaignBrief {...briefProps} tone="ink" role="hero" density="airy" motion="reveal" />);
expect(html).toContain('data-tone="ink"');
expect(html).toContain('data-role="hero"');

const receipt = renderToStaticMarkup(<VerificationReceipt {...unverifiedProps} tone="paper" role="feature" density="balanced" motion="none" />);
expect(receipt).toContain("Verification pending");
```

Add assertions for active progress text, selected draft `aria-selected`, selected moment `aria-pressed`, and approval consequence labels.

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm test -- tests/a2uiElements.test.ts`

Expected: FAIL because art-direction attributes and linked accessibility state are absent.

- [ ] **Step 3: Add the typed wrapper and apply it to every workspace component**

```tsx
export type ArtDirectionProps = {
  tone: "paper" | "ink" | "acid" | "blue" | "coral" | "violet";
  role: "hero" | "feature" | "support" | "strip" | "inline";
  density: "airy" | "balanced" | "compact";
  motion: "none" | "reveal" | "pulse" | "trace";
};

function ArtDirectedSection({ tone, role, density, motion, className, children, ...rest }: ArtDirectionProps & React.ComponentPropsWithoutRef<"section">) {
  return <section {...rest} className={`${styles.artifact} ${className ?? ""}`} data-tone={tone} data-role={role} data-density={density} data-motion={motion}>{children}</section>;
}
```

Use it for all twelve workspace catalog components. Preserve existing children, buttons, media controls, links, and action callbacks.

- [ ] **Step 4: Implement the Harmonia palette and silhouettes**

Define fixed custom properties and variant rules in the CSS module:

```css
.artifact {
  --surface: #fffdf6;
  --ink: #151515;
  --accent: #6146d7;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid color-mix(in srgb, var(--ink) 24%, transparent);
}
.artifact[data-tone="ink"] { --surface: #171717; --ink: #fffdf6; --accent: #d9ff43; }
.artifact[data-tone="acid"] { --surface: #d9ff43; --ink: #171717; --accent: #6146d7; }
.artifact[data-tone="blue"] { --surface: #2764ff; --ink: #fffdf6; --accent: #d9ff43; }
.artifact[data-tone="coral"] { --surface: #ff715b; --ink: #171717; --accent: #fffdf6; }
.artifact[data-tone="violet"] { --surface: #7a5cff; --ink: #fffdf6; --accent: #d9ff43; }
.artifact[data-role="hero"] { min-height: 18rem; grid-column: 1 / -1; }
.artifact[data-role="strip"] { min-height: 5rem; grid-column: 1 / -1; }
.artifact[data-density="compact"] { padding: 0.875rem; }
```

Give each component a distinct internal silhouette: oversized campaign thesis, horizontal progress rail, media/transcript split, branching draft tabs, framed platform artifact, provenance list, consequence block, and receipt stamp. Reuse existing typography and controls rather than creating alternate component implementations.

- [ ] **Step 5: Add bounded surface grids and responsive collapse**

```css
.surfaceFrame[data-composition="mosaic"] > * { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0.875rem; }
.surfaceFrame[data-composition="split"] > * { display: grid; grid-template-columns: minmax(0, 7fr) minmax(16rem, 5fr); gap: 0.875rem; }
.surfaceFrame[data-composition="rail"] > * { display: grid; grid-auto-flow: row; gap: 0.625rem; }
@media (max-width: 760px) {
  .surfaceFrame[data-composition] > * { display: flex; flex-direction: column; }
  .artifact[data-role="hero"] { min-height: auto; }
}
```

Map `feature` to eight columns and `support` to four columns in mosaics; fall back to full width when nesting or available space makes that safer.

- [ ] **Step 6: Run component tests, lint, and commit**

Run: `pnpm test -- tests/a2uiElements.test.ts tests/a2uiContracts.test.ts && pnpm lint`

Expected: PASS with zero lint errors.

```bash
git add src/components/a2ui/HarmoniaWorkspaceElements.tsx src/components/a2ui/HarmoniaWorkspaceElements.module.css tests/a2uiElements.test.ts
git commit -m "feat: add semantic A2UI visual variants"
```

### Task 5: Tie motion and linked response behavior to real state

**Files:**
- Modify: `src/components/a2ui/HarmoniaCatalog.tsx`
- Modify: `src/components/a2ui/HarmoniaWorkspaceElements.tsx`
- Modify: `src/components/a2ui/HarmoniaWorkspaceElements.module.css`
- Test: `tests/a2uiElements.test.ts`
- Test: `tests/a2uiStreamIntegration.test.ts`

**Interfaces:**
- Consumes: A2UI operation count, surface revision, trusted workflow status, and current local selection.
- Produces: `data-new`, `data-revision-changed`, `data-active`, selected draft ID, and selected moment ID.
- Preserves: revision requests and protected actions through existing `dispatchAction` calls.

- [ ] **Step 1: Write failing state-transition tests**

Add a stream test proving an appended operation marks only the new revision, plus component tests proving local selections update linked markup without mutating trusted records:

```ts
expect(renderedActiveProgress).toContain('data-active="true"');
expect(renderedActiveProgress).toContain("In progress");
expect(renderedReducedState).not.toContain("aria-hidden=\"true\" data-status");
```

Use React test rendering for `MomentExplorer` and `DraftComparison`: click a different item, then assert `aria-pressed`/`aria-selected` and the linked preview heading change.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- tests/a2uiElements.test.ts tests/a2uiStreamIntegration.test.ts`

Expected: FAIL because the host does not distinguish revisions and selection is not fully linked.

- [ ] **Step 3: Implement revision-aware host state**

Track the last rendered revision per surface ID in a ref. Set `data-revision-changed="true"` for one render cycle only when a greater revision arrives; do not replay this marker when the same durable operations are reconstructed.

Use component IDs and operation sequence, not time or random values, for stagger order:

```tsx
style={{ "--reveal-index": Math.min(componentIndex, 12) } as React.CSSProperties}
```

Never mark a surface active from `energy` alone; active pulses require a trusted active stage or loading component.

- [ ] **Step 4: Link moment and draft selections locally**

Keep `selectedMomentId` and `selectedDraftId` inside their owning catalog component. Selection must update all related visual affordances in that component tree and media seeking where an authorized media element exists. The “request revision” action continues to dispatch the stable draft ID through `request_surface_revision`; local selection itself performs no server mutation.

- [ ] **Step 5: Add restrained transitions and reduced-motion rules**

```css
@keyframes artifact-reveal { from { opacity: 0; transform: translateY(10px) scale(.99); } to { opacity: 1; transform: none; } }
@keyframes active-pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 20%, transparent); } }
.artifact[data-motion="reveal"][data-new="true"] { animation: artifact-reveal 360ms cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--reveal-index, 0) * 45ms); }
.artifact[data-motion="pulse"][data-active="true"] { animation: active-pulse 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .artifact, .surfaceFrame { animation: none !important; transition: none !important; scroll-behavior: auto; }
}
```

Do not animate failed, unresolved, historical, or already replayed completed surfaces.

- [ ] **Step 6: Run transition, stream, and action suites**

Run: `pnpm test -- tests/a2uiElements.test.ts tests/a2uiStreamIntegration.test.ts tests/a2uiSurface.test.ts tests/a2uiSurfaceSlots.test.ts`

Expected: PASS; protected action payloads remain unchanged.

- [ ] **Step 7: Commit dynamic behavior**

```bash
git add src/components/a2ui/HarmoniaCatalog.tsx src/components/a2ui/HarmoniaWorkspaceElements.tsx src/components/a2ui/HarmoniaWorkspaceElements.module.css tests/a2uiElements.test.ts tests/a2uiStreamIntegration.test.ts
git commit -m "feat: animate real A2UI state changes"
```

### Task 6: Teach Maya the bounded visual grammar

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/tests/test_a2ui_presenter.py`
- Test: `agent/tests/test_a2ui_presenter.py`

**Interfaces:**
- Consumes: Python `SurfacePlan` schema from Task 1.
- Produces: presenter instructions that select semantic tokens without styling or truth claims.

- [ ] **Step 1: Write a failing presenter-boundary test**

Update `valid_surface_state()` to include art direction and assert it survives managed runtime validation:

```py
assert result.surfaces[0].artDirection.rhythm == "cinematic"
assert result.surfaces[0].nodes[0].artDirection.tone == "blue"
```

Add one invalid runtime response using `{"tone": "#00ff00"}` and assert `plan_surface()` raises validation error.

- [ ] **Step 2: Run the presenter tests and verify failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_presenter.py -q`

Expected: FAIL until the fixture and presenter output contract use the new grammar.

- [ ] **Step 3: Add semantic art-direction guidance to `maya_presenter`**

The instruction must state:

```text
Choose art direction only from the SurfacePlan enums. Use ink for strategy and consequence framing; acid for a selected creative direction or persisted verified success; blue for media and analysis; coral for unresolved risk or failure; violet for generated alternatives; paper for evidence and long reading. Vary role and composition to create hierarchy, but never emit style values or imply lifecycle state. Motion is allowed only for real reveal, active work, or evidence tracing. Prefer one hero or feature per surface and keep approval consequences explicit.
```

Retain the reference-only rule, supported component list, and instruction to prefer one canvas surface.

- [ ] **Step 4: Run all agent A2UI tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_models.py tests/test_a2ui_presenter.py tests/test_a2ui_endpoint.py -q`

Expected: PASS.

- [ ] **Step 5: Commit presenter guidance**

```bash
git add agent/harmonia_agent/agents.py agent/tests/test_a2ui_presenter.py
git commit -m "feat: guide Maya A2UI art direction"
```

### Task 7: Verify the complete generative visual slice

**Files:**
- Modify if evidence requires a correction: files changed in Tasks 1–6 only
- Test: all web and agent suites

**Interfaces:**
- Consumes: completed directed planning, hydration, rendering, and presenter behavior.
- Produces: verified desktop/mobile, replay, accessibility, and build evidence.

- [ ] **Step 1: Run the full automated verification**

Run:

```bash
pnpm test
pnpm test:agent
pnpm lint
pnpm build
git diff --check
```

Expected: all web tests and agent tests PASS, lint reports zero errors, production build succeeds, and `git diff --check` produces no output.

- [ ] **Step 2: Start the authenticated local stack using real configured services**

Run: `HARMONIA_DEV_AUTH_BYPASS=1 pnpm dev`

Expected: the web app starts. If the managed presenter requires unavailable `AGENT_ENGINE_RESOURCE`, record that exact blocker and use an already persisted real A2UI run for renderer verification; do not add a deterministic or mocked success fallback.

- [ ] **Step 3: Verify representative surfaces in the browser**

Inspect at 1440×1000 and 390×844:

- campaign strategy has an ink hero and visibly different support artifacts;
- active job progress uses a compact operational treatment tied to a real active stage;
- moment analysis uses blue media/transcript treatment and linked selection;
- draft comparison uses violet branching and acid selection;
- approval remains consequence-first and never looks successful while pending;
- verified receipt uses acid only when the persisted receipt is independently verified;
- mosaic/split compositions collapse into a logical mobile reading order; and
- reduced-motion mode removes animation while retaining every status and control.

- [ ] **Step 4: Verify replay and failure honesty**

Reload the active run and confirm the final composition reconstructs without replaying old entrance motion. Trigger or inspect a persisted unresolved/failure example and confirm it stays coral/neutral, exposes its reason, and never becomes a simulated success.

- [ ] **Step 5: Apply only evidence-driven corrections and rerun affected checks**

For each concrete visual or behavior defect, first add or tighten the smallest relevant test, verify it fails, make the minimal correction in the owning file, and rerun that focused test followed by `pnpm lint`.

- [ ] **Step 6: Commit verified corrections, if any**

```bash
git add src agent tests
git commit -m "fix: polish directed A2UI workspace"
```

Skip this commit when browser verification requires no correction.

- [ ] **Step 7: Record final repository state**

Run: `git status --short && git log --oneline -8`

Expected: only known parent-level or intentionally untracked evidence files remain; all implementation commits are visible and no unrelated user changes were modified.
