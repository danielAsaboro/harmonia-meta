import type { ArchitectureNode } from "./schema";
import { validateArchitecture } from "./validate";

const node = (value: Partial<ArchitectureNode> & Pick<ArchitectureNode, "id" | "name" | "kind" | "layer" | "summary">): ArchitectureNode => ({
  statuses: ["implemented"], authorities: ["none"], dataScope: "none", stateLifetime: "stateless", ...value,
});
const group = (id: string, name: string, layer: ArchitectureNode["layer"], summary: string, defaultExpanded = false) => node({ id, name, kind: "group", layer, summary, defaultExpanded });

const nodes: ArchitectureNode[] = [
  group("group-surfaces", "Operator surfaces", "surfaces", "Authenticated ways operators inspect and direct Harmonia.", true),
  node({ id: "surface-dashboard", name: "Editorial Studio Dashboard", kind: "surface", layer: "surfaces", parentId: "group-surfaces", summary: "Jobs, proposals, calendar, filtered agent activity, settings, and receipts.", authorities: ["read", "write"], dataScope: "workspace", runtime: "Next.js / Cloud Run", sourceFiles: ["src/components/DashboardFrame.tsx", "src/components/monitoring/AgentActivityView.tsx"] }),
  node({ id: "surface-console", name: "Conversational Console + A2UI", kind: "surface", layer: "surfaces", parentId: "group-surfaces", summary: "Natural-language job and status surface with a validated living canvas.", authorities: ["read", "write"], dataScope: "workspace", sourceFiles: ["src/components/ChatConsole.tsx"], docs: ["a2ui-console"] }),
  node({ id: "surface-telegram", name: "Telegram Bot", kind: "surface", layer: "surfaces", parentId: "group-surfaces", summary: "Allow-listed Bot API surface; approvals require callback taps.", statuses: ["implemented", "approval-gated"], authorities: ["read", "write"], dataScope: "tenant", sourceFiles: ["agent/harmonia_agent/telegram_bot.py"] }),
  node({ id: "surface-auth", name: "Google Sign-In / Identity Platform", kind: "surface", layer: "trust", parentId: "group-surfaces", summary: "Verified identity establishes workspace membership and tenant scope.", authorities: ["read"], dataScope: "tenant", sourceFiles: ["src/lib/auth.ts"] }),

  group("group-control", "Next.js control plane", "control", "Authenticated web control plane on Cloud Run."),
  ...[
    ["chat", "Chat intent + runs", "Muse Spark structured intent, durable run events, and replay."],
    ["upload", "Resumable upload broker", "Tenant-scoped upload sessions with server-side metadata verification."],
    ["decision", "Decision engine", "One policy and approval boundary for dashboard, chat, and Telegram."],
    ["calendar", "Calendar sync", "Explicit browser-session sync to an app-created Google calendar."],
    ["authentication", "Authentication + tenancy", "Server-derived workspace and brand membership."],
    ["a2ui", "A2UI renderer", "Validated declarative components; no generated JavaScript or arbitrary callbacks."],
    ["streaming", "NDJSON event streaming", "Persist-before-delivery transport with monotonic sequence replay."],
  ].map(([id, name, summary]) => node({ id: `control-${id}`, name, kind: "service", layer: "control", parentId: "group-control", summary, authorities: ["read", "write"], dataScope: "workspace", runtime: "Next.js / Cloud Run" })),

  group("group-apis", "API route families", "apis", "Browser-authenticated and service-authenticated route boundaries."),
  node({ id: "api-auth", name: "Auth + tenancy routes", kind: "route", layer: "apis", parentId: "group-apis", summary: "Session and workspace-scoped settings.", authorities: ["read", "write"], dataScope: "tenant", representativeRoutes: ["/api/auth/session", "/api/settings/*"], sourceFiles: ["src/app/api/auth/session/route.ts"] }),
  node({ id: "api-jobs", name: "Jobs + decisions", kind: "route", layer: "apis", parentId: "group-apis", summary: "Create/read jobs and record action-specific decisions, retry, or replay observations.", statuses: ["implemented", "approval-gated"], authorities: ["read", "write", "approve"], dataScope: "workspace", representativeRoutes: ["/api/jobs", "/api/jobs/{id}", "/api/jobs/{id}/actions/{actionId}/decision", "/api/jobs/{id}/retry", "/api/jobs/{id}/actions/{actionId}/replay"] }),
  node({ id: "api-chat", name: "Chat + A2UI", kind: "route", layer: "apis", parentId: "group-apis", summary: "Chat, transport streaming, replay, attachments, and registered-operation decisions.", authorities: ["read", "write"], dataScope: "workspace", representativeRoutes: ["/api/chat", "/api/chat/stream", "/api/chat/runs/{id}/events", "/api/chat/attachments/*", "/api/chat/operations/{id}/decision"] }),
  node({ id: "api-content", name: "Content + monitoring", kind: "route", layer: "apis", parentId: "group-apis", summary: "Content items, proposals, assets, events, receipts, metrics, and notifications.", authorities: ["read", "write"], dataScope: "workspace", representativeRoutes: ["/api/content-items", "/api/proposals", "/api/assets", "/api/events", "/api/receipts", "/api/metrics", "/api/notifications"] }),
  node({ id: "api-calendar", name: "Calendar + OAuth", kind: "route", layer: "apis", parentId: "group-apis", summary: "Operator-only Calendar sync and official OAuth connections.", statuses: ["implemented", "approval-gated"], authorities: ["read", "write"], dataScope: "workspace", representativeRoutes: ["/api/calendar", "/api/calendar/google", "/api/oauth/{platform}/*"] }),
  node({ id: "api-internal", name: "Internal worker boundary", kind: "route", layer: "apis", parentId: "group-apis", summary: "Service-authenticated worker callbacks; never browser-selected tenant scope.", authorities: ["read", "write"], dataScope: "tenant", representativeRoutes: ["/api/internal/source-manifest", "/api/internal/sources/{id}", "/api/internal/analysis", "/api/internal/content-artifacts", "/api/internal/effect-claim", "/api/internal/receipt", "/api/internal/verification", "/api/internal/usage", "/api/internal/agent-state"], sourceFiles: ["src/lib/internalHandler.ts"] }),

  group("group-workflow", "Durable workflow", "workflow", "Firestore-persisted, Pub/Sub-triggered resumable content pipeline.", true),
  ...[
    ["collect-sources", "1 · Collect sources", "Validate every direct and pinned library source independently."],
    ["extract-sources", "2 · Extract sources", "Normalize video, audio, documents, webpages, and text with typed locators."],
    ["analyze", "3 · Analyze", "Ground insights and eligible clip moments in the normalized manifest."],
    ["strategize", "4 · Strategize", "Ryan proposes a grounded four-week strategy and content briefs."],
    ["strategy-approval", "5 · Approve strategy", "Human approval bound to the exact strategy digest."],
    ["plan", "6 · Plan", "Temi proposes a complete plan; deterministic code validates, persists, and selects one eligible item."],
    ["draft", "7 · Draft & review", "Noni and Dara produce the exact selected item in a bounded revision loop."],
    ["await-approval", "8 · Await effect approval", "Hard human gate before consequential or paid external effects."],
    ["publish-render", "9 · Publish / export / render", "Claim and execute actions authorized by exact approval or deterministic safe-action mandate."],
    ["verify", "10 · Verify", "Independently re-fetch providers or re-read artifact digests."],
    ["learn", "11 · Learn", "Persist measured outcomes and eligible takeaways."],
  ].map(([id, name, summary]) => node({ id: `stage-${id}`, name, kind: id === "await-approval" || id === "strategy-approval" ? "gate" : id === "verify" ? "verification" : "stage", layer: "workflow", parentId: "group-workflow", summary, statuses: id === "await-approval" || id === "strategy-approval" ? ["approval-gated"] : ["implemented"], authorities: id === "await-approval" || id === "strategy-approval" ? ["approve"] : id === "verify" ? ["verify"] : ["write"], dataScope: "workspace", stateLifetime: "durable", sourceFiles: ["agent/harmonia_agent/stages.py"], docs: ["pipeline"] })),

  group("group-worker", "ADK worker", "control", "FastAPI Cloud Run worker consumes stages and persists results."),
  ...[["dispatcher", "Stage dispatcher"], ["scheduler", "Scheduler dispatcher"], ["proactive", "Proactive agent"], ["media", "Direct media operations"], ["ffmpeg", "ffmpeg skills"], ["providers", "Provider clients"], ["tenant", "Tenant-context validation"]].map(([id, name]) => node({ id: `worker-${id}`, name, kind: "service", layer: "control", parentId: "group-worker", summary: `${name} inside the service-authenticated worker boundary.`, authorities: ["read", "write"], dataScope: "workspace-brand", runtime: "FastAPI / Cloud Run" })),

  group("group-agent-runtime", "ADK team runtime", "agents", "In-process cognitive runtime inside the worker; never durable workflow ownership."),
  node({ id: "agent-runtime", name: "ADK in-process runner", kind: "runtime", layer: "agents", parentId: "group-agent-runtime", summary: "Ephemeral cognitive runtime with one in-memory session per invocation.", statuses: ["pending-live"], authorities: ["delegate"], dataScope: "workspace-brand", stateLifetime: "ephemeral", runtime: "Cloud Run worker", sourceFiles: ["agent/harmonia_agent/team_runtime.py"], docs: ["agent-platform", "session-memory"], limitations: ["Authenticated live evidence pending."] }),
  node({ id: "memory-bank", name: "Workspace memory", kind: "store", layer: "data", parentId: "group-agent-runtime", summary: "Exact workspace_id + brand_id retrieval of eligible typed facts only, ranked by shared words.", statuses: ["pending-live"], authorities: ["read", "write"], dataScope: "workspace-brand", stateLifetime: "durable", sourceFiles: ["agent/harmonia_agent/memory_bank.py", "src/lib/memoryFacts.ts"], limitations: ["Excludes raw sources, transcripts, prompts, drafts, errors, and unverified claims."] }),

  group("group-agent-team", "Agent team + delegation", "agents", "Bounded ADK roles with no effect authority."),
  node({ id: "agent-harmonia", name: "Harmonia coordinator", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Routes exactly one bounded specialist; cannot answer the task, approve, or publish.", statuses: ["offline-verified", "pending-live"], authorities: ["delegate"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Exact one-specialist routing and delegation only.", sourceFiles: ["agent/harmonia_agent/agents.py"] }),
  node({ id: "agent-intent-router", name: "Harmonia intent router", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Interprets ordinary founder language against durable strategy, plan, calendar, and job context.", statuses: ["offline-verified", "pending-live", "read-only"], authorities: ["propose", "read"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Infer a typed user-level route and output concepts; never expose internal registry tags or authorize effects.", skills: ["harmonia-intent-routing"], sourceFiles: ["agent/harmonia_agent/intent_routing.py"] }),
  node({ id: "agent-ryan", name: "Ryan strategist", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Produces provenance-linked four-week strategy and content briefs for human approval.", statuses: ["offline-verified", "approval-gated", "pending-live"], authorities: ["propose", "read"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Wonder 1.0" }, promptResponsibility: "Agentic strategy from closed-world evidence using one allow-listed filesystem method skill and an optional isolated request-bound Meta web search tool; no direct search, scheduling, approval, or effects.", skills: ["ryan-strategy-skills"] }),
  node({ id: "agent-nimi", name: "Nimi multimodal analyst", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Proposes strict source analysis with quote/time/frame and evidence-kind provenance; deterministic code validates and digests it.", statuses: ["offline-verified", "pending-live"], authorities: ["propose", "read"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Load one allow-listed filesystem analysis skill for method guidance. Separately, use only isolated request-bound public/private research tools when explicitly requested; no strategy, copy, or effect authority.", skills: ["nimi-analysis-skills"] }),
  group("workflow-writing-review", "Writing and review loop", "agents", "Deterministic orchestration of separate typed Noni and Dara calls for one selected item."),
  node({ id: "agent-noni", name: "Noni content producer", kind: "agent", layer: "agents", parentId: "workflow-writing-review", summary: "Produces the exact requested multi-format artifact batch and at most one issue-bound revision from the approved output plan and referenced evidence.", statuses: ["offline-verified", "pending-live"], authorities: ["read", "propose"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Return strict typed artifact payloads with exact evidence lineage; no Memory Bank, strategy, approval, persistence, or effect authority.", skills: ["noni-writing-skills"] }),
  node({ id: "agent-dara", name: "Dara editor", kind: "agent", layer: "agents", parentId: "workflow-writing-review", summary: "Returns all seven editorial checks plus a bounded accept/revise assessment; deterministic code assigns review metadata, permits at most one revision, and requires complete issue resolution.", statuses: ["offline-verified", "pending-live"], authorities: ["propose"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Load one allow-listed editing method reference, then assess grounding, brief alignment, brand voice, platform constraints, CTA, safety, and clarity with supplied provenance; no workflow metadata, replacement copy, facts, or effects.", skills: ["dara-editing-skills"] }),
  node({ id: "agent-temi", name: "Temi editorial planner", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Agentically operationalizes the approved Ryan strategy against one immutable Firestore planning snapshot.", statuses: ["offline-verified", "pending-live"], authorities: ["propose", "read"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Load one planning-method skill, read only the exact request-bound snapshot, then decide sequencing, cadence, supported channels/formats, windows, deadlines, dependencies, and priorities; no final copy, external scheduling, approval, or effects.", skills: ["temi-editorial-planning-skills"] }),
  node({ id: "agent-maya", name: "Maya A2UI presenter", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Produces exact-context reference graphs; deterministic validators bind every entity before host hydration.", statuses: ["offline-verified", "pending-live"], authorities: ["propose"], dataScope: "workspace-brand", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Choose bounded domain components, exact entity references, and hierarchy; no lifecycle placeholders, authority, or inline truth." }),
  node({ id: "agent-nova", name: "Nova read-only liaison", kind: "agent", layer: "agents", parentId: "group-agent-team", summary: "Returns strict answers bound to the actual skill-first tool trace and exact evidence IDs.", statuses: ["offline-verified", "pending-live", "read-only"], authorities: ["read"], dataScope: "workspace", stateLifetime: "ephemeral", model: { name: "Muse Spark 1.3" }, promptResponsibility: "Skill selection, grounded synthesis, explicit uncertainty, and typed read errors.", skills: ["trend-scan", "signal-watch", "engagement-insights", "job-status", "posting-schedule"] }),

  group("group-skills", "Filesystem skills", "skills", "Project-owned reusable method guidance loaded through ADK filesystem SkillToolsets. Skill content is never factual evidence."),
  group("group-tools", "Runtime tools", "skills", "Read-only data and grounding capabilities. Tool results require their own provenance and never become skills."),
  node({ id: "skill-harmonia-intent-routing", name: "harmonia-intent-routing", kind: "skill", layer: "skills", parentId: "group-skills", summary: "Project-owned routing policy for strategy-first programs, contextual one-offs, source repurposing, and effect-safe requests.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "workspace-brand", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills/harmonia-intent-routing/SKILL.md"] }),
  node({ id: "skill-noni-writing-skills", name: "noni-writing-skills", kind: "skill", layer: "skills", parentId: "group-skills", summary: "Filesystem ADK skill with ten original writing-method references for grounded content production.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "public", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills/noni-writing-skills/SKILL.md"] }),
  node({ id: "skill-dara-editing-skills", name: "dara-editing-skills", kind: "skill", layer: "skills", parentId: "group-skills", summary: "Filesystem ADK skill with seven project-owned editing-method references for bounded editorial assessment.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "public", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills/dara-editing-skills/SKILL.md"] }),
  node({ id: "skill-nimi-analysis-skills", name: "nimi-analysis-skills", kind: "skill", layer: "skills", parentId: "group-skills", summary: "Filesystem ADK skill with seven project-owned evidence-analysis method references.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "public", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills/nimi-analysis-skills/SKILL.md"] }),
  node({ id: "skill-temi-editorial-planning-skills", name: "temi-editorial-planning-skills", kind: "skill", layer: "skills", parentId: "group-skills", summary: "Filesystem ADK skill with six project-owned editorial-planning method references.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "public", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills/temi-editorial-planning-skills/SKILL.md"] }),
  ...["trend-scan", "signal-watch", "engagement-insights", "job-status", "posting-schedule"].map((name) => node({ id: `skill-${name}`, name, kind: "skill", layer: "skills", parentId: "group-skills", summary: `Filesystem ADK skill: ${name}.`, statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: name.includes("trend") || name === "signal-watch" ? "public" : "workspace", stateLifetime: "stateless", sourceFiles: [`agent/harmonia_agent/skills/${name}/SKILL.md`] })),
  ...[
    ["fetch-trend-signals", "fetch_trend_signals", "public"], ["search-trend-signals", "search_trend_signals", "public"],
    ["get-engagement-insights", "get_engagement_insights", "workspace"], ["get-operator-feed", "get_operator_feed", "workspace"],
    ["get-job-status", "get_job_status", "workspace"], ["suggest-posting-windows", "suggest_posting_windows", "workspace"],
  ].map(([id, name, scope]) => node({ id: `tool-${id}`, name, kind: "tool", layer: "skills", parentId: "group-tools", summary: `Read-only ${scope}-scoped tool.`, statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: scope as "public" | "workspace", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/skills_runtime.py"] })),
  node({ id: "tool-search-verified-publications", name: "search_verified_publications", kind: "tool", layer: "skills", parentId: "group-tools", summary: "Tenant-scoped read of prior posts with applied receipts, successful verification, and canonical URLs.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "workspace", stateLifetime: "durable", sourceFiles: ["agent/harmonia_agent/noni_skills.py", "src/app/api/internal/published-content/route.ts"] }),
  node({ id: "tool-meta-web-search", name: "web_search", kind: "tool", layer: "skills", parentId: "group-tools", summary: "Meta Model API web search run in its own Responses request behind Nimi, Ryan, and Noni request-bound research tools; cited sources are checked against Meta's search results and URL citations before claims are accepted.", statuses: ["offline-verified", "read-only", "pending-live"], authorities: ["read"], dataScope: "public", stateLifetime: "stateless", sourceFiles: ["agent/harmonia_agent/meta_search.py", "agent/harmonia_agent/nimi_research.py", "agent/harmonia_agent/noni_skills.py", "agent/harmonia_agent/ryan_skills.py"] }),
  ...["read_editorial_commitments", "read_production_capacity", "read_asset_readiness", "read_posting_window_observations", "read_calendar_projection", "read_blocked_dependencies"].map((name) => node({ id: `tool-temi-${name.replaceAll("_", "-")}`, name, kind: "tool", layer: "skills", parentId: "group-tools", summary: "Request-bound read of one immutable Firestore editorial-planning snapshot section.", statuses: ["offline-verified", "read-only"], authorities: ["read"], dataScope: "workspace-brand", stateLifetime: "ephemeral", sourceFiles: ["agent/harmonia_agent/temi_skills.py", "src/app/api/internal/editorial-planning-snapshot/route.ts"] })),

  group("group-state", "Data stores + state ownership", "data", "Durable business state, scoped memory, assets, usage, and evidence."),
  node({ id: "firestore", name: "Firestore", kind: "store", layer: "data", parentId: "group-state", summary: "Durable source of truth for jobs, complete editorial plans, digests, and selected item lifecycle under workspaces/{workspaceId}/…", authorities: ["read", "write"], dataScope: "workspace", stateLifetime: "durable", sourceFiles: ["src/lib/firestore.ts"], docs: ["state-ownership"] }),
  node({ id: "pubsub", name: "Pub/Sub", kind: "service", layer: "workflow", parentId: "group-state", summary: "Asynchronous stage delivery and retry; payload and attributes repeat tenant scope.", authorities: ["write"], dataScope: "workspace-brand", stateLifetime: "durable", sourceFiles: ["src/lib/pubsub.ts"] }),
  node({ id: "asset-store", name: "Cloud Storage / local artifacts", kind: "store", layer: "data", parentId: "group-state", summary: "Workspace- and brand-scoped immutable JSON/Markdown exports and generated media.", authorities: ["read", "write"], dataScope: "workspace-brand", stateLifetime: "durable", sourceFiles: ["src/lib/storage.ts"] }),
  ...[["budget", "Budget reservations"], ["usage", "Immutable usage ledger"], ["claims", "Effect claims"], ["receipts", "Immutable receipts"], ["verifications", "Verification records"]].map(([id, name]) => node({ id: `state-${id}`, name, kind: "store", layer: id === "budget" || id === "usage" ? "observability" : "data", parentId: "group-state", summary: `${name} persisted transactionally in workspace-scoped Firestore.`, authorities: ["read", "write"], dataScope: "workspace", stateLifetime: "durable" })),

  group("group-effect-safety", "Human approval + effect safety", "effects", "Action-specific human approval, idempotent execution, and independent truth checks."),
  node({ id: "approval-receipt", name: "Action-specific approval receipt", kind: "gate", layer: "effects", parentId: "group-effect-safety", summary: "Records who approved exactly which action and payload.", statuses: ["approval-gated"], authorities: ["approve"], dataScope: "workspace", stateLifetime: "durable", approval: "Required before every external effect." }),
  ...[["idempotency-key", "SHA-256 idempotency key"], ["effect-claim", "Atomic Firestore effect claim"], ["execution-receipt", "Immutable execution receipt"], ["independent-readback", "Independent provider/digest read-back"], ["verification-record", "Immutable verification record"]].map(([id, name]) => node({ id, name, kind: id.includes("verification") || id.includes("readback") ? "verification" : "control", layer: "effects", parentId: "group-effect-safety", summary: `${name} in the deterministic effect-safety lifecycle.`, statuses: ["implemented"], authorities: id.includes("verification") || id.includes("readback") ? ["verify"] : ["write"], dataScope: "workspace", stateLifetime: "durable" })),
  node({ id: "uncertain-claim", name: "UNCERTAIN · operator reconciliation", kind: "control", layer: "effects", parentId: "group-effect-safety", summary: "Expired unresolved claims never auto-retry unsafely.", statuses: ["implemented"], authorities: ["none"], dataScope: "workspace", stateLifetime: "durable", limitations: ["Requires explicit operator reconciliation."] }),
  ...[
    { id: "publish-x", name: "Publish X post", approval: true, summary: "Publishes externally only after an action-specific approval receipt." },
    { id: "export-artifact", name: "Export content artifact", approval: false, summary: "Stores the internal artifact as immutable canonical JSON and deterministic Markdown, then independently verifies both byte streams." },
    { id: "generate-image", name: "Generate Muse Image", approval: true, summary: "Incurs paid Muse Image generation only after an action-specific approval receipt; the asset stays internal until separately published." },
    { id: "render-media", name: "Render clip / reel", approval: false, summary: "Renders a local internal media asset; separate approval is required before external publication." },
    { id: "schedule-content", name: "Schedule due content", approval: true, summary: "Schedules an external publication only after an action-specific approval receipt." },
  ].map((effect) => node({
    id: `effect-${effect.id}`, name: effect.name, kind: "effect", layer: "effects",
    parentId: "group-effect-safety", summary: effect.summary,
    statuses: effect.approval ? ["approval-gated"] : ["implemented"],
    authorities: ["execute-effect"], dataScope: effect.approval ? "external" : "workspace",
    stateLifetime: effect.approval ? "external" : "durable",
    approval: effect.approval ? "Required" : "Not required",
    idempotency: "Deterministic SHA-256 operation key",
    verification: "Independent re-fetch or digest read-back",
  })),

  group("group-external", "External services", "external", "Official platform APIs and Meta Model API."),
  ...[
    ["youtube", "YouTube / oEmbed / yt-dlp", "implemented"], ["x", "X API v2", "approval-gated"], ["calendar", "Google Calendar API", "approval-gated"],
    ["hn", "Hacker News / Algolia", "read-only"], ["muse-spark", "Muse Spark reasoning + web search", "pending-live"],
    ["muse-voice", "Muse Voice Transcribe", "pending-live"], ["muse-image", "Muse Image", "pending-live"], ["sam", "SAM 3.1 subject tracking", "pending-live"],
  ].map(([id, name, status]) => node({ id: `external-${id}`, name, kind: "integration", layer: "external", parentId: "group-external", summary: `${name} integration through an official or authorized boundary.`, statuses: [status as ArchitectureNode["statuses"][number]], authorities: status === "read-only" ? ["read"] : ["none"], dataScope: id === "hn" || id === "youtube" ? "public" : "external", stateLifetime: "external" })),

  group("group-observability", "Observability + cost", "observability", "Metadata-only trace correlation and deterministic cost accounting."),
  ...[["trace", "W3C trace propagation"], ["spans", "Native ADK logs, metrics, and traces"], ["activity", "Tenant-scoped activity projection"], ["cost", "Role/model cost accounting"], ["budgets", "Workspace + job budget guards"]].map(([id, name]) => node({ id: `observe-${id}`, name, kind: "control", layer: "observability", parentId: "group-observability", summary: `${name}; no prompts, responses, transcripts, drafts, media, or chain-of-thought.`, statuses: id === "trace" || id === "spans" ? ["offline-verified", "pending-live"] : ["offline-verified"], authorities: ["read"], dataScope: "metadata-only", stateLifetime: "durable", sourceFiles: id === "activity" ? ["src/lib/observability/repository.ts", "src/components/monitoring/AgentActivityView.tsx"] : ["agent/harmonia_agent/telemetry.py"], docs: ["observability", "models-cost-evaluation"] })),
];

const workflowIds = ["collect-sources", "extract-sources", "analyze", "strategize", "strategy-approval", "plan", "draft", "await-approval", "publish-render", "verify", "learn"].map((id) => `stage-${id}`);
const effectIds = nodes.filter((item) => item.kind === "effect").map((item) => item.id);
const approvalEffectIds = nodes
  .filter((item) => item.kind === "effect" && item.approval === "Required")
  .map((item) => item.id);
const edges = [
  ...workflowIds.slice(0, -1).map((source, index) => {
    const target = workflowIds[index + 1];
    const isApproval = source === "stage-strategy-approval" || source === "stage-await-approval";
    const isVerification = source === "stage-publish-render" && target === "stage-verify";
    return {
      id: `flow-${index + 1}`, source, target,
      kind: isApproval ? "approval" as const : isVerification ? "verification" as const : "workflow" as const,
      label: isApproval ? "Human approval" : isVerification ? "Independent verification" : "Durable transition",
    };
  }),
  { id: "delegate-ryan", source: "agent-harmonia", target: "agent-ryan", kind: "delegation" as const, label: "Delegate strategy" },
  { id: "delegate-intent", source: "agent-harmonia", target: "agent-intent-router", kind: "delegation" as const, label: "Route natural request" },
  { id: "intent-skill", source: "skill-harmonia-intent-routing", target: "agent-intent-router", kind: "retrieval" as const, label: "Routing policy only" },
  { id: "delegate-nimi", source: "agent-harmonia", target: "agent-nimi", kind: "delegation" as const, label: "Delegate analysis" },
  { id: "delegate-writing", source: "agent-harmonia", target: "workflow-writing-review", kind: "delegation" as const, label: "typed specialist calls" },
  { id: "plan-temi", source: "stage-plan", target: "agent-temi", kind: "delegation" as const, label: "Typed approved strategy" },
  { id: "temi-plan-state", source: "agent-temi", target: "firestore", kind: "workflow" as const, label: "Validate, digest, persist" },
  { id: "temi-skill", source: "skill-temi-editorial-planning-skills", target: "agent-temi", kind: "retrieval" as const, label: "Method guidance only" },
  { id: "delegate-maya", source: "agent-harmonia", target: "agent-maya", kind: "delegation" as const, label: "Delegate presentation" },
  { id: "delegate-nova", source: "agent-harmonia", target: "agent-nova", kind: "delegation" as const, label: "Delegate insight" },
  { id: "flo-1", source: "firestore", target: "agent-noni", kind: "workflow" as const, label: "Selected item + exact Ryan brief + referenced Nimi evidence" },
  { id: "flo-2", source: "agent-noni", target: "agent-dara", kind: "workflow" as const, label: "Draft for review" },
  { id: "flo-3", source: "agent-dara", target: "agent-noni", kind: "workflow" as const, label: "Bounded revision loop" },
  { id: "memory", source: "memory-bank", target: "agent-harmonia", kind: "memory" as const, label: "Exact-scope facts" },
  { id: "state-pubsub", source: "firestore", target: "pubsub", kind: "workflow" as const, label: "Persist then publish" },
  ...approvalEffectIds.map((effectId) => ({
    id: `approval-${effectId}`, source: "approval-receipt", target: effectId,
    kind: "approval" as const, label: "Human approval",
  })),
  ...effectIds.map((effectId) => ({
    id: `verification-${effectId}`, source: effectId, target: "verification-record",
    kind: "verification" as const, label: "Independent read-back",
  })),
  { id: "claim-uncertain", source: "effect-claim", target: "uncertain-claim", kind: "blocked" as const, label: "Expired unresolved claim" },
  { id: "telemetry-worker", source: "group-worker", target: "group-observability", kind: "telemetry" as const, label: "Trace context" },
  { id: "retrieval-hn", source: "external-hn", target: "agent-nova", kind: "retrieval" as const, label: "Read-only public signals" },
];

export const architectureDefinition = validateArchitecture({
  version: "2026-08-26",
  nodes,
  edges,
  presets: [
    { id: "overview", name: "System overview", expanded: ["group-surfaces", "group-workflow"], layers: [], statuses: [], focusNodeIds: ["group-workflow"] },
    { id: "agents", name: "Agent team", expanded: ["group-agent-runtime", "group-agent-team", "workflow-writing-review", "group-skills", "group-tools"], layers: ["agents", "skills", "models", "prompts", "data"], statuses: [], focusNodeIds: ["agent-harmonia"] },
    { id: "workflow", name: "Content workflow", expanded: ["group-workflow", "group-worker"], layers: ["workflow", "control", "effects"], statuses: [], focusNodeIds: ["stage-collect-sources"] },
    { id: "effect-safety", name: "Approval and effect safety", expanded: ["group-effect-safety"], layers: ["effects", "external", "data"], statuses: [], focusNodeIds: ["approval-receipt"] },
    { id: "state", name: "State ownership", expanded: ["group-state", "group-agent-runtime"], layers: ["data", "workflow", "agents"], statuses: [], focusNodeIds: ["firestore"] },
    { id: "apis", name: "APIs and integrations", expanded: ["group-control", "group-apis", "group-external"], layers: ["control", "apis", "external"], statuses: [], focusNodeIds: ["group-apis"] },
    { id: "observability", name: "Observability and cost", expanded: ["group-observability", "group-state"], layers: ["observability", "data"], statuses: [], focusNodeIds: ["group-observability"] },
  ],
});
