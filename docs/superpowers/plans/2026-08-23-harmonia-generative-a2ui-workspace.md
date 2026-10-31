# Harmonia Generative A2UI Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Harmonia's deterministic generic A2UI appendix with an ADK-composed, server-hydrated, native campaign workspace for moments, drafts, approvals, and verification.

**Architecture:** A Python Google ADK presentation specialist returns a strict reference-only `SurfacePlan`. The authenticated Next.js service builds a bounded context, invokes the worker, resolves every entity reference from persisted state, and emits validated v0.9 A2UI operations through the existing durable chat-run stream. The React client renders separate canvas, conversation, and approval surfaces without flattening their generated hierarchy.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, `@a2ui/react` and `@a2ui/web_core` v0.9 APIs, Python 3.12, FastAPI, Pydantic, Google ADK, Vertex AI Agent Engine, Firestore, Vitest, pytest, in-app browser inspection.

**Spec:** `docs/superpowers/specs/2026-08-23-harmonia-generative-a2ui-workspace-design.md`

## Global Constraints

- Build real functionality only; production behavior has no mock, placeholder, fabricated-success, or silent deterministic-template fallback.
- Keep A2UI wire messages on protocol version `v0.9` for this slice.
- Use Google ADK through the existing managed Vertex AI Agent Engine runtime for presentation decisions.
- Model output may choose composition and generated framing copy, but persisted state is the sole authority for drafts, moments, assets, actions, cost, receipts, and verification.
- Preserve existing Firestore job shapes, Pub/Sub stage contracts, approval receipts, publishing behavior, verification behavior, action IDs, and idempotency derivation.
- Keep publishing and other material external effects behind the existing human approval boundary.
- Keep the landing page out of scope.
- Do not add MCP Apps, arbitrary HTML, model-generated JSX, or iframe applications.
- Work directly on `main`; do not create a worktree.
- Inspect the real dashboard in the browser after every meaningful visual iteration and verify desktop and mobile layouts before completion.

## File Structure

### Agent-side presentation boundary

- `agent/harmonia_agent/a2ui_models.py` — strict Pydantic request and reference-only surface-plan contracts.
- `agent/harmonia_agent/a2ui_presenter.py` — validates and invokes the managed presentation specialist.
- `agent/harmonia_agent/agents.py` — registers the presentation specialist with the existing ADK coordinator.
- `agent/harmonia_agent/role_models.py` — assigns the presentation role to Gemini 3.5 Flash.
- `agent/harmonia_agent/main.py` — exposes the authenticated internal planning endpoint.

### Web-side trust and transport boundary

- `src/lib/a2ui/presentationContracts.ts` — Zod mirror of the Python request and plan contracts.
- `src/lib/a2ui/presentationContext.ts` — builds bounded, presentation-safe context from authenticated persisted state.
- `src/lib/a2ui/agentPresentationClient.ts` — invokes the worker service with Cloud Run identity and the shared internal token.
- `src/lib/a2ui/hydrateSurfacePlan.ts` — resolves references and produces trusted catalog component data.
- `src/lib/a2ui/surfaceSlots.ts` — names and selects native canvas, conversation, and approval surfaces without flattening trees.

### Native catalog and studio

- `src/lib/a2ui/contracts.ts` — schemas for the domain-specific rendered components.
- `src/components/a2ui/HarmoniaCatalog.tsx` — catalog registration and action dispatch.
- `src/components/a2ui/HarmoniaWorkspaceElements.tsx` — focused React implementations of domain components.
- `src/components/a2ui/HarmoniaWorkspaceElements.module.css` — editorial layout, responsive behavior, focus, and reduced motion.
- `src/components/studio/WorkingCanvas.tsx` — mounts generated canvas as the primary working surface.
- `src/components/studio/ConversationTurn.tsx` — mounts compact turn-linked surfaces.
- `src/components/studio/ApprovalDock.tsx` — mounts generated decision detail while retaining protected controls.
- `src/lib/a2ui/responseSurface.ts` — becomes the orchestration boundary for planner invocation and hydration; the deterministic generic builder is removed.
- `src/app/api/chat/stream/route.ts` — streams generated operations and visible generation failures.

---

### Task 1: Define Matching Reference-Only Presentation Contracts

**Files:**
- Create: `agent/harmonia_agent/a2ui_models.py`
- Create: `src/lib/a2ui/presentationContracts.ts`
- Create: `agent/tests/test_a2ui_models.py`
- Create: `tests/a2uiPresentationContracts.test.ts`

**Interfaces:**
- Consumes: persisted entity identifiers and presentation-safe summaries.
- Produces: Python `UiContext`, `SurfacePlan`, `SurfacePlanNode`; TypeScript `uiContextSchema`, `surfacePlanSchema`, `UiContext`, `SurfacePlan`.

- [ ] **Step 1: Write failing Python contract tests**

```python
import pytest
from pydantic import ValidationError
from harmonia_agent.a2ui_models import SurfacePlan, UiContext


def test_surface_plan_accepts_only_known_components_and_references():
    plan = SurfacePlan.model_validate({
        "version": "harmonia.ui/v1",
        "surfaces": [{
            "slot": "canvas",
            "revision": 1,
            "rootId": "root",
            "nodes": [{
                "id": "root",
                "component": "DraftComparison",
                "refs": {"jobId": "job-1", "draftIds": ["draft-1"]},
                "children": [],
            }],
        }],
    })
    assert plan.surfaces[0].nodes[0].refs.draftIds == ["draft-1"]


def test_surface_plan_rejects_authoritative_inline_content():
    with pytest.raises(ValidationError):
        SurfacePlan.model_validate({
            "version": "harmonia.ui/v1",
            "surfaces": [{
                "slot": "canvas", "revision": 1, "rootId": "root",
                "nodes": [{
                    "id": "root", "component": "ApprovalReview",
                    "refs": {"jobId": "job-1", "actionIds": ["action-1"]},
                    "children": [], "risk": "low",
                }],
            }],
        })
```

- [ ] **Step 2: Run the Python tests and verify the missing module failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_models.py -q`

Expected: FAIL because `harmonia_agent.a2ui_models` does not exist.

- [ ] **Step 3: Implement strict Pydantic contracts**

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

SurfaceSlot = Literal["canvas", "conversation", "approval"]
ComponentName = Literal[
    "CampaignBrief", "JobProgress", "MomentExplorer", "DraftComparison",
    "PlatformPreview", "SourceEvidence", "ApprovalReview",
    "VerificationReceipt", "SurfaceLoading", "SurfaceEmpty",
    "SurfaceUnresolved", "SurfaceFailure",
]


class EntityRefs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jobId: str | None = None
    draftIds: list[str] = Field(default_factory=list, max_length=20)
    momentIds: list[str] = Field(default_factory=list, max_length=20)
    sourceIds: list[str] = Field(default_factory=list, max_length=50)
    assetActionIds: list[str] = Field(default_factory=list, max_length=20)
    actionIds: list[str] = Field(default_factory=list, max_length=20)
    receiptIds: list[str] = Field(default_factory=list, max_length=20)


class SurfacePlanNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    component: ComponentName
    refs: EntityRefs = Field(default_factory=EntityRefs)
    title: str | None = Field(default=None, max_length=160)
    emphasis: Literal["primary", "secondary", "compact"] = "primary"
    children: list[str] = Field(default_factory=list, max_length=30)


class PlannedSurface(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slot: SurfaceSlot
    revision: int = Field(ge=1)
    rootId: str
    nodes: list[SurfacePlanNode] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def validate_graph(self):
        ids = [node.id for node in self.nodes]
        if len(ids) != len(set(ids)) or self.rootId not in ids:
            raise ValueError("surface graph ids must be unique and include rootId")
        if any(child not in ids for node in self.nodes for child in node.children):
            raise ValueError("surface graph contains a dangling child")
        return self


class SurfacePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal["harmonia.ui/v1"]
    surfaces: list[PlannedSurface] = Field(min_length=1, max_length=3)
```

Define `UiContext` in the same file with bounded summaries and identifier lists only. It must use `extra="forbid"` and cap user text at 2,000 characters.

- [ ] **Step 4: Add equivalent failing TypeScript validation tests**

```ts
import { describe, expect, it } from "vitest";
import { surfacePlanSchema } from "../src/lib/a2ui/presentationContracts";

describe("A2UI presentation contracts", () => {
  it("rejects model-authored approval risk", () => {
    const result = surfacePlanSchema.safeParse({
      version: "harmonia.ui/v1",
      surfaces: [{ slot: "approval", revision: 1, rootId: "root", nodes: [
        { id: "root", component: "ApprovalReview", refs: { jobId: "job-1", actionIds: ["a-1"] }, children: [], risk: "low" },
      ] }],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 5: Implement the Zod mirror and run both contract suites**

Run: `pnpm test -- tests/a2uiPresentationContracts.test.ts`

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_models.py -q`

Expected: both PASS.

- [ ] **Step 6: Commit the cross-service contract**

```bash
git add agent/harmonia_agent/a2ui_models.py agent/tests/test_a2ui_models.py src/lib/a2ui/presentationContracts.ts tests/a2uiPresentationContracts.test.ts
git commit -m "feat: define generative A2UI presentation contracts"
```

### Task 2: Add the Managed ADK Presentation Specialist

**Files:**
- Create: `agent/harmonia_agent/a2ui_presenter.py`
- Create: `agent/tests/test_a2ui_presenter.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/role_models.py`
- Modify: `agent/tests/test_agent_team.py`
- Modify: `agent/tests/test_role_models.py`

**Interfaces:**
- Consumes: `UiContext`, `InvocationContext`, and `TeamRuntime`.
- Produces: `async plan_surface(context: UiContext, *, invocation: InvocationContext, team_runtime: TeamRuntime | None = None) -> SurfacePlan` and ADK state key `surface_plan`.

- [ ] **Step 1: Write a failing managed-runtime test**

```python
@pytest.mark.asyncio
async def test_plan_surface_uses_managed_runtime_and_validates_output():
    runtime = FakeTeamRuntime({"surface_plan": {
        "version": "harmonia.ui/v1",
        "surfaces": [{
            "slot": "canvas", "revision": 1, "rootId": "root",
            "nodes": [{"id": "root", "component": "JobProgress", "refs": {"jobId": "job-1"}, "children": []}],
        }],
    }})
    result = await plan_surface(context_fixture(), invocation=invocation_fixture(), team_runtime=runtime)
    assert result.surfaces[0].nodes[0].component == "JobProgress"
    assert runtime.specialist == "maya_presenter"
```

- [ ] **Step 2: Run the focused agent tests and verify failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_presenter.py tests/test_agent_team.py tests/test_role_models.py -q`

Expected: FAIL because the presentation specialist and model role are absent.

- [ ] **Step 3: Register `maya_presenter` in the ADK team**

Add a `presenter` field to `RoleModelInstances` and `RoleModelCatalog`, defaulting `PRESENTER_MODEL_ID` to `gemini-3.5-flash`. Register an `Agent` with `input_schema=UiContext`, `output_schema=SurfacePlan`, `output_key="surface_plan"`, `mode="single_turn"`, and these non-negotiable instructions:

```python
instruction=(
    "Compose the smallest useful Harmonia interface for the supplied operator intent. "
    "Use only component names and entity identifiers present in UiContext. "
    "Never invent domain content, status, risk, cost, URLs, actions, receipts, or evidence. "
    "Prefer one canvas surface; add conversation or approval surfaces only when useful. "
    "Return only the SurfacePlan JSON contract."
)
```

Add `maya_presenter` to `_SPECIALIST_ROLES`, `_MAX_OUTPUT_TOKENS`, coordinator delegation instructions, and `sub_agents`.

- [ ] **Step 4: Implement the validated presenter invocation**

```python
async def plan_surface(context, *, invocation, team_runtime=None):
    context = UiContext.model_validate(context)
    state = await _run_coordinator(
        "maya_presenter", context, invocation=invocation, team_runtime=team_runtime,
    )
    return _validated_state(state, "surface_plan", SurfacePlan)
```

Extend `_validate_run_output` with an explicit `maya_presenter` branch so it cannot fall through to draft-workflow validation.

- [ ] **Step 5: Run the focused and full agent suites**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_presenter.py tests/test_agent_team.py tests/test_role_models.py -q`

Run: `pnpm test:agent`

Expected: PASS.

- [ ] **Step 6: Commit the presenter**

```bash
git add agent/harmonia_agent/a2ui_presenter.py agent/harmonia_agent/agents.py agent/harmonia_agent/role_models.py agent/tests/test_a2ui_presenter.py agent/tests/test_agent_team.py agent/tests/test_role_models.py
git commit -m "feat: add managed ADK interface presenter"
```

### Task 3: Create the Authenticated Web-to-Agent Planning Boundary

**Files:**
- Modify: `agent/harmonia_agent/main.py`
- Create: `agent/tests/test_a2ui_endpoint.py`
- Create: `src/lib/a2ui/agentPresentationClient.ts`
- Create: `tests/a2uiAgentPresentationClient.test.ts`
- Modify: `.env.example`
- Modify: `docs/configuration.mdx`
- Modify: `infra/deploy.sh`
- Modify: `infra/setup.sh`

**Interfaces:**
- Consumes: `POST /internal/a2ui/plan` with `UiContext` and tenant headers.
- Produces: validated `SurfacePlan`; `requestSurfacePlan(context: UiContext): Promise<SurfacePlan>`.

- [ ] **Step 1: Write failing endpoint authorization tests**

```python
def test_a2ui_plan_rejects_missing_internal_token(client):
    response = client.post("/internal/a2ui/plan", json=context_fixture().model_dump())
    assert response.status_code == 401


def test_a2ui_plan_scopes_invocation_to_headers(client, monkeypatch):
    monkeypatch.setattr(main, "plan_surface", fake_plan_surface)
    response = client.post(
        "/internal/a2ui/plan",
        json=context_fixture().model_dump(),
        headers={
            "x-harmonia-internal-token": "test-token",
            "x-workspace-id": "workspace-1",
            "x-brand-id": "brand-1",
        },
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Implement the FastAPI endpoint**

Validate `x-harmonia-internal-token` with `hmac.compare_digest`, require workspace and brand headers, enter `tenant_scope`, create an `InvocationContext` whose stage is `presentation`, and call `plan_surface`. Return 422 for schema failures and 502 for normalized Agent Engine provider failures; do not call a local model fallback.

- [ ] **Step 3: Write failing web-client tests**

```ts
it("rejects an invalid plan returned by the agent service", async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "bad" }), { status: 200 }));
  await expect(requestSurfacePlan(uiContextFixture(), { fetchImpl: fetch, token: "token", baseUrl: "http://agent" }))
    .rejects.toThrow("invalid A2UI surface plan");
});
```

- [ ] **Step 4: Implement the web client and Cloud Run authentication**

`requestSurfacePlan` must obtain a Google ID-token client for `AGENT_SERVICE_URL` when not running against localhost, send the shared `x-harmonia-internal-token`, propagate tenant headers from server-side tenant context, apply a 25-second abort timeout, and parse with `surfacePlanSchema`. Localhost uses ordinary `fetch` plus the same shared internal token.

- [ ] **Step 5: Wire deployment configuration**

Add `AGENT_SERVICE_URL` to `.env.example` and configuration docs. Grant the web runtime service account `roles/run.invoker` on the agent service, then inject the deployed agent URL into the web service in `infra/deploy.sh`.

- [ ] **Step 6: Run focused tests and configuration checks**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_endpoint.py -q`

Run: `pnpm test -- tests/a2uiAgentPresentationClient.test.ts`

Run: `bash -n infra/deploy.sh infra/setup.sh`

Expected: all PASS.

- [ ] **Step 7: Commit the authenticated bridge**

```bash
git add agent/harmonia_agent/main.py agent/tests/test_a2ui_endpoint.py src/lib/a2ui/agentPresentationClient.ts tests/a2uiAgentPresentationClient.test.ts .env.example docs/configuration.mdx infra/deploy.sh infra/setup.sh
git commit -m "feat: connect chat surfaces to the ADK presenter"
```

### Task 4: Build Presentation Context and Trusted Hydration

**Files:**
- Create: `src/lib/a2ui/presentationContext.ts`
- Create: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Create: `tests/a2uiPresentationContext.test.ts`
- Create: `tests/a2uiHydration.test.ts`
- Modify: `src/lib/a2ui/contracts.ts`

**Interfaces:**
- Consumes: `ChatResponse`, optional `JobFull`, `Receipt[]`, and a validated `SurfacePlan`.
- Produces: `buildUiContext(input): UiContext` and `hydrateSurfacePlan(input): HydratedSurfaceSet` where `HydratedSurfaceSet` is `{ canvas: unknown[]; conversation: unknown[]; approval: unknown[] }`.

- [ ] **Step 1: Write failing context-minimization tests**

```ts
it("includes identifiers and summaries but excludes action payloads", () => {
  const context = buildUiContext({ message: "Show drafts", response, job, receipts });
  expect(context.drafts).toEqual([{ id: "draft-1", platform: "x", valid: true, momentId: "moment-1" }]);
  expect(JSON.stringify(context)).not.toContain("secret payload text");
});
```

- [ ] **Step 2: Implement `buildUiContext`**

Include request intent, active job identity and lifecycle, entity IDs, bounded titles, media kinds, validation booleans, and whether pending actions or verified receipts exist. Exclude full draft text, transcript text, action payloads, receipt details, unrestricted URLs, and credentials. Parse the final object with `uiContextSchema` before returning it.

- [ ] **Step 3: Write failing hydration truth tests**

```ts
it("hydrates approval risk and content from the persisted action", () => {
  const result = hydrateSurfacePlan({ runId: "run-1", plan: approvalPlan, job, receipts });
  expect(JSON.stringify(result.approval)).toContain('"risk":"high"');
  expect(JSON.stringify(result.approval)).toContain('"actionId":"publish-1"');
});

it("renders an unresolved component for a stale draft reference", () => {
  const result = hydrateSurfacePlan({ runId: "run-1", plan: staleDraftPlan, job, receipts });
  expect(JSON.stringify(result.canvas)).toContain("SurfaceUnresolved");
  expect(JSON.stringify(result.canvas)).not.toContain("DraftComparison");
});
```

- [ ] **Step 4: Add strict rendered-component schemas**

Extend `catalogComponentSchema` with discriminated schemas for all first-slice components. Every URL must use the existing authorized same-origin asset route or validated HTTP(S) source rule. Approval and receipt schemas accept fully hydrated trusted properties only; they are never used as presentation-agent output schemas.

- [ ] **Step 5: Implement hydration**

Resolve node references from maps built from `job.drafts`, `job.moments`, `job.transcriptSegments`, `job.actions`, `job.assets`, `job.verifications`, and `receipts`. Convert each planned node into a trusted rendered component, preserve children, add a basic layout root when needed, call `parseCatalogComponent` for every domain component, and produce `createSurface` plus `updateComponents` operations using `studio-${runId}-${slot}-r${revision}` IDs.

- [ ] **Step 6: Run contract and hydration tests**

Run: `pnpm test -- tests/a2uiPresentationContext.test.ts tests/a2uiHydration.test.ts tests/a2uiContracts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the trust boundary**

```bash
git add src/lib/a2ui/presentationContext.ts src/lib/a2ui/hydrateSurfacePlan.ts src/lib/a2ui/contracts.ts tests/a2uiPresentationContext.test.ts tests/a2uiHydration.test.ts
git commit -m "feat: hydrate generated surfaces from persisted state"
```

### Task 5: Implement the Harmonia-Native A2UI Catalog

**Files:**
- Create: `src/components/a2ui/HarmoniaWorkspaceElements.tsx`
- Create: `src/components/a2ui/HarmoniaWorkspaceElements.module.css`
- Modify: `src/components/a2ui/HarmoniaCatalog.tsx`
- Modify: `tests/a2uiElements.test.ts`
- Modify: `tests/a2uiSurface.test.ts`

**Interfaces:**
- Consumes: hydrated component properties from Task 4.
- Produces: registered native implementations for `CampaignBrief`, `JobProgress`, `MomentExplorer`, `DraftComparison`, `PlatformPreview`, `SourceEvidence`, `ApprovalReview`, `VerificationReceipt`, and the four shared state components.

- [ ] **Step 1: Add failing server-render tests for the domain vocabulary**

```ts
it("renders a source-grounded draft comparison", () => {
  const html = renderToStaticMarkup(createElement(DraftComparison, {
    title: "Choose the launch voice",
    drafts: [{ id: "d1", platform: "x", text: "Ship outcomes.", valid: true, selected: true, sourceCount: 1 }],
  }));
  expect(html).toContain("Choose the launch voice");
  expect(html).toContain("Ship outcomes.");
  expect(html).toContain("1 source");
});

it("never renders approval controls without a pending trusted action", () => {
  const html = renderToStaticMarkup(createElement(ApprovalReview, approvedActionFixture));
  expect(html).not.toContain("Approve and continue");
});
```

- [ ] **Step 2: Implement semantic components before visual polish**

Use native `article`, `figure`, `video`, `time`, `blockquote`, `ol`, `button`, and `details` elements. Media sources use authorized same-origin routes. Every control has a stable accessible label. Generated framing copy receives a visible “agent framing” label; persisted facts do not.

- [ ] **Step 3: Register strict component APIs**

Create one `ComponentApi` per component using the same property constraints as `contracts.ts`, register implementations in `customImplementations`, and preserve `parseHarmoniaA2uiOperation` validation before processor ingestion.

- [ ] **Step 4: Add editorial visual styling**

Use the existing cream, ink, acid-lime, coral, and periwinkle palette. Give `MomentExplorer` a synchronized media/timeline/transcript grid, `DraftComparison` a true editorial comparison layout, and `ApprovalReview` a clear decision hierarchy. Add `:focus-visible` treatments, `prefers-reduced-motion`, high-contrast status treatment, and structural mobile breakpoints at 900px and 640px.

- [ ] **Step 5: Verify focused renderer tests**

Run: `pnpm test -- tests/a2uiElements.test.ts tests/a2uiSurface.test.ts`

Expected: PASS with unknown components still rejected.

- [ ] **Step 6: Commit the native catalog**

```bash
git add src/components/a2ui/HarmoniaWorkspaceElements.tsx src/components/a2ui/HarmoniaWorkspaceElements.module.css src/components/a2ui/HarmoniaCatalog.tsx tests/a2uiElements.test.ts tests/a2uiSurface.test.ts
git commit -m "feat: add Harmonia-native A2UI workspace catalog"
```

### Task 6: Preserve Generated Surface Hierarchy Across Studio Slots

**Files:**
- Create: `src/lib/a2ui/surfaceSlots.ts`
- Create: `tests/a2uiSurfaceSlots.test.ts`
- Remove: `src/lib/a2ui/studioRegions.ts`
- Remove: `tests/a2uiStudioRegions.test.ts`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Modify: `src/components/studio/ConversationTurn.tsx`
- Modify: `src/components/studio/ApprovalDock.tsx`
- Modify: `tests/studioCanvas.test.ts`
- Modify: `tests/studioApprovalDock.test.ts`

**Interfaces:**
- Consumes: durable v0.9 A2UI operations with `studio-${runId}-${slot}-r${revision}` surface IDs.
- Produces: `latestSurfaceOperations(operations, slot): unknown[]` and direct native mounts for each slot.

- [ ] **Step 1: Write failing slot-selection tests**

```ts
it("returns the latest complete canvas revision without flattening children", () => {
  const selected = latestSurfaceOperations([...revisionOne, ...revisionTwo], "canvas");
  expect(JSON.stringify(selected)).toContain("studio-run-1-canvas-r2");
  expect(JSON.stringify(selected)).toContain('"children":["drafts","sources"]');
  expect(JSON.stringify(selected)).not.toContain("studio-run-1-canvas-r1");
});
```

- [ ] **Step 2: Implement strict surface-slot parsing**

Accept only the `studio-<run>-<canvas|conversation|approval>-r<positive integer>` convention, group create/update operations by exact surface ID, and select the highest revision that contains both a create operation and a root-bearing update. Reject duplicate surface creation and updates for uncreated surfaces.

- [ ] **Step 3: Replace region partitioning with native mounts**

In `WorkingCanvas`, render the selected canvas surface immediately below campaign identity and view navigation, without a disclosure wrapper. In `ConversationTurn`, render its compact surface after message text. In `ApprovalDock`, render generated review detail above the existing server-protected decision buttons. Do not infer placement from component names.

- [ ] **Step 4: Verify slot and studio tests**

Run: `pnpm test -- tests/a2uiSurfaceSlots.test.ts tests/studioCanvas.test.ts tests/studioApprovalDock.test.ts`

Expected: PASS and no rendered “Agent-generated interface” label.

- [ ] **Step 5: Commit hierarchy-preserving mounts**

```bash
git add src/lib/a2ui/surfaceSlots.ts tests/a2uiSurfaceSlots.test.ts src/components/studio/WorkingCanvas.tsx src/components/studio/ConversationTurn.tsx src/components/studio/ApprovalDock.tsx tests/studioCanvas.test.ts tests/studioApprovalDock.test.ts
git rm src/lib/a2ui/studioRegions.ts tests/a2uiStudioRegions.test.ts
git commit -m "feat: mount generated A2UI surfaces by studio slot"
```

### Task 7: Generate and Stream Real Surfaces Through the Durable Chat Run

**Files:**
- Modify: `src/lib/a2ui/responseSurface.ts`
- Modify: `src/app/api/chat/stream/route.ts`
- Modify: `tests/a2uiSurface.test.ts`
- Modify: `tests/chatRunReplay.test.ts`
- Create: `tests/a2uiStreamIntegration.test.ts`

**Interfaces:**
- Consumes: chat message, `ChatResponse`, optional hydrated `JobFull`, and `Receipt[]`.
- Produces: `generateResponseSurfaces(input): Promise<HydratedSurfaceSet>` and persisted `a2ui_operation` events.

- [ ] **Step 1: Write a failing orchestration test with injected planner**

```ts
it("passes a bounded context to the planner and hydrates returned references", async () => {
  const planner = vi.fn().mockResolvedValue(draftComparisonPlan);
  const surfaces = await generateResponseSurfaces({
    runId: "run-1", message: "Compare the drafts", response, job, receipts, planner,
  });
  expect(planner).toHaveBeenCalledWith(expect.objectContaining({ intent: "list_drafts" }));
  expect(JSON.stringify(surfaces.canvas)).toContain("DraftComparison");
  expect(JSON.stringify(planner.mock.calls[0][0])).not.toContain(job.drafts[0].text);
});
```

- [ ] **Step 2: Replace the deterministic builder**

Remove `buildResponseSurface`. Implement `generateResponseSurfaces` as `buildUiContext` → `requestSurfacePlan` → `surfacePlanSchema.parse` → `hydrateSurfacePlan`. Dependency injection is permitted only for tests; production always calls the managed agent service.

- [ ] **Step 3: Update the stream route**

After `handleChat` returns, reload the referenced job and receipts under the authenticated tenant, call `generateResponseSurfaces`, then persist and emit operations slot by slot. Emit `activity` and `tool_activity` summaries for presentation generation. If planning or hydration fails, emit `run_failed` with the real normalized error and preserve existing job state; do not emit the old generic surface.

- [ ] **Step 4: Prove replay reconstructs generated revisions**

Extend `chatRunReplay.test.ts` with canvas, conversation, and approval surface operations across revisions. Assert event order, duplicate sequence rejection, and preservation of exact operations.

- [ ] **Step 5: Run integration tests**

Run: `pnpm test -- tests/a2uiSurface.test.ts tests/chatRunReplay.test.ts tests/a2uiStreamIntegration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit real surface generation**

```bash
git add src/lib/a2ui/responseSurface.ts src/app/api/chat/stream/route.ts tests/a2uiSurface.test.ts tests/chatRunReplay.test.ts tests/a2uiStreamIntegration.test.ts
git commit -m "feat: stream ADK-composed A2UI surfaces"
```

### Task 8: Complete Interaction, Responsive, and Visual Integration

**Files:**
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Modify: `src/components/studio/ConversationTurn.tsx`
- Modify: `src/components/studio/ApprovalDock.tsx`
- Modify: `src/components/studio/StudioShell.module.css`
- Modify: `tests/studioIntegration.test.ts`
- Modify: `tests/studioShell.test.ts`
- Modify: `tests/studioApprovalDock.test.ts`

**Interfaces:**
- Consumes: generated slot surfaces and existing `onDecide`, `onOperationDecision`, artifact selection, and chat-send handlers.
- Produces: working local interactions, revision requests, protected decisions, and deliberate desktop/mobile composition.

- [ ] **Step 1: Add failing integration assertions**

```ts
expect(html).toContain("data-a2ui-slot=\"canvas\"");
expect(html).toContain("Choose the launch voice");
expect(html).not.toContain("Agent-generated interface");
expect(html).toContain("Approval boundary");
```

Add a separate assertion that an approval surface cannot remove the existing pending action controls or change their `data-action-id`.

- [ ] **Step 2: Route component actions**

Handle local selection and media-seek actions inside the component. Convert revision actions into a normal composer submission containing stable references. Route `decide_job_action` and `decide_operation` through existing handlers only. Unknown action names set a visible protocol error and make no request.

- [ ] **Step 3: Refine studio composition**

Let a generated canvas use the full working width beneath the campaign header. Keep operational details in an expandable technical footer. Ensure the global approval dock remains compact when closed and becomes a focused review workspace when opened. Preserve the 2/5 conversation and 3/5 canvas desktop default.

- [ ] **Step 4: Implement deliberate mobile behavior**

At widths below 900px, keep the existing peer-pane switch and show badges for active generated work and pending approvals. Inside catalog components, use media-first stacking for `MomentExplorer`, tabbed variants for `DraftComparison`, and a sticky decision footer for `ApprovalReview`. At widths below 640px, remove nonessential metadata columns without hiding provenance or consequences.

- [ ] **Step 5: Run studio and accessibility-oriented tests**

Run: `pnpm test -- tests/studioIntegration.test.ts tests/studioShell.test.ts tests/studioApprovalDock.test.ts tests/a2uiElements.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the studio integration**

```bash
git add src/components/ChatConsole.tsx src/components/studio/WorkingCanvas.tsx src/components/studio/ConversationTurn.tsx src/components/studio/ApprovalDock.tsx src/components/studio/StudioShell.module.css tests/studioIntegration.test.ts tests/studioShell.test.ts tests/studioApprovalDock.test.ts
git commit -m "feat: make generated surfaces the Harmonia workspace"
```

### Task 9: Verify the First Slice and Capture Visual Evidence

**Files:**
- Modify: `scripts/demo-a2ui-events.mjs`
- Modify: `tests/demoA2uiRun.test.ts`
- Modify: `README.md`
- Create: `submission/evidence/a2ui-generative-workspace.md` in the private parent workspace, not in the public repository

**Interfaces:**
- Consumes: real persisted demo records and the production A2UI data path.
- Produces: reproducible test evidence, desktop/mobile screenshots, and documented limitations without simulated-success claims.

- [ ] **Step 1: Update the local demo event builder to the domain catalog**

Generate slot-specific v0.9 operations using only IDs and content already present in the seeded demo job. Label the fixture as local persisted demo data and make no provider-execution claim. Ensure missing audio continues to render as unresolved rather than as a generated asset.

- [ ] **Step 2: Update demo assertions**

```ts
expect(componentNames).toContain("MomentExplorer");
expect(componentNames).toContain("DraftComparison");
expect(componentNames).toContain("ApprovalReview");
expect(serialized).not.toContain("Audio generated");
```

- [ ] **Step 3: Run full automated verification**

Run: `pnpm test`

Run: `pnpm lint`

Run: `pnpm build`

Run: `pnpm test:agent`

Run: `git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the real application at desktop width**

Use identical 1440×1000 viewports for the structural prototype and `http://localhost:3000/dashboard`. Capture both before the final visual pass. Inspect hierarchy, generative surface prominence, moment-to-draft traceability, approval consequences, focus visibility, and horizontal overflow.

- [ ] **Step 5: Inspect and correct mobile behavior**

Use a 390×844 viewport. Exercise conversation/canvas switching, open the approval surface, navigate draft variants by keyboard, and inspect the moment explorer. Fix clipping, unreadable metadata, missing focus, and hidden decision consequences, then repeat screenshots.

- [ ] **Step 6: Exercise one configured real presentation invocation**

With `AGENT_SERVICE_URL`, `AGENT_ENGINE_RESOURCE`, tenant context, and Google credentials configured, submit a real dashboard request against a persisted job. Capture the run ID, presenter activity, returned component family, durable A2UI events, and rendered surface. If credentials or deployment are unavailable, record that exact unresolved gap and do not describe the presentation agent as verified.

- [ ] **Step 7: Record private evidence and update public documentation**

Document the public architecture and local/cloud requirements in `README.md`. Store screenshots, run IDs, logs, and authenticated invocation evidence only under the parent `submission/evidence/` path. State separately which behavior was covered by automated tests, local persisted fixtures, and a real managed invocation.

- [ ] **Step 8: Commit public verification changes**

```bash
git add scripts/demo-a2ui-events.mjs tests/demoA2uiRun.test.ts README.md
git commit -m "docs: verify the generative A2UI workspace"
```

- [ ] **Step 9: Final repository audit**

Run: `git status --short --branch`

Expected: `main` contains only intended public repository changes; `.superpowers/` remains untracked and uncommitted; private evidence remains outside `harmonia/`.
