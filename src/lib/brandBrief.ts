import { createHash } from "node:crypto";
import { z } from "zod";

import { authorizedAgentFetch } from "@/lib/agentRouteClient";
import { getConfig } from "@/lib/config";
import { strategyContextSchema } from "@/lib/contracts";
import { getGoals, saveGoals } from "@/lib/firestore";
import { saveMemoryFacts, type MemoryFact } from "@/lib/memoryFacts";
import { currentTenant } from "@/lib/tenancy";
import type { StrategyContext } from "@/lib/types";

/**
 * Website onboarding: the agent reads a company's site, researches its market with
 * Meta web search, and returns a cited Brand Brief. The brief becomes the workspace's
 * strategy context and a set of memory facts, so every later job starts from it.
 */

const evidenceSchema = z.object({ id: z.string(), kind: z.string(), text: z.string(), url: z.string(), title: z.string(), check: z.enum(["quote", "source"]).optional() });
const briefSchema = z.object({
  company: z.string(), product: z.string(), category: z.string(), positioning: z.string(),
  differentiators: z.array(z.string()),
  audiences: z.array(z.object({ id: z.string(), name: z.string(), pains: z.array(z.string()), jobsToBeDone: z.array(z.string()), objections: z.array(z.string()), evidenceIds: z.array(z.string()) })),
  competitors: z.array(z.object({ name: z.string(), howWeDiffer: z.string(), evidenceIds: z.array(z.string()) })),
  pillars: z.array(z.object({ name: z.string(), purpose: z.string(), evidenceIds: z.array(z.string()) })),
  voiceRules: z.array(z.string()), exclusions: z.array(z.string()),
  businessObjectives: z.array(z.string()), campaignObjectives: z.array(z.string()),
  funnelStage: z.string(), intendedConversion: z.string(),
});
export const onboardingResultSchema = z.object({
  website: z.string().url(),
  brief: briefSchema,
  strategyContext: strategyContextSchema,
  evidence: z.array(evidenceSchema),
  pages: z.array(z.object({ pageId: z.string(), role: z.string(), url: z.string(), title: z.string() })),
  unverifiedResearchDropped: z.number().int(),
  modelCalls: z.array(z.object({ step: z.string(), model: z.string(), responseId: z.string(), inputTokens: z.number(), outputTokens: z.number(), searchCalls: z.number() })),
});
export type OnboardingResult = z.infer<typeof onboardingResultSchema>;

export interface StoredBrandBrief extends Omit<OnboardingResult, "strategyContext"> {
  digest: string;
  createdAt: string;
  editedAt?: string;
}

export async function requestWebsiteOnboarding(url: string, channels: string[] = ["x", "linkedin"], options: { fetchImpl?: typeof fetch } = {}): Promise<OnboardingResult> {
  const config = getConfig();
  const tenant = currentTenant();
  const baseUrl = new URL(config.AGENT_SERVICE_URL).toString().replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await authorizedAgentFetch(`${baseUrl}/internal/agent/onboard-website`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-harmonia-internal-token": config.INTERNAL_API_TOKEN, "x-workspace-id": tenant.workspaceId, "x-brand-id": tenant.brandId },
      body: JSON.stringify({ url, channels }),
    }, options.fetchImpl);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === "object" && "detail" in body && body.detail && typeof body.detail === "object" && "message" in body.detail ? String(body.detail.message).slice(0, 240) : `HTTP ${response.status}`;
      throw new Error(`website onboarding failed: ${message}`);
    }
    const parsed = onboardingResultSchema.safeParse(body);
    if (!parsed.success) throw new Error(`invalid onboarding result: ${parsed.error.issues[0]?.message ?? "contract mismatch"}`);
    return parsed.data;
  } finally { clearTimeout(timer); }
}

/** One memory fact per pain, competitor, and pillar, each traced to the brief version. */
export function briefMemoryFacts(result: Omit<OnboardingResult, "strategyContext">, digest: string, tenant: { workspaceId: string; brandId: string }): MemoryFact[] {
  const cite = (ids: string[]) => {
    const urls = [...new Set(ids.map((id) => result.evidence.find((item) => item.id === id)?.url).filter((url): url is string => Boolean(url)))].slice(0, 2);
    return urls.length ? ` (sources: ${urls.join(", ")})` : "";
  };
  const lines = [
    `Brand brief: ${result.brief.company} — ${result.brief.positioning}. Category: ${result.brief.category}.`,
    ...result.brief.audiences.map((audience) => `ICP "${audience.name}" pains: ${audience.pains.join("; ")}${cite(audience.evidenceIds)}`),
    ...result.brief.competitors.map((competitor) => `Competitor ${competitor.name}: ${competitor.howWeDiffer}${cite(competitor.evidenceIds)}`),
    ...result.brief.pillars.map((pillar) => `Messaging pillar "${pillar.name}": ${pillar.purpose}`),
  ];
  return lines.map((line, index) => ({
    kind: "learning" as const,
    fact: line.slice(0, 1000),
    evidence_ref: { workspace_id: tenant.workspaceId, brand_id: tenant.brandId, job_id: "onboarding", kind: "learning" as const, record_id: `brief:${digest.slice(0, 24)}:${index + 1}` },
  }));
}

/** Store the brief as the workspace strategy context, its full record, and memory facts. */
export async function saveBrandBrief(result: OnboardingResult): Promise<StoredBrandBrief> {
  const tenant = currentTenant();
  const { strategyContext, ...record } = result;
  const digest = createHash("sha256").update(JSON.stringify(result.brief)).digest("hex");
  const stored: StoredBrandBrief = { ...record, digest, createdAt: new Date().toISOString() };
  const goals = await getGoals();
  await saveGoals({ ...goals, strategyContext, brandBrief: stored });
  await saveMemoryFacts(tenant.brandId, briefMemoryFacts(result, digest, tenant));
  return stored;
}

export const briefEditSchema = z.object({
  positioning: z.string().trim().min(1).max(500).optional(),
  voiceRules: z.array(z.string().trim().min(1).max(120)).min(1).max(8).optional(),
  exclusions: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
  audiences: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), pains: z.array(z.string().trim().min(1).max(300)).min(1).max(8) }).strict()).min(1).max(6).optional(),
}).strict();
export type BriefEdit = z.infer<typeof briefEditSchema>;

/** Apply an operator's edits to the brief and to the strategy context every job starts from. */
export function applyBriefEdit(stored: StoredBrandBrief, context: StrategyContext, edit: BriefEdit): { brief: StoredBrandBrief; context: StrategyContext } {
  const known = new Map(stored.brief.audiences.map((audience) => [audience.id, audience]));
  const audiences = edit.audiences?.map((audience) => ({ ...(known.get(audience.id) ?? { jobsToBeDone: [], objections: [], evidenceIds: [] }), ...audience }));
  const brief = {
    ...stored.brief,
    ...(edit.positioning ? { positioning: edit.positioning } : {}),
    ...(edit.voiceRules ? { voiceRules: edit.voiceRules } : {}),
    ...(edit.exclusions ? { exclusions: edit.exclusions } : {}),
    ...(audiences ? { audiences } : {}),
  };
  const digest = createHash("sha256").update(JSON.stringify(brief)).digest("hex");
  return {
    brief: { ...stored, brief, digest, editedAt: new Date().toISOString() },
    context: {
      ...context,
      positioning: brief.positioning,
      brandVoice: brief.voiceRules.slice(0, 8),
      exclusions: brief.exclusions.slice(0, 12),
      audiences: brief.audiences.map(({ id, name, pains }) => ({ id, name, pains })),
    },
  };
}

export async function updateBrandBrief(edit: BriefEdit): Promise<StoredBrandBrief> {
  const goals = await getGoals();
  if (!goals.brandBrief || !goals.strategyContext) throw new Error("no brand brief to edit yet");
  const { brief, context } = applyBriefEdit(goals.brandBrief, goals.strategyContext, edit);
  await saveGoals({ ...goals, strategyContext: context, brandBrief: brief });
  const tenant = currentTenant();
  await saveMemoryFacts(tenant.brandId, briefMemoryFacts(brief, brief.digest, tenant));
  return brief;
}

const BRAND_KEYS = ["company", "product", "positioning", "differentiators", "brandVoice", "exclusions", "safetyConstraints", "audiences"] as const;

/**
 * Company facts and ICPs come from the onboarded brief, never from a model's reading of one
 * chat message. The router still decides this job's campaign fields (objective, funnel,
 * channels).
 */
export function withBrandContext(routed: StrategyContext | undefined, saved: StrategyContext | undefined, onboarded: boolean): StrategyContext | undefined {
  if (!onboarded || !saved) return routed;
  if (!routed) return saved;
  const merged: StrategyContext = { ...routed };
  for (const key of BRAND_KEYS) (merged as unknown as Record<string, unknown>)[key] = saved[key];
  return merged;
}

const WEBSITE_REQUEST = /\b(?:our|my|the|this|company'?s?|startup'?s?)\s+(?:website|site|domain|landing page|homepage)\b|\bonboard\b|\blearn (?:about )?(?:us|our (?:company|startup|business))\b/i;
// A message that also asks for content work is a job brief that happens to mention the site.
const CONTENT_REQUEST = /\b(?:help|write|draft|post|posts|thread|repurpose|turn|make|create|campaign|promote|grow|find us)\b/i;
const URL_OR_DOMAIN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i;

/** "Here's our website: acme.com" style requests, with exactly the site to read. */
export function websiteOnboardingTarget(message: string): string | null {
  if (!WEBSITE_REQUEST.test(message) || CONTENT_REQUEST.test(message)) return null;
  const match = message.match(URL_OR_DOMAIN);
  if (!match) return null;
  const candidate = match[1].replace(/[.,;:!?)]+$/, "");
  if (/youtube\.com|youtu\.be|x\.com\/|twitter\.com\/|linkedin\.com\//i.test(candidate)) return null;
  return candidate;
}

export function summarizeBrief(brief: StoredBrandBrief): string {
  const b = brief.brief;
  const sources = brief.evidence.filter((item) => item.kind !== "site").length;
  return [
    `I read ${brief.pages.length} page${brief.pages.length === 1 ? "" : "s"} of ${brief.website} and checked ${sources} outside source${sources === 1 ? "" : "s"} with Meta web search. Here is the brand brief every new job will now start from.`,
    `${b.company}: ${b.positioning}`,
    ...b.audiences.map((audience) => `Customer: ${audience.name}. Pains: ${audience.pains.slice(0, 3).join("; ")}.`),
    ...(b.competitors.length ? [`Competitors: ${b.competitors.map((competitor) => `${competitor.name} (${competitor.howWeDiffer})`).join("; ")}.`] : []),
    `Pillars: ${b.pillars.map((pillar) => pillar.name).join(", ")}.`,
    `Voice: ${b.voiceRules.slice(0, 3).join("; ")}.`,
    "Send me a YouTube link, a post, or any text and I will write it for these customers. You can correct anything here in Settings, under Brand brief.",
  ].join("\n\n");
}
