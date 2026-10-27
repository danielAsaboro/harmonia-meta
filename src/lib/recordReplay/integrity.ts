import { createHash } from "node:crypto";
import { replayBundleSchema, unsignedReplayBundleSchema, type ReplayBundle, type UnsignedReplayBundle } from "./schema";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function canonicalJson(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
export function signReplayBundle(input: UnsignedReplayBundle): ReplayBundle {
  const bundle = unsignedReplayBundleSchema.parse(input);
  return replayBundleSchema.parse({ ...bundle, integrity: { algorithm: "sha256-canonical-json", digest: digest(bundle) } });
}
export function verifyReplayBundleDigest(input: ReplayBundle): boolean {
  const { integrity, ...unsigned } = input;
  return integrity.digest === digest(unsigned);
}
