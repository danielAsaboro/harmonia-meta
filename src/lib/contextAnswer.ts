/**
 * Grounded Q&A about a specific Harmonia record ("chat with any item").
 *
 * The operator selects an entity (job, content item, proposal) anywhere in
 * the dashboard and asks a question; the answer is generated strictly from
 * that record.s data.
 */
import { getContentItem, getJob, getProposal } from "./firestore";
import { createChatCompletion } from "./metaChatCompletion";

export interface ChatContext {
  kind: "job" | "content_item" | "proposal";
  id: string;
}

export function isValidContext(value: unknown): value is ChatContext {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "job" || v.kind === "content_item" || v.kind === "proposal") &&
    typeof v.id === "string" &&
    v.id.length > 0
  );
}

/** Fetches the referenced record, or null when it does not exist. */
export async function fetchContextRecord(
  ctx: ChatContext,
): Promise<Record<string, unknown> | null> {
  try {
    if (ctx.kind === "job") return (await getJob(ctx.id)) as unknown as Record<string, unknown>;
    if (ctx.kind === "proposal") return (await getProposal(ctx.id)) as unknown as Record<string, unknown>;
    return (await getContentItem(ctx.id)) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You answer an operator's question about ONE Harmonia record.
You receive the record's full JSON plus the question. Answer ONLY with facts present
in the record - never invent ids, numbers, dates, or states. Be concise (max ~120 words).
If the record does not contain the answer, say exactly what is missing.`;

export async function answerFromContext(
  question: string,
  record: Record<string, unknown>,
): Promise<string> {
  return createChatCompletion({
    purpose: "contextual answer",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Record JSON:\n${JSON.stringify(record).slice(0, 60000)}\n\nQuestion: ${question}` },
    ],
    timeoutMs: 20_000,
  });
}
