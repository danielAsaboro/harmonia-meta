import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { importReplayBundle, type ImportedReplayBundle } from "@/lib/recordReplay/importer";

// Public, read-only evidence for judges and visitors. Every value here is
// either fetched live or read from a committed, metadata-only evidence file.
// Missing evidence is reported as missing; nothing is filled in.

const evidenceDir = () => process.env.HARMONIA_EVIDENCE_DIR ?? path.join(process.cwd(), "evidence");
const META_STATUS_URL = "https://api.meta.ai/v1/status";

const probeCheckSchema = z.object({
  check: z.string().max(60),
  model: z.string().max(120).optional(),
  ok: z.boolean().optional(),
  alive: z.boolean().optional(),
  status: z.string().max(60).optional(),
  httpStatus: z.number().int().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  requestId: z.string().max(200).nullable().optional(),
  responseId: z.string().max(200).nullable().optional(),
  inputTokens: z.number().int().nullable().optional(),
  usage: z.record(z.string(), z.union([z.number(), z.null()])).optional(),
  error: z.string().max(200).optional(),
}).passthrough();

const probeReportSchema = z.object({
  probe: z.literal("harmonia-meta-models"),
  ranAt: z.string().datetime({ offset: true }),
  baseUrl: z.string().url(),
  passed: z.boolean(),
  checks: z.array(probeCheckSchema).max(50),
});

export type ProbeReport = z.infer<typeof probeReportSchema>;

const rosterSchema = z.object({
  coordinator: z.string(),
  authority: z.string(),
  agents: z.array(z.object({
    name: z.string(), description: z.string(), model: z.string(), provider: z.string(),
    reasoningEffort: z.string().nullable(), maxOutputTokens: z.number().nullable(),
    tools: z.array(z.string()), skills: z.array(z.string()), typedOutput: z.boolean(),
    instructionChars: z.number(), definitionDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })),
  media: z.array(z.object({ name: z.string(), model: z.string(), job: z.string() })),
  rosterDigest: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotAt: z.string().optional(),
});

export type AgentRoster = z.infer<typeof rosterSchema>;

export type Loaded<T> = { state: "ok"; value: T } | { state: "missing" | "unavailable"; reason: string };

export interface RunSummary {
  bundleId: string;
  scenario: string;
  capturedAt: string;
  sourceRunId: string;
  environment: "authenticated_cloud" | "local_emulator";
  integrityDigest: string;
  terminalStateDigest: string;
  eventCount: number;
  durationMs: number;
  stages: string[];
  handoffs: { from: string; to: string; summary: string }[];
  reviews: string[];
  moments: { title: string; startSec: number; endSec: number }[];
  drafts: { platform: string; valid: boolean; text: string }[];
  approvals: { actionId: string; decision: string }[];
  receipts: { actionId: string; outcome: string; verified: boolean }[];
  cost: { model: string; inputTokens: number; outputTokens: number; usd: number }[];
  totalUsd: number;
}

export function summarizeRun(bundle: ImportedReplayBundle): RunSummary {
  const stages: string[] = [];
  const cost = new Map<string, { inputTokens: number; outputTokens: number; usd: number }>();
  const summary: RunSummary = {
    bundleId: bundle.bundleId, scenario: bundle.scenario, capturedAt: bundle.capturedAt,
    sourceRunId: bundle.provenance.sourceRunId, environment: bundle.provenance.environment, integrityDigest: bundle.integrity.digest,
    terminalStateDigest: bundle.terminalStateDigest, eventCount: bundle.events.length,
    durationMs: bundle.events.at(-1)?.offsetMs ?? 0,
    stages, handoffs: [], reviews: [], moments: [], drafts: [], approvals: [], receipts: [], cost: [], totalUsd: 0,
  };
  for (const event of bundle.events) {
    const p = event.payload as Record<string, unknown>;
    switch (event.kind) {
      case "stage_transition":
      case "job_snapshot":
        if (typeof p.stage === "string" && stages.at(-1) !== p.stage) stages.push(p.stage);
        break;
      case "specialist_handoff":
        summary.handoffs.push({ from: String(p.from), to: String(p.to), summary: String(p.summary) });
        break;
      case "activity_summary":
        if (p.specialist === "clip_critic") summary.reviews.push(String(p.summary));
        break;
      case "moment":
        summary.moments.push({ title: String(p.title), startSec: Number(p.startSec), endSec: Number(p.endSec) });
        break;
      case "draft":
        summary.drafts.push({ platform: String(p.platform), valid: Boolean(p.valid), text: String(p.text) });
        break;
      case "approval":
        summary.approvals.push({ actionId: String(p.actionId), decision: String(p.decision) });
        break;
      case "receipt":
        summary.receipts.push({ actionId: String(p.actionId), outcome: String(p.outcome), verified: Boolean(p.verified) });
        break;
      case "usage": {
        const row = cost.get(String(p.model)) ?? { inputTokens: 0, outputTokens: 0, usd: 0 };
        row.inputTokens += Number(p.inputTokens); row.outputTokens += Number(p.outputTokens); row.usd += Number(p.estimatedCostUsd);
        cost.set(String(p.model), row);
        break;
      }
      default:
        break;
    }
  }
  summary.cost = [...cost].map(([model, row]) => ({ model, ...row })).sort((a, b) => b.usd - a.usd);
  summary.totalUsd = summary.cost.reduce((total, row) => total + row.usd, 0);
  return summary;
}

async function readEvidence(name: string): Promise<string | null> {
  try {
    return await readFile(path.join(evidenceDir(), name), "utf8");
  } catch {
    return null;
  }
}

const screenScoreSchema = z.object({
  caught: z.number().int().nonnegative(), injections: z.number().int().nonnegative(),
  missed: z.array(z.string()), wronglyWithheld: z.array(z.string()), cleanCases: z.number().int().nonnegative(),
});

const screenEvalSchema = z.object({
  eval: z.literal("harmonia-source-screen"),
  version: z.string(),
  ranAt: z.string().datetime({ offset: true }),
  cases: z.number().int().positive(),
  rules: screenScoreSchema,
  glimmer: z.union([
    z.object({ state: z.literal("ran"), model: z.string(), latencyMs: z.number().int(), addedQuarantines: z.array(z.string()), combined: screenScoreSchema }).passthrough(),
    z.object({ state: z.enum(["not configured", "unavailable"]) }).passthrough(),
  ]),
});

export type ScreenEval = z.infer<typeof screenEvalSchema>;

export async function loadScreenEval(): Promise<Loaded<ScreenEval>> {
  const raw = await readEvidence("source-screen-eval.json");
  if (raw === null) return { state: "missing", reason: "No source-screen eval has been committed yet." };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { state: "unavailable", reason: "The committed source-screen eval is not valid JSON." }; }
  const parsed = screenEvalSchema.safeParse(json);
  return parsed.success ? { state: "ok", value: parsed.data } : { state: "unavailable", reason: "The committed source-screen eval does not match its schema." };
}

export async function loadProbeReport(): Promise<Loaded<ProbeReport>> {
  const raw = await readEvidence("meta-probe.json");
  if (raw === null) return { state: "missing", reason: "No live probe report has been committed yet." };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { state: "unavailable", reason: "The committed probe report is not valid JSON." }; }
  const parsed = probeReportSchema.safeParse(json);
  return parsed.success ? { state: "ok", value: parsed.data } : { state: "unavailable", reason: "The committed probe report does not match its schema." };
}

export async function loadPublicRuns(): Promise<{ runs: RunSummary[]; rejected: { file: string; reason: string }[] }> {
  let files: string[] = [];
  try {
    files = (await readdir(path.join(evidenceDir(), "replays"))).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return { runs: [], rejected: [] };
  }
  const runs: RunSummary[] = [];
  const rejected: { file: string; reason: string }[] = [];
  for (const file of files) {
    const raw = await readEvidence(path.join("replays", file));
    try {
      runs.push(summarizeRun(importReplayBundle(raw ?? "", { destination: "public" })));
    } catch (error) {
      rejected.push({ file, reason: error instanceof Error ? error.message.slice(0, 200) : "invalid bundle" });
    }
  }
  return { runs, rejected };
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadRoster(): Promise<Loaded<AgentRoster>> {
  const base = process.env.AGENT_SERVICE_URL;
  if (!base) {
    // A read-only deployment has no worker: show the committed roster snapshot, labelled as one.
    const raw = await readEvidence("roster.json");
    const parsed = raw ? rosterSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success
      ? { state: "ok", value: parsed.data }
      : { state: "unavailable", reason: "No agent service on this deployment and no committed roster snapshot." };
  }
  try {
    const parsed = rosterSchema.safeParse(await fetchJson(`${base.replace(/\/$/, "")}/roster`, 8000));
    return parsed.success ? { state: "ok", value: parsed.data } : { state: "unavailable", reason: "The agent service returned an unexpected roster." };
  } catch (error) {
    return { state: "unavailable", reason: `The agent service did not answer (${error instanceof Error ? error.name : "error"}).` };
  }
}

export interface MetaStatus { serviceStatus: string; alive: boolean; degraded: string[]; checkedAt: string }

export async function loadMetaStatus(): Promise<Loaded<MetaStatus>> {
  try {
    const body = await fetchJson(META_STATUS_URL, 6000) as Record<string, unknown>;
    const models = Array.isArray(body.model_statuses) ? body.model_statuses as Record<string, unknown>[] : [];
    return { state: "ok", value: {
      serviceStatus: String(body.service_status ?? (body.is_alive ? "operational" : "down")),
      alive: Boolean(body.is_alive),
      degraded: models.filter((item) => String(item.status ?? "operational") !== "operational").map((item) => String(item.model ?? item.id)),
      checkedAt: new Date().toISOString(),
    } };
  } catch (error) {
    return { state: "unavailable", reason: `Meta's status endpoint did not answer (${error instanceof Error ? error.name : "error"}).` };
  }
}
