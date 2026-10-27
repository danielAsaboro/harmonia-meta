import type { OutputKind, StrategyContext } from "./types";
import { outputKindSchema } from "./contracts";
import { OUTPUT_CAPABILITIES } from "./outputCapabilities";
import { OUTPUT_CONCEPT_TO_KIND, requestIntentRoute } from "./agentRouteClient";
import { loadWorkspaceContentContext, type WorkspaceContentContext } from "./workspaceContentContext";

const URL_RE = /https?:\/\/[^\s<>"]+/gi;
const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?\S*v=|shorts\/)|youtu\.be\/)/i;

function extractJobId(message: string): string | undefined {
  for (const pattern of [/\b(?:job|artifacts?)\s+(?:for\s+|of\s+)?([\w][\w.:-]*)/i, /\b(?:for|of)\s+(?:the\s+)?(?:job\s+)?([\w][\w.:-]*)/i]) {
    const id = message.match(pattern)?.[1];
    if (id && !/^(the|a|an|it|this|that|please|job)$/i.test(id)) return id;
  }
  return undefined;
}

export type ChatIntent = "create_job" | "establish_strategy" | "revise_strategy" | "advance_plan" | "manage_calendar" | "status" | "list_artifacts" | "approve" | "effect_request"
  | "create_production_plan" | "revise_production_plan" | "explain_production_plan"
  | "approve_production_plan" | "production_status" | "rerender_production_plan" | "unknown";
export type ChatSourceDescriptor = { kind: "youtube" | "web"; url: string } | { kind: "pasted_text"; title: string; text: string };
export interface ParsedIntent { intent: ChatIntent; sources?: ChatSourceDescriptor[]; desiredOutputs?: OutputKind[]; libraryName?: string; jobId?: string; productionRequest?: string; userOutcome?: string; assumptions?: string[]; needsClarification?: boolean; clarifyingQuestion?: string; requiresRightsAttestation?: boolean; workspaceContext?: WorkspaceContentContext; platformRecommendations?: string[]; connectionSuggestions?: string[]; strategyContext?: StrategyContext }

export function normalizeParsedIntent(value: unknown): ParsedIntent {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const intents: ChatIntent[] = ["create_job", "establish_strategy", "revise_strategy", "advance_plan", "manage_calendar", "status", "list_artifacts", "approve", "effect_request", "create_production_plan", "revise_production_plan", "explain_production_plan", "approve_production_plan", "production_status", "rerender_production_plan", "unknown"];
  const intent = typeof raw.intent === "string" && intents.includes(raw.intent as ChatIntent) ? raw.intent as ChatIntent : "unknown";
  const sources = Array.isArray(raw.sources) ? raw.sources.flatMap((item): ChatSourceDescriptor[] => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    if ((source.kind === "youtube" || source.kind === "web") && typeof source.url === "string" && source.url.trim()) {
      return [{ kind: source.kind, url: source.url.trim() }];
    }
    if (source.kind === "pasted_text" && typeof source.text === "string" && source.text.trim()) {
      const title = typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Operator context";
      return [{ kind: "pasted_text", title, text: source.text.trim() }];
    }
    return [];
  }) : [];
  const desiredOutputs = Array.isArray(raw.desiredOutputs) ? raw.desiredOutputs.flatMap((item) => {
    const parsed = outputKindSchema.safeParse(item);
    return parsed.success && OUTPUT_CAPABILITIES[parsed.data].state !== "unavailable" ? [parsed.data] : [];
  }) : [];
  return {
    intent,
    ...(sources.length ? { sources } : {}),
    ...(desiredOutputs.length ? { desiredOutputs } : {}),
    ...(typeof raw.libraryName === "string" && raw.libraryName.trim() ? { libraryName: raw.libraryName.trim() } : {}),
    ...(typeof raw.jobId === "string" && raw.jobId.trim() ? { jobId: raw.jobId.trim() } : {}),
    ...(typeof raw.productionRequest === "string" && raw.productionRequest.trim() ? { productionRequest: raw.productionRequest.trim() } : {}),
  };
}

export function parseLocalIntent(message: string): ParsedIntent {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const jobId = extractJobId(trimmed);
  if (/\b(?:re-?render|render again)\b/.test(lower) && /\b(?:production|media|paid assets?|job)\b/.test(lower)) {
    return { intent: "rerender_production_plan", jobId, productionRequest: trimmed };
  }
  if (/\bapprove\b/.test(lower) && /\b(?:production|media)\s+plan\b/.test(lower)) {
    return { intent: "approve_production_plan", jobId };
  }
  if (/\b(?:revise|change|update|replace|remove)\b/.test(lower)
    && /\b(?:production plan|soundtrack|shot|storyboard|media plan)\b/.test(lower)) {
    return { intent: "revise_production_plan", jobId, productionRequest: trimmed };
  }
  if (/\b(?:explain|why)\b/.test(lower) && /\b(?:model|production plan|media plan|shot|soundtrack)\b/.test(lower)) {
    return { intent: "explain_production_plan", jobId };
  }
  if (/\b(?:active|running|pending|report|status|progress)\b/.test(lower)
    && /\b(?:production|media)\s+(?:operations?|plan|status|progress)\b/.test(lower)) {
    return { intent: "production_status", jobId };
  }
  if (/\b(?:create|make|propose|draft|prepare)\b/.test(lower) && /\b(?:production|media)\s+plan\b/.test(lower)) {
    return { intent: "create_production_plan", jobId, productionRequest: trimmed };
  }
  if (/\bapprove\b/.test(lower)) return { intent: "approve", jobId };
  if (/\bartifacts?\b/.test(lower)) return { intent: "list_artifacts", jobId };
  if (/\bstatus\b/.test(lower)) return { intent: "status", jobId };
  const libraryName = trimmed.match(/\b(?:brand\s+)?library\s+["“]([^"”]+)["”]/i)?.[1]?.trim();
  const urls = trimmed.match(URL_RE) ?? [];
  if (urls.length || libraryName || trimmed.length >= 20) {
    const sources: ChatSourceDescriptor[] = urls.map((url) => ({ kind: YOUTUBE_RE.test(url) ? "youtube" : "web", url }));
    const remaining = trimmed.replace(URL_RE, "").replace(/\n?Use brand library ["“][^"”]+["”]\.??/gi, "").replace(/^(please\s+)?(make|create|start|run|generate|write)\s+(content|posts?)?\s*(from|about)?\s*/i, "").trim();
    if (remaining.length >= 20 && !/^content from the selected brand library\.?$/i.test(remaining)) sources.push({ kind: "pasted_text", title: "Operator context", text: remaining });
    return { intent: "create_job", sources, libraryName };
  }
  return { intent: "unknown" };
}

export async function parseIntent(message: string, attachmentCount = 0, recentConversation: Array<{ role: "user" | "assistant"; text: string }> = []): Promise<ParsedIntent> {
  const workspaceContext = await loadWorkspaceContentContext();
  const route = await requestIntentRoute({ message, workspaceContext, attachmentCount, recentConversation });
  const sources: ChatSourceDescriptor[] = route.sourceUrls.map((url) => ({ kind: YOUTUBE_RE.test(url) ? "youtube" : "web", url }));
  const desiredOutputs = route.outputConcepts.map((concept) => OUTPUT_CONCEPT_TO_KIND[concept]).flatMap((kind) => {
    const parsed = outputKindSchema.safeParse(kind);
    return parsed.success && OUTPUT_CAPABILITIES[parsed.data].state !== "unavailable" ? [parsed.data] : [];
  });
  const common = { sources, desiredOutputs, jobId: route.jobId ?? undefined, userOutcome: route.userOutcome, assumptions: route.assumptions, needsClarification: route.needsClarification, clarifyingQuestion: route.clarifyingQuestion ?? undefined, requiresRightsAttestation: route.requiresRightsAttestation, workspaceContext, platformRecommendations: route.platformRecommendations, connectionSuggestions: route.connectionSuggestions, strategyContext: route.strategyContext ?? undefined };
  if (route.intent === "repurpose_source" || route.intent === "one_off_content") return { intent: "create_job", ...common };
  if (route.intent === "status_evidence") return { intent: /artifact|draft|content/i.test(message) ? "list_artifacts" : "status", ...common };
  if (route.intent === "effect_request") return { intent: /approv|review|accept/i.test(message) ? "approve" : "effect_request", ...common };
  if (["establish_strategy", "revise_strategy", "advance_plan", "manage_calendar"].includes(route.intent)) return { intent: route.intent as ChatIntent, ...common };
  return { intent: "unknown", ...common };
}
