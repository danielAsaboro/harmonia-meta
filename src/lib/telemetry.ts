import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { context, propagation, trace } from "@opentelemetry/api";

const traceStorage = new AsyncLocalStorage<string>();

const CONTENT_FIELDS = new Set([
  "body",
  "content",
  "media",
  "prompt",
  "response",
  "text",
  "transcript",
]);

export function injectTraceContext(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier);
}

export function extractedTraceContext(headers: Headers) {
  return propagation.extract(context.active(), Object.fromEntries(headers.entries()));
}

function requestTraceId(headers: Headers): string {
  const match = headers.get("traceparent")?.match(/^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/i);
  const inbound = match?.[1].toLowerCase();
  return inbound && inbound !== "0".repeat(32)
    ? inbound
    : randomBytes(16).toString("hex");
}

export function currentTraceId(): string {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (
    spanContext?.traceId
    && /^[a-f0-9]{32}$/.test(spanContext.traceId)
    && spanContext.traceId !== "0".repeat(32)
  ) return spanContext.traceId;
  return traceStorage.getStore() ?? "0".repeat(32);
}

export function withTraceContext<T>(headers: Headers, work: () => T): T {
  const extracted = extractedTraceContext(headers);
  return traceStorage.run(
    requestTraceId(headers),
    () => context.with(extracted, work),
  );
}

export function safeTraceAttributes(
  values: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    const segments = key.toLowerCase().replaceAll("-", "_").replaceAll("/", ".").split(".");
    if (segments.some((segment) => CONTENT_FIELDS.has(segment))) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}
