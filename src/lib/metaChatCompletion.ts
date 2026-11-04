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

// docs/meta/error-handling.md: 429, 500 and 503 are retryable; honour Retry-After.
const RETRYABLE = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 3;

function retryDelayMs(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 30) * 1000 : 500 * 2 ** (attempt - 1);
}

export async function createChatCompletion(input: {
  purpose: string;
  messages: ChatMessage[];
  responseFormat?: JsonSchemaResponseFormat;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const config = getConfig();
  if (!config.MODEL_API_KEY) throw new Error(`MODEL_API_KEY is not configured for ${input.purpose}`);
  const signal = AbortSignal.timeout(input.timeoutMs);
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const body = JSON.stringify({
    model: config.MODEL_ID,
    messages: input.messages,
    reasoning_effort: "low",
    prompt_cache_key: `harmonia-web-${input.purpose.replaceAll(" ", "-")}`,
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
  });
  let res: Response;
  for (let attempt = 1; ; attempt += 1) {
    res = await fetch(`${config.META_API_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.MODEL_API_KEY}` },
      body,
      signal,
    });
    if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) break;
    await sleep(retryDelayMs(res, attempt));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Meta ${input.purpose} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error(`Meta returned no ${input.purpose} content`);
  return text.trim();
}
