import React, { useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type View = "system" | "workflow" | "agents" | "state" | "effects" | "apis" | "recovery" | "telemetry";
type FlowNode = Node<{ label: string; title: string; eyebrow: string; detail: string; views: View[]; kind: string }>;
type FlowEdge = Edge & { data: { views: View[] } };

const presets: { id: View; label: string }[] = [
  { id: "system", label: "System" },
  { id: "workflow", label: "Workflow" },
  { id: "agents", label: "Agents" },
  { id: "state", label: "State" },
  { id: "effects", label: "Effects" },
  { id: "apis", label: "APIs" },
  { id: "recovery", label: "Recovery" },
  { id: "telemetry", label: "Telemetry" },
];

const nodeLinks: Record<string, { href: string; label: string }> = {
  operator: { href: "/interfaces", label: "Operator interfaces" },
  api: { href: "/reference/api-routes", label: "API routes" },
  firestore: { href: "/platform/data/firestore", label: "Firestore architecture" },
  pubsub: { href: "/platform/data/pubsub", label: "Pub/Sub delivery" },
  worker: { href: "/pipeline", label: "Pipeline workflow" },
  adk: { href: "/platform/agents/google-adk", label: "Google ADK" },
  gemini: { href: "/platform/agents/gemini", label: "Gemini models" },
  effect: { href: "/reference/effect-contracts", label: "Effect contracts" },
  providers: { href: "/platform/integrations/x-api", label: "Platform integrations" },
  verify: { href: "/reference/receipts-verification", label: "Receipts and verification" },
  collectSources: { href: "/pipeline", label: "Source collection" },
  extractSources: { href: "/pipeline", label: "Source extraction" },
  analyze: { href: "/agents/nimi", label: "Nimi analyst" },
  strategy: { href: "/agents/ryan", label: "Ryan strategist" },
  strategyGate: { href: "/approval-and-audit", label: "Strategy approval" },
  plan: { href: "/agents/temi", label: "Temi planner" },
  draft: { href: "/agents/noni", label: "Artifact production workflow" },
  effectGate: { href: "/approval-and-audit", label: "Effect approval" },
  execute: { href: "/diagrams/effect-lifecycle", label: "Effect lifecycle" },
  nimi: { href: "/agents/nimi", label: "Nimi" },
  ryan: { href: "/agents/ryan", label: "Ryan" },
  temi: { href: "/agents/temi", label: "Temi" },
  noni: { href: "/agents/noni", label: "Noni" },
  dara: { href: "/agents/dara", label: "Dara" },
  maya: { href: "/agents/maya", label: "Maya" },
  nova: { href: "/agents/nova", label: "Nova" },
  outbox: { href: "/state-ownership", label: "State ownership" },
  memory: { href: "/platform/agents/memory-bank", label: "Memory Bank" },
  storage: { href: "/state-ownership", label: "Media state" },
  claim: { href: "/diagrams/effect-lifecycle", label: "Idempotency claims" },
  receipt: { href: "/reference/receipts-verification", label: "Effect receipts" },
  uncertain: { href: "/failure-recovery", label: "Failure recovery" },
  http: { href: "/reference/api-routes", label: "HTTP API reference" },
  telegram: { href: "/platform/integrations/telegram", label: "Telegram integration" },
  youtube: { href: "/pipeline", label: "Source ingestion" },
  social: { href: "/diagrams/effect-lifecycle", label: "Publishing effects" },
  trace: { href: "/platform/observability/opentelemetry", label: "OpenTelemetry" },
  usage: { href: "/platform/observability/usage-budget", label: "Usage and budget" },
  metrics: { href: "/observability", label: "Observability" },
};

const n = (id: string, x: number, y: number, title: string, eyebrow: string, detail: string, views: View[], kind = "process"): FlowNode => ({
  id,
  position: { x, y },
  data: { label: title, title, eyebrow, detail, views, kind },
  className: `hf-node hf-${kind}`,
});

const allNodes: FlowNode[] = [
  n("operator", 0, 170, "Operator", "INTENT", "Dashboard, chat, or allow-listed Telegram request.", ["system", "workflow", "apis"]),
  n("api", 250, 170, "Control plane", "NEXT.JS · CLOUD RUN", "Authenticates intent and applies deterministic policy.", ["system", "workflow", "apis"], "control"),
  n("firestore", 510, 70, "Firestore", "DURABLE TRUTH", "Jobs, artifacts, approvals, claims, receipts, and outbox records.", ["system", "state", "recovery"], "store"),
  n("pubsub", 510, 270, "Pub/Sub", "DELIVERY", "At-least-once stage triggers carrying identity and trace context.", ["system", "workflow", "state", "recovery", "telemetry"], "store"),
  n("worker", 790, 170, "Pipeline worker", "CLOUD RUN", "Claims a stage, reads durable state, and invokes bounded work.", ["system", "workflow", "apis", "recovery"], "control"),
  n("adk", 1060, 70, "Harmonia coordinator", "GOOGLE ADK", "Delegates exactly one specialist without effect authority.", ["system", "agents"], "agent"),
  n("gemini", 1320, 70, "Gemini 3.5 Flash", "COGNITION", "Transcription and typed specialist reasoning.", ["system", "agents"], "agent"),
  n("effect", 1060, 270, "Effect executor", "DETERMINISTIC", "Checks approval digest, claims idempotency, then acts.", ["system", "effects", "apis", "recovery"], "gate"),
  n("providers", 1330, 270, "External providers", "OFFICIAL APIS", "Approved X and LinkedIn publishing destinations.", ["system", "effects", "apis", "recovery"], "external"),
  n("verify", 1580, 270, "Independent read-back", "VERIFICATION", "Observes provider state and records evidence.", ["system", "workflow", "effects", "recovery"], "verified"),

  n("collectSources", 0, 600, "Collect sources", "01", "Seal direct inputs and an immutable library snapshot.", ["workflow"]),
  n("extractSources", 230, 600, "Extract sources", "02", "Normalize mixed sources with typed provenance locators.", ["workflow"]),
  n("analyze", 460, 600, "Analyze moments", "03 · NIMI", "Ground clip candidates in transcript evidence.", ["workflow", "agents"], "agent"),
  n("strategy", 690, 600, "Strategy", "04 · RYAN", "Evidence-linked platform strategy.", ["workflow", "agents"], "agent"),
  n("strategyGate", 920, 600, "Approve strategy", "HUMAN GATE", "Approval binds the exact strategy digest.", ["workflow", "effects"], "gate"),
  n("plan", 1150, 600, "Editorial plan", "06 · TEMI", "Validated schedule and selected outputs.", ["workflow", "agents"], "agent"),
  n("draft", 1380, 600, "Produce + review", "07 · NONI ↔ DARA", "Typed multi-format artifacts plus bounded editorial checks.", ["workflow", "agents"], "agent"),
  n("effectGate", 1610, 600, "Approve effect", "HUMAN GATE", "Exact content, destination, and action are authorized.", ["workflow", "effects"], "gate"),
  n("execute", 1840, 600, "Execute + verify", "09–11", "Render or publish, read back, and assemble evidence.", ["workflow", "effects"], "verified"),

  n("nimi", 0, 990, "Nimi", "ANALYST", "Grounds claims in quote, time, frame, and evidence kind.", ["agents"], "agent"),
  n("ryan", 240, 990, "Ryan", "STRATEGIST", "Produces an evidence-linked strategy for approval.", ["agents"], "agent"),
  n("temi", 480, 990, "Temi", "PLANNER", "Turns approved strategy into a validated plan.", ["agents"], "agent"),
  n("noni", 720, 990, "Noni", "CONTENT PRODUCER", "Produces the exact typed artifact batch requested by the approved output plan.", ["agents"], "agent"),
  n("dara", 960, 990, "Dara", "EDITOR", "Returns seven bounded checks without replacement copy.", ["agents"], "agent"),
  n("maya", 1200, 990, "Maya", "A2UI PRESENTER", "Builds validated component graphs from trusted state.", ["agents"], "agent"),
  n("nova", 1440, 990, "Nova", "READ-ONLY LIAISON", "Answers only from actual traces and evidence IDs.", ["agents", "telemetry"], "agent"),

  n("outbox", 0, 1370, "Transactional outbox", "ATOMIC WRITE", "State transition and pending trigger commit together.", ["state", "recovery"], "store"),
  n("memory", 260, 1370, "Memory Bank", "RETRIEVAL", "Scoped durable memory with explicit provenance.", ["state"], "store"),
  n("storage", 520, 1370, "Cloud Storage", "ARTIFACT BYTES", "Authorized source media, clips, and immutable JSON/Markdown exports.", ["state", "effects"], "store"),
  n("claim", 780, 1370, "Idempotency claim", "EFFECT LOCK", "One operation ID owns an external side effect.", ["state", "effects", "recovery"], "gate"),
  n("receipt", 1040, 1370, "Effect receipt", "AUDIT", "Provider identifier, request digest, outcome, and timestamps.", ["state", "effects", "recovery"], "verified"),
  n("uncertain", 1300, 1370, "UNCERTAIN", "SAFE FAILURE", "An expired unresolved claim requires reconciliation, never blind retry.", ["state", "recovery"], "danger"),

  n("http", 0, 1740, "HTTP API", "ENTRY", "Authenticated REST request with correlation context.", ["apis", "telemetry"]),
  n("telegram", 250, 1740, "Telegram Bot API", "ENTRY", "Allow-listed chat surface; same approval rules.", ["apis"]),
  n("youtube", 500, 1740, "YouTube Data API", "SOURCE", "Authorized source lookup and metadata.", ["apis"], "external"),
  n("social", 750, 1740, "Social platform APIs", "EFFECT", "Official API calls only, after approval.", ["apis", "effects"], "external"),
  n("trace", 1000, 1740, "OpenTelemetry trace", "CORRELATION", "Continues across HTTP, Pub/Sub, workers, agents, and providers.", ["telemetry"], "control"),
  n("usage", 1260, 1740, "Usage ledger", "COST", "Immutable operation-level model usage and cost.", ["telemetry"], "store"),
  n("metrics", 1520, 1740, "Metrics + audit", "OPERATIONS", "Outcomes by job, stage, role, and model—without customer content.", ["telemetry"], "verified"),
];

const e = (id: string, source: string, target: string, label: string, views: View[], animated = false): FlowEdge => ({
  id, source, target, label, animated, data: { views },
  markerEnd: { type: MarkerType.ArrowClosed },
  className: "hf-edge",
});

const allEdges: FlowEdge[] = [
  e("intent", "operator", "api", "authenticated intent", ["system", "workflow", "apis"]),
  e("persist", "api", "firestore", "persist job + outbox", ["system", "state"]),
  e("publish", "firestore", "pubsub", "publish trigger", ["system", "state", "recovery"]),
  e("deliver", "pubsub", "worker", "deliver stage", ["system", "workflow", "recovery", "telemetry"], true),
  e("read", "worker", "firestore", "read current truth", ["system", "state", "recovery"]),
  e("delegate", "worker", "adk", "bounded task", ["system", "agents"]),
  e("reason", "adk", "gemini", "typed prompt", ["system", "agents"]),
  e("artifact", "gemini", "firestore", "validated artifact", ["system", "agents", "state"]),
  e("authorize", "firestore", "effect", "approval + digest", ["system", "effects"]),
  e("act", "effect", "providers", "idempotent request", ["system", "effects", "apis", "recovery"], true),
  e("observe", "providers", "verify", "read provider state", ["system", "effects", "recovery"]),
  e("evidence", "verify", "firestore", "verification receipt", ["system", "state", "effects", "recovery"]),
  ...["collectSources","extractSources","analyze","strategy","strategyGate","plan","draft","effectGate","execute"].slice(0,-1).map((source, i) => e(`wf${i}`, source, ["collectSources","extractSources","analyze","strategy","strategyGate","plan","draft","effectGate","execute"][i+1], i === 3 || i === 6 ? "request approval" : "durable artifact", ["workflow"], true)),
  e("delegateNimi", "adk", "nimi", "one task", ["agents"]), e("delegateRyan", "adk", "ryan", "one task", ["agents"]),
  e("delegateTemi", "adk", "temi", "one task", ["agents"]), e("delegateNoni", "adk", "noni", "one task", ["agents"]),
  e("review", "noni", "dara", "draft + evidence", ["agents"]), e("present", "adk", "maya", "trusted state", ["agents"]),
  e("liaison", "adk", "nova", "evidence IDs", ["agents", "telemetry"]),
  e("outboxPub", "outbox", "pubsub", "pending trigger", ["state", "recovery"]), e("claimReceipt", "claim", "receipt", "resolved outcome", ["state", "effects", "recovery"]),
  e("claimUnknown", "claim", "uncertain", "lease expired", ["state", "recovery"]), e("reconcile", "uncertain", "providers", "operator read-back", ["recovery"]),
  e("apiTrace", "http", "trace", "traceparent", ["telemetry"]), e("pubTrace", "pubsub", "trace", "message attributes", ["telemetry"]),
  e("traceUsage", "trace", "usage", "model spans", ["telemetry"]), e("usageMetrics", "usage", "metrics", "aggregate", ["telemetry"]),
  e("httpControl", "http", "api", "request", ["apis"]), e("telegramControl", "telegram", "api", "webhook", ["apis"]),
  e("youtubeWorker", "youtube", "worker", "source metadata", ["apis"]), e("effectSocial", "effect", "social", "approved request", ["apis", "effects"]),
];

function ArchitectureCanvas({ visibleNodes, visibleEdges }: { visibleNodes: FlowNode[]; visibleEdges: FlowEdge[] }) {
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [nodes, , onNodesChange] = useNodesState(visibleNodes);
  const [edges, , onEdgesChange] = useEdgesState(visibleEdges);
  const onNodeClick = useCallback((_event: React.MouseEvent, node: FlowNode) => setSelected(node), []);

  return <div className="hf-canvas-wrap">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick} fitView fitViewOptions={{ padding: .18 }} minZoom={.25} maxZoom={1.8} nodesDraggable={true} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={22} size={1} />
        <MiniMap pannable zoomable nodeColor={(node) => ({ agent: "#7458d6", gate: "#d98e22", store: "#328399", verified: "#5f8f22", danger: "#c45245" }[(node.data as FlowNode["data"]).kind] || "#789087")} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <aside className={selected ? "open" : ""} aria-live="polite">
        {selected ? <><button aria-label="Close details" onClick={() => setSelected(null)}>×</button><small>{selected.data.eyebrow}</small><h2>{selected.data.title}</h2><p>{selected.data.detail}</p><b>Appears in</b><span>{selected.data.views.map((item) => presets.find((preset) => preset.id === item)?.label).join(" · ")}</span>{nodeLinks[selected.id] && <a className="hf-read-more" href={nodeLinks[selected.id].href}>Read about {nodeLinks[selected.id].label} →</a>}</> : <><small>INTERACTIVE MAP</small><h2>Select a node</h2><p>Inspect what it receives, owns, and produces. Pan or zoom to trace the labeled arrows.</p></>}
      </aside>
    </div>;
}

function ArchitectureFlow() {
  const [view, setView] = useState<View>("system");
  const [query, setQuery] = useState("");
  const visibleNodes = useMemo(() => allNodes.filter((node) => node.data.views.includes(view) && `${node.data.title} ${node.data.detail}`.toLowerCase().includes(query.toLowerCase())), [view, query]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => allEdges.filter((edge) => edge.data.views.includes(view) && visibleIds.has(edge.source) && visibleIds.has(edge.target)), [view, visibleIds]);

  return <section className="hf-atlas">
    <header className="hf-hero">
      <div><p>SYSTEM ATLAS · REPOSITORY-BACKED</p><h1>How Harmonia moves information into governed action.</h1><span>Follow intent, durable state, specialist judgment, human authority, external effects, and independent verification.</span></div>
      <a href="/architecture/overview">Read the system guide →</a>
    </header>
    <div className="hf-toolbar" aria-label="Architecture views">
      <div>{presets.map((preset) => <button key={preset.id} className={view === preset.id ? "active" : ""} onClick={() => setView(preset.id)}>{preset.label}</button>)}</div>
      <input aria-label="Search architecture nodes" placeholder="Search this view" value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <ArchitectureCanvas key={`${view}:${query}`} visibleNodes={visibleNodes} visibleEdges={visibleEdges} />
  </section>;
}

const mounted = new Map<Element, Root>();
function syncMounts() {
  document.querySelectorAll("#harmonia-react-flow").forEach((element) => {
    if (mounted.has(element)) return;
    const root = createRoot(element);
    root.render(<ReactFlowProvider><ArchitectureFlow /></ReactFlowProvider>);
    mounted.set(element, root);
  });
  for (const [element, root] of mounted) if (!document.contains(element)) { root.unmount(); mounted.delete(element); }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncMounts, { once: true });
else syncMounts();
new MutationObserver(syncMounts).observe(document.documentElement, { childList: true, subtree: true });
