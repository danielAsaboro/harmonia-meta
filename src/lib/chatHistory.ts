const CHAT_SCOPE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ChatSurface = "dashboard" | "telegram";

export interface RetainedMessage {
  id: string;
  at: string | null;
  data?: Record<string, unknown>;
}

export interface ChatSummaryBoundary {
  fromAt: string | null;
  toAt: string | null;
  prunedMessageCount: number;
  linkedJobIds: string[];
  linkedRunIds: string[];
}

function checked(label: string, value: string): string {
  if (!CHAT_SCOPE_ID.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

export function chatScopeKey(userId: string, surface: ChatSurface, conversationId: string): string {
  return `${checked("userId", userId)}:${surface}:${checked("conversationId", conversationId)}`;
}

function linkedId(data: Record<string, unknown> | undefined, key: "jobId" | "chatRunId"): string | null {
  const direct = data?.[key];
  if (typeof direct === "string" && CHAT_SCOPE_ID.test(direct)) return direct;
  if (key === "jobId" && data?.job && typeof data.job === "object") {
    const nested = (data.job as Record<string, unknown>).id;
    if (typeof nested === "string" && CHAT_SCOPE_ID.test(nested)) return nested;
  }
  return null;
}

export function retentionPlan(messages: RetainedMessage[], maximum: number): {
  deleteIds: string[];
  summary: ChatSummaryBoundary | null;
} {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error("maximum must be a positive integer");
  const ordered = [...messages].sort((a, b) => Date.parse(a.at ?? "0") - Date.parse(b.at ?? "0"));
  const removed = ordered.slice(0, Math.max(ordered.length - maximum, 0));
  if (removed.length === 0) return { deleteIds: [], summary: null };
  return {
    deleteIds: removed.map((message) => message.id),
    summary: {
      fromAt: removed[0].at,
      toAt: removed.at(-1)?.at ?? null,
      prunedMessageCount: removed.length,
      linkedJobIds: [...new Set(removed.map((message) => linkedId(message.data, "jobId")).filter((id): id is string => Boolean(id)))],
      linkedRunIds: [...new Set(removed.map((message) => linkedId(message.data, "chatRunId")).filter((id): id is string => Boolean(id)))],
    },
  };
}
