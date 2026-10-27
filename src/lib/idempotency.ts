import { createHash, randomUUID } from "node:crypto";
import type { PlannedAction } from "./types";

export function newId(): string {
  return randomUUID();
}

export function idempotencyKey(
  jobId: string,
  actionId: string,
  contentHash: string,
): string {
  return createHash("sha256")
    .update(`${jobId}|${actionId}|${contentHash}`)
    .digest("hex");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("action payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("action payload contains an unsupported value");
}

/** Digest of every material field that determines the external effect. */
export function actionPayloadDigest(action: PlannedAction): string {
  return createHash("sha256").update(canonicalJson({
    actionId: action.id,
    jobId: action.jobId,
    type: action.type,
    momentId: action.momentId,
    angleId: action.angleId,
    payload: action.payload,
  })).digest("hex");
}
