const CATALOG_ID = "https://harmonia.app/a2ui/catalogs/chat/v1";

/**
 * Deterministic local renderer/protocol fixture for exercising the production
 * A2UI event stream and catalog. It does not exercise trusted hydration and
 * makes no model, provider, approval, or external-effect claim.
 */
export function buildDemoChatRunEvents(input) {
  const reply = "The local renderer fixture assembles source, moment, draft, and asset-shaped values; production hydration is verified separately.";
  const node = { children: [], emphasis: "primary", agentFraming: false };
  const draft = {
    id: "d1",
    platform: "x",
    text: "Your signup flow is an obstacle course. Ours was too — until we treated every step as a suspect.",
    valid: true,
    validationNote: "100/280 chars",
    selected: true,
    sourceCount: 0,
  };
  const canvasId = `studio-${input.runId}-canvas-r1`;
  const conversationId = `studio-${input.runId}-conversation-r1`;
  const approvalId = `studio-${input.runId}-approval-r1`;
  const canvas = [
    { id: "root", component: "Column", children: ["brief", "moments", "preview", "evidence", "audio-gap"] },
    {
      ...node,
      id: "brief",
      component: "CampaignBrief",
      jobId: input.jobId,
      title: "Onboarding, rebuilt around time-to-value",
      brief: "Turn the persisted onboarding teardown into a founder-led, outcome-first campaign.",
      sourceKind: "video",
      platforms: ["x"],
      angles: [
        { id: "a1", angleType: "trend", evidenceKind: "public_context", title: "Deletion as strategy", rationale: "A contrarian alternative to feature-dump launches." },
        { id: "a2", angleType: "meme", evidenceKind: "public_context", title: "Onboarding obstacle course meme", rationale: "A relatable format grounded in the persisted signup story." },
      ],
    },
    {
      ...node,
      id: "moments",
      component: "MomentExplorer",
      jobId: input.jobId,
      title: "Two proof points worth clipping",
      agentFraming: true,
      children: ["drafts"],
      source: { id: "source-video", label: "How we rebuilt onboarding around time-to-value (demo)", kind: "video", externalUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw", durationSec: 23 },
      moments: [
        { id: "m1", title: "Eleven ceremonial steps", startSec: 6, endSec: 14, hook: "Most onboarding steps exist because someone once asked.", quote: "eleven that were pure ceremony", cropSuitability: "good", selected: false },
        { id: "m2", title: "Nine days to forty hours", startSec: 14, endSec: 23, hook: "Activation time collapsed when we deleted instead of added.", quote: "nine days to forty hours", cropSuitability: "excellent", selected: true },
      ],
      transcript: [
        { id: "s1", startSec: 0, endSec: 6, text: "Everyone told us onboarding had to take two weeks." },
        { id: "s2", startSec: 6, endSec: 14, text: "We mapped every step and found eleven that were pure ceremony." },
        { id: "s3", startSec: 14, endSec: 23, text: "Deleting them cut activation time from nine days to forty hours." },
      ],
    },
    { ...node, id: "drafts", component: "DraftComparison", jobId: input.jobId, title: "Choose the launch voice", agentFraming: true, drafts: [draft] },
    {
      ...node,
      id: "preview",
      component: "PlatformPreview",
      jobId: input.jobId,
      title: "X campaign preview",
      draft,
      assets: [
        { actionId: "act-img-demo01", mime: "image/png", previewUrl: `/api/jobs/${input.jobId}/assets/act-img-demo01` },
        { actionId: "act-clip-demo1", mime: "video/mp4", previewUrl: `/api/jobs/${input.jobId}/assets/act-clip-demo1` },
        { actionId: "act-reel-top2", mime: "video/mp4", previewUrl: `/api/jobs/${input.jobId}/assets/act-reel-top2` },
      ],
    },
    {
      ...node,
      id: "evidence",
      component: "SourceEvidence",
      jobId: input.jobId,
      title: "Persisted source chain",
      sources: [
        { id: "source-video", kind: "video", label: "Onboarding interview", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
        { id: "s2", kind: "segment", label: "Transcript 00:06–00:14", excerpt: "We mapped every step and found eleven that were pure ceremony." },
        { id: "s3", kind: "segment", label: "Transcript 00:14–00:23", excerpt: "Deleting them cut activation time from nine days to forty hours." },
      ],
      links: [
        { fromId: "m1", toId: "s2", label: "grounded in transcript" },
        { fromId: "m2", toId: "s3", label: "grounded in transcript" },
      ],
    },
    {
      ...node,
      id: "audio-gap",
      component: "SurfaceUnresolved",
      title: "Audio remains unresolved",
      message: "No persisted audio asset exists for this local working set.",
      missingRefs: ["audio-asset"],
    },
  ];
  const conversation = [
    { id: "root", component: "Column", children: ["progress"] },
    {
      ...node,
      id: "progress",
      component: "JobProgress",
      jobId: input.jobId,
      title: "Local persisted job replay",
      stage: "complete",
      status: "complete",
      stages: [
        { id: "ingest", label: "ingest", status: "complete" },
        { id: "understand", label: "understand", status: "complete" },
        { id: "draft", label: "draft", status: "complete" },
        { id: "approval", label: "operator approval", status: "active" },
      ],
    },
  ];
  const approval = [
    { id: "root", component: "Column", children: ["approval-gap"] },
    {
      ...node,
      id: "approval-gap",
      component: "SurfaceUnresolved",
      title: "No approval belongs to this active fixture job",
      message: "The separate pending launch action is not merged into this job's generated surface.",
      missingRefs: ["active-job-pending-action"],
    },
  ];

  const surfaceMessages = [
    { version: "v0.9", createSurface: { surfaceId: canvasId, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: canvasId, components: canvas } },
    { version: "v0.9", createSurface: { surfaceId: conversationId, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: conversationId, components: conversation } },
    { version: "v0.9", createSurface: { surfaceId: approvalId, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: approvalId, components: approval } },
  ];
  const payloads = [
    { type: "run_started", startedAt: input.startedAt },
    { type: "activity", activity: { id: "interface-presenter", label: "Loaded local renderer A2UI fixture", description: "No trusted hydration, model, or provider invocation is represented.", status: "complete" } },
    { type: "tool_activity", tool: { name: "local_renderer_fixture", status: "complete", inputSummary: "explicit renderer/protocol values", outputSummary: "three domain-catalog surfaces", durationMs: 0, traceId: "demo-local-trace" } },
    ...surfaceMessages.map((operation) => ({ type: "a2ui_operation", operation })),
    { type: "job_updated", jobId: input.jobId, stage: "complete", status: "complete" },
    { type: "run_completed", completedAt: input.completedAt, reply },
  ];
  return payloads.map((payload, sequence) => ({ ...payload, runId: input.runId, sequence }));
}
