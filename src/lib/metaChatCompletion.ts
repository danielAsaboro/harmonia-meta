/**
 * Meta Model API Chat Completions (`POST {META_API_BASE_URL}/chat/completions`).
 *
 * OpenAI-compatible request/response shape; see
 * docs/meta-model-api/protocols-chat-completions.md and structured-output.md.
 */
import { getConfig } from "./config";

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: { name: string; schema: Record<string, unknown>; strict: true };
}

export async function createChatCompletion(input: {
  purpose: string;
  messages: ChatMessage[];
  responseFormat?: JsonSchemaResponseFormat;
  timeoutMs: number;
}): Promise<string> {
  const config = getConfig();
  if (!config.MODEL_API_KEY) throw new Error(`MODEL_API_KEY is not configured for ${input.purpose}`);
  const res = await fetch(`${config.META_API_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.MODEL_API_KEY}` },
    body: JSON.stringify({
      model: config.MODEL_ID,
      messages: input.messages,
      ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Meta ${input.purpose} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error(`Meta returned no ${input.purpose} content`);
  return text.trim();
}
