import { createHash, timingSafeEqual } from "node:crypto";

import { publishPayloadSchema, type PublishPayload } from "./contracts";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("publishing approval contains an unsupported value");
}

export function publishApprovalDigest(payload: PublishPayload): string {
  const parsed = publishPayloadSchema.parse(payload);
  return createHash("sha256").update(canonicalJson(parsed)).digest("hex");
}

export function assertPublishAuthorization(payload: PublishPayload, approvedDigest: string): void {
  if (!/^[a-f0-9]{64}$/.test(approvedDigest)) throw new Error("invalid approval payload digest");
  const actual = publishApprovalDigest(payload);
  if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(approvedDigest, "hex"))) {
    throw new Error("approval payload digest mismatch");
  }
}
