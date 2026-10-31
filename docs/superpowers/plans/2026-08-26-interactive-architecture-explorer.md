# Interactive Architecture Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed, validated, progressively disclosed Harmonia architecture explorer at `/dashboard/architecture` with searchable/filterable React Flow visualization, deep links, accessible details, mobile fallback, and integrated public documentation.

**Architecture:** Repository-authored architecture data is parsed by Zod and checked by semantic invariants before presentation. Pure projection and URL-state modules derive the visible graph; an isolated ELK adapter lays it out; focused React components render the desktop graph, mobile tree, toolbar, legend, and detail drawer without mixing architectural truth into JSX.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 5, Zod 4.4.3, `@xyflow/react`, `elkjs`, Tailwind CSS 4, Vitest 4.1.11, Mintlify MDX.

**Spec:** `docs/superpowers/specs/2026-08-26-interactive-architecture-explorer-design.md`

## Global Constraints

- Treat checked-in implementation and public docs as architectural truth; never derive truth from the generated blueprint image.
- Add only `@xyflow/react` and `elkjs`; preserve npm and `package-lock.json`.
- Public data may reference only repository-relative `src/`, `agent/`, and `docs/` paths.
- Firestore is durable truth; Agent Engine sessions are ephemeral cognition.
- Every external effect has an approval path and every executed effect has an independent verification path.
- Cognitive agents never claim approval, effect execution, credential mutation, or destructive authority.
- Pending authenticated evidence remains visibly distinct from implemented/offline-verified behavior.
- Edge semantics use labels, line patterns, and markers in addition to color.

---

### Task 1: Install graph dependencies and define the validated domain model

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/architecture/schema.ts`
- Create: `src/lib/architecture/validate.ts`
- Test: `tests/architectureSchema.test.ts`

**Interfaces:**
- Produces: `ArchitectureDefinitionSchema`, `ArchitectureDefinition`, `ArchitectureNode`, `ArchitectureEdge`, and `validateArchitecture(definition): ArchitectureDefinition`.
- Produces semantic enums for layer, status, authority, data scope, runtime lifetime, node kind, and edge kind.

- [ ] **Step 1: Install exact compatible dependencies**

Run: `npm install @xyflow/react elkjs`

Expected: dependency entries and lockfile are updated without changing the package manager.

- [ ] **Step 2: Write failing schema and invariant tests**

Create fixtures with one valid Firestore → approved effect → receipt → verification graph and mutations that duplicate IDs, dangle an edge, create a parent cycle, include `/Users/private`, grant `approve` to an agent, mark Agent Engine durable, omit Firestore ownership, omit approval, and omit verification.

```ts
expect(() => validateArchitecture(validDefinition)).not.toThrow();
expect(() => validateArchitecture(withDuplicateNode)).toThrow(/duplicate node/i);
expect(() => validateArchitecture(withDanglingEdge)).toThrow(/dangling/i);
expect(() => validateArchitecture(withAgentApproval)).toThrow(/agent.*authority/i);
expect(() => validateArchitecture(withUnapprovedEffect)).toThrow(/approval/i);
expect(() => validateArchitecture(withUnverifiedEffect)).toThrow(/verification/i);
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `npm test -- tests/architectureSchema.test.ts`

Expected: FAIL because the architecture schema modules do not exist.

- [ ] **Step 4: Implement the schema and semantic validator**

Define discriminated, closed enums and metadata fields from the spec. Parse with Zod first, then check uniqueness, endpoint validity, parent acyclicity, public-path safety, required Firestore/Agent Engine lifetime facts, forbidden agent authorities, inbound approval reachability, and post-execution verification reachability. Return the parsed immutable definition.

```ts
export function validateArchitecture(input: unknown): ArchitectureDefinition {
  const definition = ArchitectureDefinitionSchema.parse(input);
  assertUniqueIds(definition);
  assertValidOwnership(definition);
  assertPublicReferences(definition);
  assertAuthorityBoundaries(definition);
  assertEffectSafety(definition);
  assertStateOwnership(definition);
  return definition;
}
```

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- tests/architectureSchema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/architecture/schema.ts src/lib/architecture/validate.ts tests/architectureSchema.test.ts
git commit -m "feat: validate architecture explorer data"
```

### Task 2: Author the complete repository-backed architecture dataset

**Files:**
- Create: `src/lib/architecture/data.ts`
- Test: `tests/architectureData.test.ts`

**Interfaces:**
- Consumes: `validateArchitecture` and schema types from Task 1.
- Produces: `architectureDefinition`, validated at import time.

- [ ] **Step 1: Write failing completeness tests**

Assert the exact agents/models, nine workflow stages, five skills, six tools, route families, state stores, approval lifecycle, external systems, status vocabulary, source references, and documentation references. Assert Nova tools are read-only and scoped, Temi is proposal-only, Firestore is durable, Agent Engine is ephemeral, and pending providers are not live-verified.

```ts
expect(node("agent-nimi").model?.name).toBe("Gemma 3 12B IT");
expect(node("runtime-agent-engine").stateLifetime).toBe("ephemeral");
expect(node("store-firestore").stateLifetime).toBe("durable");
expect(requiredSkills.every((id) => architectureDefinition.nodes.some((node) => node.id === id))).toBe(true);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/architectureData.test.ts`

Expected: FAIL because `data.ts` does not exist.

- [ ] **Step 3: Author validated groups, nodes, edges, and presets**

Create summary groups and exact descendants for every required zone. Include concise, factual node detail metadata, representative real routes, repository-relative source files, docs slugs, and explicit offline-verified/pending-live wording. Use semantic edge kinds for workflow, delegation, approval, effect, verification, retrieval, memory, telemetry, and blocked authority.

```ts
export const architectureDefinition = validateArchitecture({
  version: "2026-08-26",
  nodes,
  edges,
  presets,
});
```

- [ ] **Step 4: Run schema and completeness tests**

Run: `npm test -- tests/architectureSchema.test.ts tests/architectureData.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/architecture/data.ts tests/architectureData.test.ts
git commit -m "feat: define Harmonia architecture dataset"
```

### Task 3: Build pure projection, search, filter, preset, and URL state

**Files:**
- Create: `src/lib/architecture/explorerState.ts`
- Create: `src/lib/architecture/project.ts`
- Test: `tests/architectureExplorerState.test.ts`
- Test: `tests/architectureProjection.test.ts`

**Interfaces:**
- Produces: `ExplorerState`, `parseExplorerQuery`, `serializeExplorerQuery`, `applyPreset`, `toggleGroup`, `selectNode`, `projectArchitecture`, and `searchArchitecture`.
- `projectArchitecture(definition, state)` returns visible nodes/edges plus ancestor/search metadata without mutating the definition.

- [ ] **Step 1: Write failing pure-state tests**

Cover URL normalization, invalid IDs, stable serialization, preset restoration, expansion toggles, search across names/models/routes/tools/skills, layer/status intersections, ancestor reveal, edge lifting, and edge deduplication.

```ts
expect(parseExplorerQuery(new URLSearchParams("preset=agents&node=agent-nova"), definition).selectedNodeId).toBe("agent-nova");
expect(projectArchitecture(definition, collapsed).nodes.some((node) => node.id === "group-agent-team")).toBe(true);
expect(projectArchitecture(definition, expanded).nodes.some((node) => node.id === "agent-nova")).toBe(true);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/architectureExplorerState.test.ts tests/architectureProjection.test.ts`

Expected: FAIL because the state and projection modules do not exist.

- [ ] **Step 3: Implement deterministic state and projection functions**

Use sets internally but serialize sorted comma-separated IDs. Preserve expansion when filters change. Search matches normalized node detail fields and reveals matching ancestor chains. Lift hidden endpoints to their nearest visible ancestors, discard self-loops created by lifting, and deduplicate by `(source,target,kind)`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/architectureExplorerState.test.ts tests/architectureProjection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/architecture/explorerState.ts src/lib/architecture/project.ts tests/architectureExplorerState.test.ts tests/architectureProjection.test.ts
git commit -m "feat: project architecture explorer state"
```

### Task 4: Add cached ELK layout and graph presentation primitives

**Files:**
- Create: `src/lib/architecture/layout.ts`
- Create: `src/components/architecture/ArchitectureNode.tsx`
- Create: `src/components/architecture/ArchitectureEdge.tsx`
- Create: `src/components/architecture/ArchitectureLegend.tsx`
- Test: `tests/architectureLayout.test.ts`
- Test: `tests/architectureSemantics.test.ts`

**Interfaces:**
- Consumes projected nodes/edges from Task 3.
- Produces `layoutArchitecture(projection, profile): Promise<LayoutResult>` with deterministic cache keys and React Flow node/edge adapters.

- [ ] **Step 1: Write failing layout and accessibility-contract tests**

Test stable cache keys, parent-before-child ELK input, orthogonal routing options, non-overlapping returned node coordinates, and every edge kind's label, dash pattern, and marker descriptor.

```ts
expect(edgeAppearance.approval.label).toBe("Human approval");
expect(edgeAppearance.telemetry.dash).toBeTruthy();
expect(layoutCacheKey(projection, profile)).toBe(layoutCacheKey(projection, profile));
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/architectureLayout.test.ts tests/architectureSemantics.test.ts`

Expected: FAIL because layout and presentation modules do not exist.

- [ ] **Step 3: Implement the layout adapter and semantic primitives**

Configure ELK layered layout with `RIGHT` direction, orthogonal routing, fixed node sizes, hierarchy handling, and spacing. Cache promises by structural signature. Map domain nodes into compact blueprint cards and semantic edges into accessible labeled React Flow edges. Keep palette constants centralized in the architecture node/edge modules.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/architectureLayout.test.ts tests/architectureSemantics.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/architecture/layout.ts src/components/architecture/ArchitectureNode.tsx src/components/architecture/ArchitectureEdge.tsx src/components/architecture/ArchitectureLegend.tsx tests/architectureLayout.test.ts tests/architectureSemantics.test.ts
git commit -m "feat: lay out architecture graph with ELK"
```

### Task 5: Build the interactive explorer, details, and mobile fallback test-first

**Files:**
- Create: `src/components/architecture/ArchitectureExplorer.tsx`
- Create: `src/components/architecture/ArchitectureToolbar.tsx`
- Create: `src/components/architecture/ArchitectureDetails.tsx`
- Create: `src/components/architecture/ArchitectureMobileTree.tsx`
- Create: `src/components/architecture/detailModel.ts`
- Test: `tests/architectureInteraction.test.ts`
- Test: `tests/architectureAccessibility.test.ts`

**Interfaces:**
- Consumes dataset, projection, URL state, layout, and presentation primitives.
- Produces `ArchitectureExplorer` client component and `buildArchitectureDetail(node, definition)` view model.

- [ ] **Step 1: Write failing interaction and accessible-output tests**

Test toolbar actions, preset selection, selected-node details, copyable URL state, responsive-mode choice, required accessible names, focus return metadata, live-region messages, and mobile hierarchical output. Keep DOM-independent interaction reducers pure where browser rendering is unnecessary.

```ts
expect(buildArchitectureDetail(node("agent-temi"), definition).authorityNote).toMatch(/proposes.*does not execute/i);
expect(getResponsiveMode(639)).toBe("tree");
expect(getResponsiveMode(1280)).toBe("graph");
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- tests/architectureInteraction.test.ts tests/architectureAccessibility.test.ts`

Expected: FAIL because explorer components and view models do not exist.

- [ ] **Step 3: Implement toolbar, graph shell, detail drawer, and mobile tree**

Use React Flow controls for zoom/pan/fit, a usable minimap, memoized projection and layout, URL updates through `router.replace`, an updating-layout overlay, labeled filter chips, preset selector, expand/collapse actions, persistent legend, and `aria-live` search/filter summaries. Desktop uses the graph; mobile uses the tree. Both invoke the same selection and detail state.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/architectureInteraction.test.ts tests/architectureAccessibility.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/architecture tests/architectureInteraction.test.ts tests/architectureAccessibility.test.ts
git commit -m "feat: add interactive architecture explorer"
```

### Task 6: Integrate the authenticated route, navigation, and visual system

**Files:**
- Create: `src/app/dashboard/architecture/page.tsx`
- Create: `src/app/dashboard/architecture/architecture.css`
- Modify: `src/components/NavRail.tsx`
- Modify: `src/components/icons.tsx`
- Test: `tests/architectureRoute.test.ts`

**Interfaces:**
- Produces navigable `/dashboard/architecture` page and `ArchitectureIcon`.
- Preserves the existing dashboard frame, authentication boundary, chat drawer, and navigation conventions.

- [ ] **Step 1: Write failing route/navigation contract tests**

Read the route, nav, and stylesheet sources and assert the route exports the explorer, the nav links to `/dashboard/architecture`, the active-state logic supports nested architecture paths, the blueprint tokens and narrow-screen breakpoint exist, and the static blueprint is not used as a graph background.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npm test -- tests/architectureRoute.test.ts`

Expected: FAIL because the route and navigation item do not exist.

- [ ] **Step 3: Implement the route and Harmonia-specific styling**

Create the full-height route, import React Flow styles plus the focused architecture stylesheet, add the nav icon/item, and use dark navy, cyan, violet, amber, green, red, and gray tokens with high-contrast focus treatment. Keep the existing generated PNG available only as a downloadable visual reference link in details/help, never as the canvas background.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- tests/architectureRoute.test.ts`

Expected: PASS.

- [ ] **Step 5: Start the existing development server and open the meaningful preview**

Run: `npm run dev`

Force one successful request to `/dashboard/architecture`, then open that exact local URL in Codex. Do not perform browser interaction testing unless separately requested.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/architecture src/components/NavRail.tsx src/components/icons.tsx tests/architectureRoute.test.ts
git commit -m "feat: expose architecture explorer in dashboard"
```

### Task 7: Add and integrate public explorer documentation

**Files:**
- Create: `docs/architecture-explorer.mdx`
- Modify: `docs/docs.json`
- Modify: `docs/architecture.mdx`
- Test: `tests/architectureExplorerDocs.test.ts`

**Interfaces:**
- Produces the Overview navigation entry and cross-links between the explorer and existing deep documentation.

- [ ] **Step 1: Write failing documentation contract tests**

Assert navigation inclusion and required sections for navigation, edge semantics, authority, workflow, state, effects, skills/tools, models, APIs, observability, statuses, dataset maintenance, validation, accessibility, and links to all eight deeper pages.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npm test -- tests/architectureExplorerDocs.test.ts`

Expected: FAIL because the new MDX page and navigation entry do not exist.

- [ ] **Step 3: Write the entry-point documentation and cross-links**

Document how to open and use the explorer, how its semantics map to the implementation, and how developers safely update the dataset. Link to existing detailed pages without duplicating their bodies. Add a prominent interactive-explorer link from `architecture.mdx`.

- [ ] **Step 4: Run focused test and confirm GREEN**

Run: `npm test -- tests/architectureExplorerDocs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture-explorer.mdx docs/docs.json docs/architecture.mdx tests/architectureExplorerDocs.test.ts
git commit -m "docs: document architecture explorer"
```

### Task 8: Full requirements audit and verification

**Files:**
- Modify only files required to fix failures found by the commands below.

**Interfaces:**
- Consumes every prior task and produces fresh completion evidence.

- [ ] **Step 1: Run all architecture-focused tests**

Run: `npm test -- tests/architectureSchema.test.ts tests/architectureData.test.ts tests/architectureExplorerState.test.ts tests/architectureProjection.test.ts tests/architectureLayout.test.ts tests/architectureSemantics.test.ts tests/architectureInteraction.test.ts tests/architectureAccessibility.test.ts tests/architectureRoute.test.ts tests/architectureExplorerDocs.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 2: Run the complete web test suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 3: Run TypeScript, lint, and production build**

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0 with zero errors.

Run: `npm run build`

Expected: exit 0 and `/dashboard/architecture` appears in the route output.

- [ ] **Step 4: Audit acceptance criteria against code and tests**

Confirm navigation and docs links, every required node family, progressive expansion, search/filter/preset/selection, URL restoration, edge accessibility, approval and verification separation, Firestore/Agent Engine state ownership, pending-live status, keyboard names, and mobile fallback. Record any gap as a failing test before fixing it.

- [ ] **Step 5: Inspect final diff and repository hygiene**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; do not stage or alter pre-existing untracked `.superpowers/`, `public/architecture/`, or `public/brand/` assets unless they are explicitly part of a prior user change.

- [ ] **Step 6: Commit verification fixes if any**

```bash
git add <only files changed for verified fixes>
git commit -m "fix: complete architecture explorer verification"
```
