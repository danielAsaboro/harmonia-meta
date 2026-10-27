import type { JobControlStateValue } from "./jobShell";

export type WorkAdmission =
  | { outcome: "execute" }
  | { outcome: "paused" }
  | { outcome: "cancelled" };

export function decideWorkAdmission(controlState: JobControlStateValue): WorkAdmission {
  if (controlState === "paused") return { outcome: "paused" };
  if (controlState === "cancelled") return { outcome: "cancelled" };
  return { outcome: "execute" };
}
