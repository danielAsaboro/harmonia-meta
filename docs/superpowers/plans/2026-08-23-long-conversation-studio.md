# Harmonia Long-Conversation Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard’s stacked chat cards with a production-grade long-conversation studio: conversation at two fifths, living cross-media canvas at three fifths, and the existing trusted approval boundary integrated across both.

**Architecture:** Keep the existing chat stream, replay, Firestore history, job detail, asset, and decision APIs. Add pure selectors that derive chapters, active jobs, artifact groups, summaries, and trace links from persisted data; then render those view models through a split `StudioShell`, focused conversation components, cross-media canvas workspaces, and a trusted approval dock. `ChatConsole` remains the state orchestrator but delegates visual rendering to focused studio components.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 5, Tailwind CSS 4, Zod 4, Google A2UI React/web core v0.9 compatibility exports, Firestore, Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-23-long-conversation-studio-design.md`

## Global Constraints

- Execute directly on `main`; preserve the existing unrelated modifications to `package.json`, `package-lock.json`, `src/components/landing/`, and `tests/landingWorkflow.test.ts`.
- The desktop workspace default is exactly conversation `2fr` and canvas `3fr`, outside the navigation rail.
- Add no frontend framework or component-library dependency.
- Use only persisted messages, validated stream events, jobs, actions, assets, receipts, and source references; never manufacture successful media, model execution, approval, or verification state.
- Completed agent activity is collapsed; active work, failures, and unresolved decisions are expanded; hidden chain-of-thought is never rendered.
- Written content, images, memes, clips, reels, Veo outputs, Lyria/audio outputs, sources, cost, policy, approval, and verification are first-class where real records exist.
- Public chat payloads, Firestore job documents, Pub/Sub messages, action IDs, receipts, Telegram, publishing, and approval semantics remain unchanged.
- Creation-mode shortcuts submit through the existing chat stream and coordinator; the browser never invokes a model or publishing provider directly.
- Every behavior change follows red-green-refactor TDD and ends in a focused commit.

---

### Task 1: Derive long-conversation chapters and working-set identity

**Files:**
- Create: `src/lib/studio/conversationModel.ts`
- Test: `tests/studioConversationModel.test.ts`

**Interfaces:**
- Consumes: `ConsoleMessage` from `src/lib/chatSessions.ts`, `ChatRunState` from `src/lib/a2ui/chatReducer.ts`, and the optional `ChatResponse` stored on each message.
- Produces:
  - `type StudioChapterKey = "discovery" | "narrative" | "production" | "approval"`
  - `interface StudioConversationMessage extends ConsoleMessage { run?: ChatRunState }`
  - `interface StudioChapter { key: StudioChapterKey; label: string; messages: StudioConversationMessage[]; summary: string }`
  - `chapterForExchange(user, assistant): StudioChapterKey`
  - `buildStudioChapters(messages): StudioChapter[]`
  - `activeJobIdForConversation(messages): string | null`
  - `referencedJobIds(messages): string[]`

- [ ] **Step 1: Write failing selector tests with literal persisted exchanges**

```ts
import { describe, expect, it } from "vitest";
import {
  activeJobIdForConversation,
  buildStudioChapters,
} from "../src/lib/studio/conversationModel";

describe("studio conversation model", () => {
  it("groups complete exchanges without dropping operator messages", () => {
    const messages = [
      { role: "user" as const, text: "What is trending?", at: "2026-08-23T08:00:00.000Z" },
      { role: "assistant" as const, text: "Two signals are relevant.", data: { intent: "status", reply: "" }, at: "2026-08-23T08:00:01.000Z" },
      { role: "user" as const, text: "Draft the founder take.", at: "2026-08-23T08:01:00.000Z" },
      { role: "assistant" as const, text: "One reviewed draft.", data: { intent: "list_drafts", reply: "", jobId: "job-1", drafts: [] }, at: "2026-08-23T08:01:01.000Z" },
      { role: "user" as const, text: "Approve it.", at: "2026-08-23T08:02:00.000Z" },
      { role: "assistant" as const, text: "Approval recorded.", data: { intent: "approve", reply: "", jobId: "job-1" }, at: "2026-08-23T08:02:01.000Z" },
    ];
    const chapters = buildStudioChapters(messages);
    expect(chapters.map(({ key, messages }) => [key, messages.length])).toEqual([
      ["discovery", 2],
      ["narrative", 2],
      ["approval", 2],
    ]);
    expect(chapters.flatMap((chapter) => chapter.messages)).toHaveLength(6);
  });

  it("selects the latest persisted job reference", () => {
    expect(activeJobIdForConversation([
      { role: "assistant", text: "old", data: { intent: "status", reply: "", jobId: "job-old" } },
      { role: "assistant", text: "new", data: { intent: "create_job", reply: "", job: { id: "job-new", stage: "draft", status: "running" } } },
    ])).toBe("job-new");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npx vitest run tests/studioConversationModel.test.ts`

Expected: FAIL because `src/lib/studio/conversationModel.ts` does not exist.

- [ ] **Step 3: Implement deterministic exchange classification and summaries**

```ts
export function chapterForExchange(
  user: StudioConversationMessage | undefined,
  assistant: StudioConversationMessage | undefined,
): StudioChapterKey {
  const data = assistant?.data;
  if (data?.intent === "approve" || data?.pendingActions?.length || assistant?.run?.confirmations.length) return "approval";
  if (data?.intent === "list_drafts" || data?.drafts?.length) return "narrative";
  if (data?.intent === "create_job" || data?.assets?.length || assistant?.run?.jobUpdates.length) return "production";
  return "discovery";
}

function summaryFor(key: StudioChapterKey, messages: StudioConversationMessage[]): string {
  const firstRequest = messages.find((message) => message.role === "user")?.text ?? "No operator request";
  const jobs = referencedJobIds(messages);
  return `${messages.length} turns · ${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${firstRequest.slice(0, 96)}`;
}
```

Build exchanges by pairing each user message with the following assistant message. Classify the pair from the assistant’s persisted result, append both messages to the same chapter, preserve original order, and retain unpaired messages in the preceding chapter or `discovery` when no chapter exists.

- [ ] **Step 4: Run the selector tests**

Run: `npx vitest run tests/studioConversationModel.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the conversation model**

```bash
git add src/lib/studio/conversationModel.ts tests/studioConversationModel.test.ts
git commit -m "feat: derive studio conversation chapters"
```

### Task 2: Derive the cross-media working-set model

**Files:**
- Create: `src/lib/studio/workspaceModel.ts`
- Test: `tests/studioWorkspaceModel.test.ts`

**Interfaces:**
- Consumes: `JobFull` from `src/components/jobTypes.ts`, `TimelineEvent`, and `Receipt`.
- Produces:
  - `type StudioMediaKind = "visual" | "motion" | "audio"`
  - `interface StudioAsset { actionId: string; kind: StudioMediaKind; mime: string; title: string; sizeBytes: number; provider?: "veo" | "lyria" }`
  - `interface TraceLink { draftId?: string; momentId?: string; angleId?: string; sourceSegmentIds: string[]; valid: boolean; error?: string }`
  - `interface StudioWorkspaceModel { written; visual; motion; audio; sources; pendingActions; failedActions; verifiedCount; traceLinks }`
  - `buildStudioWorkspace(job, receipts): StudioWorkspaceModel`

- [ ] **Step 1: Write failing media-group and trace-validation tests**

```ts
import { describe, expect, it } from "vitest";
import { buildStudioWorkspace } from "../src/lib/studio/workspaceModel";

describe("studio workspace model", () => {
  it("groups only persisted artifacts by action and MIME", () => {
    const model = buildStudioWorkspace({
      id: "job-1", status: "complete", stage: "complete", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { platforms: ["x"] }, transcriptSegments: [], moments: [], angles: [], drafts: [],
      actions: [
        { id: "img", jobId: "job-1", type: "generate_image", title: "Launch visual", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
        { id: "sound", jobId: "job-1", type: "generate_music", title: "Launch score", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
      ],
      assets: [
        { actionId: "img", mime: "image/png", sizeBytes: 1200, digest: "a" },
        { actionId: "sound", mime: "audio/mpeg", sizeBytes: 2400, digest: "b" },
      ],
    }, []);
    expect(model.visual.map((asset) => asset.actionId)).toEqual(["img"]);
    expect(model.audio.map((asset) => [asset.actionId, asset.provider])).toEqual([["sound", "lyria"]]);
    expect(model.motion).toEqual([]);
  });

  it("marks a draft reference invalid when its moment is absent", () => {
    const model = buildStudioWorkspace({
      id: "job-2", status: "complete", stage: "complete", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { platforms: ["x"] }, transcriptSegments: [], moments: [], angles: [],
      drafts: [{ id: "d1", platform: "x", text: "Grounded claim", valid: true, momentId: "missing" }], actions: [], assets: [],
    }, []);
    expect(model.traceLinks).toEqual([expect.objectContaining({ draftId: "d1", valid: false, error: "moment missing not found" })]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npx vitest run tests/studioWorkspaceModel.test.ts`

Expected: FAIL because `workspaceModel.ts` does not exist.

- [ ] **Step 3: Implement action-aware grouping without inferring model execution**

```ts
const providerFor = (type: PlannedAction["type"]) =>
  type === "generate_video" ? "veo" : type === "generate_music" ? "lyria" : undefined;

const kindForMime = (mime: string): StudioMediaKind | null =>
  mime.startsWith("image/") ? "visual" : mime.startsWith("video/") ? "motion" : mime.startsWith("audio/") ? "audio" : null;

const sourceSegmentsForMoment = (job: JobFull, momentId: string): string[] => {
  const moment = job.moments.find((candidate) => candidate.id === momentId);
  if (!moment) return [];
  return job.transcriptSegments
    .filter((segment) => segment.startSec < moment.endSec && segment.endSec > moment.startSec)
    .map((segment) => segment.id);
};
```

Join every asset to its existing action. Omit assets with unsupported MIME from media arrays but retain them in `sources`. Set `provider` only from a matching `generate_video` or `generate_music` action. Validate every draft `momentId` and action `momentId` against the job’s real moment IDs.

- [ ] **Step 4: Run the working-set tests**

Run: `npx vitest run tests/studioWorkspaceModel.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the working-set model**

```bash
git add src/lib/studio/workspaceModel.ts tests/studioWorkspaceModel.test.ts
git commit -m "feat: derive cross-media studio workspace"
```

### Task 3: Build the responsive 2:3 studio shell and dashboard frame

**Files:**
- Create: `src/components/DashboardFrame.tsx`
- Create: `src/components/studio/StudioShell.tsx`
- Create: `src/components/studio/StudioStates.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/studioShell.test.ts`

**Interfaces:**
- Consumes: conversation and canvas React nodes.
- Produces:
  - `DEFAULT_CONVERSATION_PERCENT = 40`
  - `clampConversationPercent(value): number` bounded to 32–52
  - `StudioShell({ conversation, canvas, mobilePane, onMobilePaneChange })`
  - `DashboardFrame({ children })` which hides `ChatDrawer` and removes the content max-width only on `/dashboard`.

- [ ] **Step 1: Write failing ratio, separator, and dashboard-frame tests**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampConversationPercent, StudioShell } from "../src/components/studio/StudioShell";

describe("StudioShell", () => {
  it("renders the default desktop split as two fifths and three fifths", () => {
    const html = renderToStaticMarkup(createElement(StudioShell, {
      conversation: createElement("div", null, "Conversation"),
      canvas: createElement("div", null, "Canvas"),
      mobilePane: "conversation",
      onMobilePaneChange: () => {},
    }));
    expect(html).toContain("--studio-conversation:2fr");
    expect(html).toContain("--studio-canvas:3fr");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="40"');
  });

  it("clamps resized conversation widths", () => {
    expect(clampConversationPercent(20)).toBe(32);
    expect(clampConversationPercent(44)).toBe(44);
    expect(clampConversationPercent(80)).toBe(52);
  });
});
```

- [ ] **Step 2: Run the shell test and confirm the missing-module failure**

Run: `npx vitest run tests/studioShell.test.ts`

Expected: FAIL because `StudioShell.tsx` does not exist.

- [ ] **Step 3: Implement the default ratio and accessible resize behavior**

Use this desktop grid contract in `StudioShell`:

```tsx
<section
  className="studio-grid h-dvh min-h-[720px] overflow-hidden"
  style={conversationPercent === 40 ? {
    "--studio-conversation": "2fr",
    "--studio-canvas": "3fr",
  } as React.CSSProperties : {
    "--studio-conversation": `${conversationPercent}fr`,
    "--studio-canvas": `${100 - conversationPercent}fr`,
  } as React.CSSProperties}
>
```

In `globals.css`, define:

```css
.studio-grid {
  display: grid;
  grid-template-columns: minmax(360px, var(--studio-conversation)) 6px minmax(540px, var(--studio-canvas));
}
@media (max-width: 1023px) {
  .studio-grid { display: block; }
}
```

The separator supports pointer drag, Left/Right arrows in two-point increments, Home to reset to 40, and stores only the presentation preference in `localStorage` under `harmonia:studio-split`.

- [ ] **Step 4: Implement the route-aware dashboard frame**

`DashboardFrame` uses `usePathname()`. On `/dashboard`, render a full-width, full-height main region and omit the floating `ChatDrawer`; on all other dashboard routes, preserve `mx-auto max-w-6xl` and render `ChatDrawer` exactly once.

- [ ] **Step 5: Run the shell tests and TypeScript**

Run: `npx vitest run tests/studioShell.test.ts && npx tsc --noEmit`

Expected: PASS and exit 0.

- [ ] **Step 6: Commit the shell**

```bash
git add src/components/DashboardFrame.tsx src/components/studio/StudioShell.tsx src/components/studio/StudioStates.tsx src/app/dashboard/layout.tsx src/app/globals.css tests/studioShell.test.ts
git commit -m "feat: add responsive studio shell"
```

### Task 4: Build the chaptered long-conversation pane

**Files:**
- Create: `src/components/studio/ConversationPane.tsx`
- Create: `src/components/studio/ConversationTurn.tsx`
- Create: `src/components/studio/AgentRunSummary.tsx`
- Create: `src/components/studio/StudioComposer.tsx`
- Test: `tests/studioConversationElements.test.ts`

**Interfaces:**
- Consumes: `StudioChapter[]`, current streaming `ChatRunState`, attachments, busy state, and callbacks for send, artifact activation, job activation, and operation decisions.
- Produces:
  - `ConversationPane` with chapter navigation, local search, collapsed earlier turns, “return to latest,” and sticky composer.
  - `ConversationTurn` variants for operator, assistant, artifact reference, decision checkpoint, and replay failure.
  - `AgentRunSummary` with completed state collapsed by default and active/failed state open.

- [ ] **Step 1: Write failing static behavior tests**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentRunSummary } from "../src/components/studio/AgentRunSummary";
import { ConversationTurn } from "../src/components/studio/ConversationTurn";
import { initialChatRunState } from "../src/lib/a2ui/chatReducer";

describe("studio conversation elements", () => {
  it("collapses completed activity but opens failures", () => {
    const complete = { ...initialChatRunState("r1"), status: "complete" as const, text: "Done" };
    const failed = { ...initialChatRunState("r2"), status: "failed" as const, error: "provider unavailable" };
    expect(renderToStaticMarkup(createElement(AgentRunSummary, { run: complete }))).not.toContain("<details open");
    expect(renderToStaticMarkup(createElement(AgentRunSummary, { run: failed }))).toContain("<details open");
  });

  it("renders artifact references as real canvas targets", () => {
    const html = renderToStaticMarkup(createElement(ConversationTurn, {
      message: { role: "assistant", text: "Draft ready", data: { intent: "list_drafts", reply: "", jobId: "job-1", drafts: [{ id: "d1", platform: "x", text: "Ship it", valid: true }] } },
      onActivateArtifact: () => {},
    }));
    expect(html).toContain('data-artifact-id="draft:d1"');
    expect(html).toContain("Ship it");
  });
});
```

- [ ] **Step 2: Run the element test and confirm the missing-module failure**

Run: `npx vitest run tests/studioConversationElements.test.ts`

Expected: FAIL because the studio conversation components do not exist.

- [ ] **Step 3: Implement focused turn renderers**

Move the current message, attachment, activity, tool, confirmation, job-card, draft, asset, and error rendering out of `ChatConsole`. Completed turn wrappers use `content-visibility: auto` and `contain-intrinsic-size: auto 180px` so the browser skips offscreen layout without removing messages from search or accessibility trees.

`AgentRunSummary` must render only `run.activities`, sanitized `run.tools`, safe reasoning-summary A2UI components, terminal status, duration where present, and replay errors. It must not render raw operation JSON.

```tsx
<details open={run.status !== "complete"} className="studio-agent-run">
  <summary>{run.status === "running" ? "Harmonia is working" : run.status === "failed" ? "Agent run failed" : "Agent run complete"}</summary>
  {run.activities.length > 0 && <ActivityTrace title="Activity summary" steps={run.activities} />}
  {run.tools.map((tool) => <ToolActivity key={tool.traceId ?? tool.name} {...tool} />)}
  {run.error && <StudioFailure message={run.error} permanent={run.permanent} />}
</details>
```

- [ ] **Step 4: Implement chapter navigation, search, and sticky composer**

`ConversationPane` maintains `activeChapter`, `query`, and `expandedSummary` state. Chapter buttons scroll to elements with IDs `chapter-discovery`, `chapter-narrative`, `chapter-production`, and `chapter-approval`. Search filters copies of the visible groups but never mutates `messages`. When the scroll region is more than 240 pixels from its bottom, show a “Return to latest” button.

`StudioComposer` reuses `AttachmentComposer` and the existing send callback. Mode chips only prefix or annotate the prompt submitted to `chat.send`; they do not call providers.

- [ ] **Step 5: Run component tests, lint the new files, and run TypeScript**

Run: `npx vitest run tests/studioConversationElements.test.ts tests/a2uiElements.test.ts && npx eslint src/components/studio/ConversationPane.tsx src/components/studio/ConversationTurn.tsx src/components/studio/AgentRunSummary.tsx src/components/studio/StudioComposer.tsx && npx tsc --noEmit`

Expected: all exit 0.

- [ ] **Step 6: Commit the conversation pane**

```bash
git add src/components/studio/ConversationPane.tsx src/components/studio/ConversationTurn.tsx src/components/studio/AgentRunSummary.tsx src/components/studio/StudioComposer.tsx tests/studioConversationElements.test.ts
git commit -m "feat: build long-conversation studio pane"
```

### Task 5: Build the living cross-media canvas

**Files:**
- Create: `src/components/studio/WorkingCanvas.tsx`
- Create: `src/components/studio/ArtifactBoard.tsx`
- Create: `src/components/studio/WrittenWorkspace.tsx`
- Create: `src/components/studio/MediaWorkspace.tsx`
- Create: `src/components/studio/SourcesWorkspace.tsx`
- Test: `tests/studioCanvas.test.ts`

**Interfaces:**
- Consumes: `JobFull`, events, receipts, `StudioWorkspaceModel`, selected view, selected artifact ID, job-loading error, and retry/open callbacks.
- Produces: Board, Written, Visual, Motion, Audio, and Sources views with real persisted data and truthful empty/failure states.

- [ ] **Step 1: Write failing cross-media rendering tests**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaWorkspace } from "../src/components/studio/MediaWorkspace";

describe("studio canvas", () => {
  it("renders native audio only for a persisted audio asset", () => {
    const html = renderToStaticMarkup(createElement(MediaWorkspace, {
      kind: "audio",
      jobId: "job-1",
      assets: [{ actionId: "sound", kind: "audio", mime: "audio/mpeg", title: "Launch score", sizeBytes: 2400, provider: "lyria" }],
      selectedArtifactId: null,
      onSelect: () => {},
    }));
    expect(html).toContain("<audio");
    expect(html).toContain("Lyria");
    expect(html).toContain("/api/jobs/job-1/assets/sound");
  });

  it("shows an honest generated-video empty state", () => {
    const html = renderToStaticMarkup(createElement(MediaWorkspace, {
      kind: "motion", jobId: "job-1", assets: [], selectedArtifactId: null, onSelect: () => {},
    }));
    expect(html).toContain("No motion asset exists for this working set");
    expect(html).not.toContain("Veo generated");
  });
});
```

- [ ] **Step 2: Run the canvas test and confirm the missing-module failure**

Run: `npx vitest run tests/studioCanvas.test.ts`

Expected: FAIL because the canvas components do not exist.

- [ ] **Step 3: Implement Board and Written views**

`ArtifactBoard` presents the real job title/brief, stage, persisted summary, artifact counts, current draft, pending decision count, and the graph of valid trace links. It must replace graph edges with an inline protocol error when `TraceLink.valid` is false.

`WrittenWorkspace` renders every persisted X draft, its `valid` state, character count, source moment/angle when valid, and selected styling. It does not invent draft variants; when only one draft exists, it renders one draft.

- [ ] **Step 4: Implement media and source views**

`MediaWorkspace` uses native `img`, `video`, and `audio` controls with authorized `/api/jobs/{jobId}/assets/{actionId}` routes. Provider labels appear only from `StudioAsset.provider`. `SourcesWorkspace` renders real transcript segments, timestamped moments, angle rationales, citations, receipts, and verification links.

```tsx
const src = `/api/jobs/${jobId}/assets/${asset.actionId}`;
return asset.mime.startsWith("image/") ? (
  <img src={src} alt={asset.title} />
) : asset.mime.startsWith("video/") ? (
  <video src={src} controls aria-label={asset.title} />
) : asset.mime.startsWith("audio/") ? (
  <audio src={src} controls aria-label={asset.title} />
) : null;
```

`WorkingCanvas` exposes tab buttons with counts, independently renders loading/failure/empty states, and focuses `[data-canvas-artifact={selectedArtifactId}]` after a valid conversation artifact selection.

- [ ] **Step 5: Run canvas tests, lint, and TypeScript**

Run: `npx vitest run tests/studioCanvas.test.ts tests/studioWorkspaceModel.test.ts && npx eslint src/components/studio/WorkingCanvas.tsx src/components/studio/ArtifactBoard.tsx src/components/studio/WrittenWorkspace.tsx src/components/studio/MediaWorkspace.tsx src/components/studio/SourcesWorkspace.tsx && npx tsc --noEmit`

Expected: all exit 0.

- [ ] **Step 6: Commit the living canvas**

```bash
git add src/components/studio/WorkingCanvas.tsx src/components/studio/ArtifactBoard.tsx src/components/studio/WrittenWorkspace.tsx src/components/studio/MediaWorkspace.tsx src/components/studio/SourcesWorkspace.tsx tests/studioCanvas.test.ts
git commit -m "feat: add cross-media working canvas"
```

### Task 6: Route validated A2UI content into conversation and canvas regions

**Files:**
- Create: `src/lib/a2ui/studioRegions.ts`
- Modify: `src/components/a2ui/HarmoniaCatalog.tsx`
- Modify: `src/components/studio/AgentRunSummary.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/a2uiStudioRegions.test.ts`

**Interfaces:**
- Consumes: validated A2UI operations from `ChatRunState.operations`.
- Produces:
  - `type StudioA2uiRegion = "conversation" | "canvas" | "approval"`
  - `partitionStudioOperations(runId, operations): Record<StudioA2uiRegion, unknown[]>`
  - Region-specific trusted `HarmoniaA2uiHost` instances.

- [ ] **Step 1: Write a failing region-partition test**

```ts
import { describe, expect, it } from "vitest";
import { buildDemoChatRunEvents } from "../scripts/demo-a2ui-events.mjs";
import { partitionStudioOperations } from "../src/lib/a2ui/studioRegions";

it("places validated A2UI components by product role", () => {
  const operations = buildDemoChatRunEvents({
    runId: "r1", startedAt: "2026-08-23T00:00:00.000Z", completedAt: "2026-08-23T00:00:01.000Z",
    jobId: "job-1", confirmationJobId: "job-2", confirmationActionId: "action-1",
    imageSizeBytes: 1, clipSizeBytes: 1, reelSizeBytes: 1,
  }).filter((event: { type: string }) => event.type === "a2ui_operation").map((event: { operation: unknown }) => event.operation);
  const regions = partitionStudioOperations("r1", operations);
  expect(JSON.stringify(regions.conversation)).toContain("ReasoningSummary");
  expect(JSON.stringify(regions.canvas)).toContain("AttachmentCard");
  expect(JSON.stringify(regions.approval)).toContain("Confirmation");
  expect(JSON.stringify(regions.conversation)).not.toContain("Confirmation");
});
```

- [ ] **Step 2: Run the partition test and confirm the missing-module failure**

Run: `npx vitest run tests/a2uiStudioRegions.test.ts`

Expected: FAIL because `studioRegions.ts` does not exist.

- [ ] **Step 3: Implement strict region partitioning**

Call `parseHarmoniaA2uiOperation` before reading any component. Map `ReasoningSummary`, `ActivityTrace`, and `ToolActivity` to conversation; `AttachmentCard`, `TaskView`, `PlanView`, `QueueView`, `InlineCitation`, and `ContextUsage` to canvas; and `Confirmation` to approval. `MessageContent` remains host-rendered from the persisted assistant text and is not duplicated.

```ts
const REGION_BY_COMPONENT: Record<string, StudioA2uiRegion | "host"> = {
  MessageContent: "host",
  ReasoningSummary: "conversation",
  ActivityTrace: "conversation",
  ToolActivity: "conversation",
  AttachmentCard: "canvas",
  TaskView: "canvas",
  PlanView: "canvas",
  QueueView: "canvas",
  InlineCitation: "canvas",
  ContextUsage: "canvas",
  Confirmation: "approval",
};
```

For each region, emit a new region-specific `createSurface` plus `updateComponents` operation with a `Column` root containing only that region’s component IDs. Reject dangling child IDs, duplicate component IDs, and unknown components.

- [ ] **Step 4: Render each partition through the official trusted host**

Use `HarmoniaA2uiHost` for conversation and canvas partitions. The approval partition supplies display metadata to `ApprovalDock`, but the decision callback remains bound to a real server action or pending-operation ID through the existing host `onAction` validation.

- [ ] **Step 5: Run A2UI suites and TypeScript**

Run: `npx vitest run tests/a2uiStudioRegions.test.ts tests/a2uiSurface.test.ts tests/a2uiContracts.test.ts tests/demoA2uiRun.test.ts && npx tsc --noEmit`

Expected: all pass and exit 0.

- [ ] **Step 6: Commit regional A2UI placement**

```bash
git add src/lib/a2ui/studioRegions.ts src/components/a2ui/HarmoniaCatalog.tsx src/components/studio/AgentRunSummary.tsx src/components/studio/WorkingCanvas.tsx tests/a2uiStudioRegions.test.ts
git commit -m "feat: place A2UI across studio regions"
```

### Task 7: Build the trusted approval dock

**Files:**
- Create: `src/components/studio/ApprovalDock.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/studioApprovalDock.test.ts`

**Interfaces:**
- Consumes: active `JobFull`, A2UI approval-region metadata, decision callback, busy state, receipts, and verification records.
- Produces: persistent dock showing only real pending actions, exact cost/policy/evidence state, and trusted decision controls.

- [ ] **Step 1: Write failing approval boundary tests**

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalDock } from "../src/components/studio/ApprovalDock";

it("renders controls only for real pending planned actions", () => {
  const html = renderToStaticMarkup(createElement(ApprovalDock, {
    jobId: "job-1",
    actions: [
      { id: "pending", jobId: "job-1", type: "publish_x_post", title: "Publish", description: "", risk: "high", requiresApproval: true, approvalState: "pending", payload: {}, state: "planned" },
      { id: "done", jobId: "job-1", type: "generate_image", title: "Image", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
    ],
    verifications: [], receipts: [], busy: false, onDecide: async () => {},
  }));
  expect(html).toContain('data-action-id="pending"');
  expect(html).not.toContain('data-action-id="done"');
  expect(html).toContain("Publishing remains blocked");
});
```

- [ ] **Step 2: Run the dock test and confirm the missing-module failure**

Run: `npx vitest run tests/studioApprovalDock.test.ts`

Expected: FAIL because `ApprovalDock.tsx` does not exist.

- [ ] **Step 3: Implement real pending-action review**

Filter actions to `approvalState === "pending" && state === "planned"`. Show the exact action title, type, risk, description, relevant draft/media preview, verified evidence count, and cost only when current records provide it. The collapsed dock shows count and types; “Review” opens the full decision sheet. Approve and Reject call `onDecide(jobId, actionId, decision)` and disable both buttons while busy.

```tsx
const pending = actions.filter((action) => action.approvalState === "pending" && action.state === "planned");
if (pending.length === 0) return null;
return pending.map((action) => (
  <section key={action.id} data-action-id={action.id}>
    <h3>{action.title}</h3>
    <p>Publishing remains blocked until you decide.</p>
    <button disabled={busy} onClick={() => void onDecide(jobId, action.id, "approved")}>Approve</button>
    <button disabled={busy} onClick={() => void onDecide(jobId, action.id, "rejected")}>Reject</button>
  </section>
));
```

- [ ] **Step 4: Refresh the dock from real decision results**

After `onDecide` resolves, `ChatConsole` refetches `/api/jobs/{jobId}`. The dock disappears only when the returned job no longer contains pending planned actions. Append the existing assistant decision acknowledgment to conversation history without synthesizing a receipt.

- [ ] **Step 5: Run approval, policy, and tenancy tests**

Run: `npx vitest run tests/studioApprovalDock.test.ts tests/policy.test.ts tests/tenancy.test.ts tests/pendingOperations.test.ts && npx tsc --noEmit`

Expected: all pass and exit 0.

- [ ] **Step 6: Commit the approval dock**

```bash
git add src/components/studio/ApprovalDock.tsx src/components/studio/WorkingCanvas.tsx tests/studioApprovalDock.test.ts
git commit -m "feat: add trusted studio approval dock"
```

### Task 8: Integrate the studio into ChatConsole without regressing streaming

**Files:**
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/lib/chatSessions.ts`
- Modify: `src/app/dashboard/page.tsx`
- Test: `tests/chatSessions.test.ts`
- Test: `tests/studioIntegration.test.ts`

**Interfaces:**
- Consumes: all selectors and components from Tasks 1–7 plus existing `useHarmoniaChat`, history replay, upload, job detail, and decision functions.
- Produces: the complete dashboard studio with current/past sessions, long-thread navigation, live streaming, synchronized active job/artifact, and responsive pane switching.

- [ ] **Step 1: Write failing session identity and active-job integration tests**

```ts
import { describe, expect, it } from "vitest";
import { groupSessions } from "../src/lib/chatSessions";

it("keeps stable message IDs and run state inside grouped sessions", () => {
  const run = { runId: "r1", status: "complete" as const, lastSequence: 1, text: "Done", activities: [], tools: [], operations: [], confirmations: [], jobUpdates: [] };
  const sessions = groupSessions([
    { id: "m1", role: "user", text: "Create launch content", surface: "dashboard", at: "2026-08-23T08:00:00.000Z" },
    { id: "m2", role: "assistant", text: "Created", surface: "dashboard", at: "2026-08-23T08:00:01.000Z", run, data: { intent: "create_job", reply: "", jobId: "job-1" } },
  ]);
  expect(sessions[0].messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  expect(sessions[0].messages[1].run?.runId).toBe("r1");
});
```

`tests/studioIntegration.test.ts` renders a pure `StudioConsoleView` extracted from `ChatConsole` with a hydrated session and job bundle, then asserts that the conversation heading, 2:3 shell, Written tab, persisted asset title, and pending action ID are present.

- [ ] **Step 2: Run the integration tests and confirm expected type/module failures**

Run: `npx vitest run tests/chatSessions.test.ts tests/studioIntegration.test.ts`

Expected: FAIL until `ConsoleMessage` retains `id`/`run` and `StudioConsoleView` exists.

- [ ] **Step 3: Preserve stable message and session data**

Extend `ConsoleMessage` with optional `id`, `attachments`, and `run`. Update the history mapper to retain Firestore message IDs. Continue replaying `chatRunId` through `historyRunState`. `groupSessions` must carry object identity and all optional fields without cloning them away.

- [ ] **Step 4: Replace ChatConsole’s rendering with StudioShell**

Keep the current async behavior: history load, stream send, attachment submission, terminal-run append, operation decisions, action decisions, job detail fetch, retry, and deep linking. Replace `Bubble`, the old history drawer, inline job cards, and the fixed 420-pixel `JobDetail` aside with:

```tsx
<StudioShell
  conversation={<ConversationPane chapters={chapters} currentRun={chat.run} {...conversationCallbacks} />}
  canvas={<WorkingCanvas bundle={detail} activeJobId={activeJobId} selectedArtifactId={selectedArtifactId} {...canvasCallbacks} />}
  mobilePane={mobilePane}
  onMobilePaneChange={setMobilePane}
/>
```

When no job is referenced, the canvas displays the truthful creation invitation and recent persisted jobs. When a job reference changes, abort or ignore stale detail requests so an older response cannot replace the new working set.

- [ ] **Step 5: Synchronize artifact and decision focus**

Conversation artifact selection sets `selectedArtifactId`, activates the matching canvas tab, and focuses the canvas target. Canvas “Show in conversation” finds the stable message ID containing that artifact, selects its chapter, expands its collapsed group, and focuses the turn. Approval selections activate the Approval chapter and dock.

- [ ] **Step 6: Run focused and complete frontend suites**

Run: `npx vitest run tests/chatSessions.test.ts tests/studioIntegration.test.ts tests/chatRunReplay.test.ts tests/chatHistoryReplay.test.ts tests/chatStreamReducer.test.ts tests/chatAttachments.test.ts && npm test`

Expected: focused tests pass; full suite passes with zero failures.

- [ ] **Step 7: Commit the integrated studio**

```bash
git add src/components/ChatConsole.tsx src/lib/chatSessions.ts src/app/dashboard/page.tsx tests/chatSessions.test.ts tests/studioIntegration.test.ts
git commit -m "feat: integrate long-conversation studio"
```

### Task 9: Make the local demo exercise long conversation and every honest UI state

**Files:**
- Create: `scripts/demo-studio-conversation.mjs`
- Create: `scripts/demo-studio-conversation.d.mts`
- Modify: `scripts/seed-demo.mjs`
- Modify: `scripts/demo-a2ui-events.mjs`
- Test: `tests/demoStudioConversation.test.ts`

**Interfaces:**
- Consumes: existing demo jobs, action IDs, real locally rendered assets, and validated chat/A2UI event contracts.
- Produces: a deterministic local-only conversation long enough to show every chapter, collapsed history, current activity, a working set, a replay failure example, and a real pending approval without claiming provider execution.

- [ ] **Step 1: Write a failing demo-shape test**

```ts
import { describe, expect, it } from "vitest";
import { buildDemoStudioConversation } from "../scripts/demo-studio-conversation.mjs";

it("builds a clearly labelled cross-media local conversation", () => {
  const messages = buildDemoStudioConversation({ runId: "demo-a2ui-multimodal" });
  expect(messages.length).toBeGreaterThanOrEqual(24);
  expect(messages.filter((message: { role: string }) => message.role === "user").length).toBeGreaterThanOrEqual(12);
  expect(messages.some((message: { data?: { intent?: string } }) => message.data?.intent === "create_job")).toBe(true);
  expect(messages.some((message: { data?: { intent?: string } }) => message.data?.intent === "list_drafts")).toBe(true);
  expect(messages.some((message: { data?: { pendingActions?: unknown[] } }) => message.data?.pendingActions?.length)).toBe(true);
  expect(JSON.stringify(messages)).toContain("Local demo fixture");
  expect(JSON.stringify(messages)).not.toContain("Veo generated successfully");
});
```

- [ ] **Step 2: Run the demo test and confirm the missing-module failure**

Run: `npx vitest run tests/demoStudioConversation.test.ts`

Expected: FAIL because the demo conversation builder does not exist.

- [ ] **Step 3: Build and seed the long local conversation**

Create 12 operator/assistant exchange pairs spanning Discovery, Narrative, Production, and Approval. Link only the existing `demo-clips` A2UI run and existing `demo-launch` pending publish action. Label fixture-only content in message or context metadata. Do not add a Veo/Lyria receipt or asset unless the seeder generated real bytes and the record explicitly says local fixture rather than provider execution.

```js
export function buildDemoStudioConversation({ runId }) {
  const exchanges = [
    [
      { role: "user", surface: "dashboard", text: "What should we say about outcome-based billing?" },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: two narrative signals are relevant.", data: { intent: "status", reply: "", jobs: [] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Ground that in our onboarding interview too." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the working set references demo-clips.", data: { intent: "status", reply: "", jobId: "demo-clips" } },
    ],
    [
      { role: "user", surface: "dashboard", text: "The angle should feel contrarian, not corporate." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the narrative direction is founder conviction.", data: { intent: "list_drafts", reply: "", jobId: "demo-clips", drafts: [] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Use a founder voice, not pricing-page copy." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: one reviewed X draft is in the working set.", data: { intent: "list_drafts", reply: "", jobId: "demo-clips", drafts: [] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Keep the phrase pay for outcomes, not idle tokens." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the selected draft remains within the X limit.", data: { intent: "list_drafts", reply: "", jobId: "demo-clips", drafts: [] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Now prepare the visual direction." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: persisted image media is available.", data: { intent: "create_job", reply: "", jobId: "demo-clips", assets: [{ actionId: "act-img-demo01", mime: "image/png" }] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Make a short vertical clip from the strongest proof point." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the existing vertical clip is linked.", data: { intent: "create_job", reply: "", chatRunId: runId, jobId: "demo-clips", assets: [{ actionId: "act-clip-demo1", mime: "video/mp4" }] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Show me the image and clip together." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: both persisted assets are in the working set.", data: { intent: "create_job", reply: "", jobId: "demo-clips", assets: [{ actionId: "act-img-demo01", mime: "image/png" }, { actionId: "act-clip-demo1", mime: "video/mp4" }] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "What still needs my decision?" },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: one real seeded publish action awaits review.", data: { intent: "status", reply: "", jobId: "demo-launch", pendingActions: [{ id: "act-pub-launch", title: "Approve launch post", type: "publish_x_post", risk: "high" }] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Show the final draft before I decide." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the persisted launch draft is ready for review.", data: { intent: "list_drafts", reply: "", jobId: "demo-launch", drafts: [] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Keep publishing blocked for now." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: no decision was submitted and publishing remains blocked.", data: { intent: "status", reply: "", jobId: "demo-launch", pendingActions: [{ id: "act-pub-launch", title: "Approve launch post", type: "publish_x_post", risk: "high" }] } },
    ],
    [
      { role: "user", surface: "dashboard", text: "Give me the whole working set and the approval checkpoint." },
      { role: "assistant", surface: "dashboard", text: "Local demo fixture: the working set and real pending action are linked without executing it.", data: { intent: "approve", reply: "", jobId: "demo-launch", pendingActions: [{ id: "act-pub-launch", title: "Approve launch post", type: "publish_x_post", risk: "high" }] } },
    ],
  ];
  return exchanges.flat();
}
```

Replace the SMPTE test-pattern image/video sources with locally rendered branded abstract media using ffmpeg’s color, gradient, geometry, and text filters. Keep the artifacts as real PNG/MP4 bytes in the same asset store, and preserve digest/size verification.

- [ ] **Step 4: Validate and reseed the emulator**

Run:

```bash
npx vitest run tests/demoStudioConversation.test.ts tests/demoA2uiRun.test.ts
DEMO_USER_UID=dev-local-user FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GOOGLE_CLOUD_PROJECT=harmonia-local npm run seed
```

Expected: tests pass; seeder reports at least 24 chat messages and validated A2UI replay events.

- [ ] **Step 5: Commit the demo experience**

```bash
git add scripts/demo-studio-conversation.mjs scripts/demo-studio-conversation.d.mts scripts/seed-demo.mjs scripts/demo-a2ui-events.mjs tests/demoStudioConversation.test.ts
git commit -m "feat: seed long-conversation studio demo"
```

### Task 10: Verify visual quality, responsiveness, accessibility, and repository health

**Files:**
- Modify only files implicated by observed failures from the commands below.
- Update: `docs/architecture.mdx` only if the UI diagram or console description still depicts the old stacked-chat layout.

**Interfaces:**
- Consumes: the complete integrated studio.
- Produces: fresh automated and browser evidence that the implementation matches the spec.

- [ ] **Step 1: Run the full offline verification matrix**

Run:

```bash
git diff --check
npm run lint
npx tsc --noEmit
npm test
cd agent && ./.venv/bin/python -m pytest tests -q
```

Expected: `git diff --check` exits 0; lint has zero errors; TypeScript exits 0; all Vitest and Pytest tests pass.

- [ ] **Step 2: Run a production build**

Stop the development server before building so `.next` is not mutated concurrently.

Run: `npm run build`

Expected: Next.js reports successful compilation, TypeScript completion, static generation completion, and exit 0.

- [ ] **Step 3: Restart the local demo stack with guarded bypass**

Run the existing emulator worker stack, then run:

```bash
WATCHPACK_POLLING=true \
HARMONIA_DEV_AUTH_BYPASS=1 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 \
PUBSUB_EMULATOR_HOST=127.0.0.1:8082 \
GOOGLE_CLOUD_PROJECT=harmonia-local \
INTERNAL_API_TOKEN=local-dev-token \
./node_modules/.bin/next dev
```

Expected: the dashboard returns HTTP 200 and the bypass remains unavailable in production mode.

- [ ] **Step 4: Perform desktop browser acceptance at 1440×900**

Verify with the in-app browser:

- Navigation rail is outside the studio ratio.
- Conversation pane width divided by combined conversation/canvas width is `0.40 ± 0.01` after resetting the separator.
- Canvas ratio is `0.60 ± 0.01`.
- At least four chapters are navigable in the seeded long conversation.
- Completed activity is collapsed; active/failure state is expanded.
- Written, Visual, Motion, Audio, and Sources tabs show persisted content or truthful empty states.
- Conversation artifact selection focuses its canvas artifact.
- Approval dock shows the real `demo-launch/act-pub-launch` decision and does not execute without a click.
- No horizontal page overflow or browser console errors exist.

- [ ] **Step 5: Perform responsive and accessibility acceptance**

At 1023×900 and 390×844, verify a single-pane Chat/Canvas switcher, sticky composer, sticky approval access, native media controls, keyboard chapter navigation, separator keyboard controls at desktop, visible focus, text-plus-icon status, and reduced-motion behavior.

Exercise loading, no-active-job, failed-job, malformed replay, empty-audio, and pending-approval states. Use browser accessibility-visible labels rather than screenshots alone for assertions.

- [ ] **Step 6: Update architecture copy if stale and commit final verification fixes**

If `docs/architecture.mdx` still describes the console as a stacked chat with a job-detail sidebar, replace that description with the 2:3 conversation/canvas model and unchanged durable pipeline boundary.

```bash
git add docs/architecture.mdx src tests scripts
git commit -m "docs: describe long-conversation studio"
```

Do not use a broad add if unrelated landing-page changes remain dirty; list only files changed by this plan.
