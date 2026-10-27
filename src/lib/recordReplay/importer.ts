import { replayBundleSchema, type ReplayBundle } from "./schema";
import { verifyReplayBundleDigest } from "./integrity";
import { digestReplayState, reduceReplayState } from "./state";

export type ImportedReplayBundle = Readonly<ReplayBundle>;
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); Object.values(value as Record<string, unknown>).forEach(deepFreeze); } return value; }
export function importReplayBundle(raw: string | unknown, policy: { destination: "private" | "public" }): ImportedReplayBundle {
  let parsed: unknown;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("invalid replay bundle JSON"); }
  const bundle = replayBundleSchema.parse(parsed);
  if (!verifyReplayBundleDigest(bundle)) throw new Error("replay bundle integrity verification failed");
  if (policy.destination === "public" && bundle.release !== "approved_public_bundle") throw new Error("bundle is not approved for public release");
  if (digestReplayState(reduceReplayState(bundle.events)) !== bundle.terminalStateDigest) throw new Error("replay terminal state digest mismatch");
  return deepFreeze(bundle);
}
