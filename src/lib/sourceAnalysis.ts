import { createHash } from "node:crypto";

function canonicalBytes(value: unknown): string {
  if (value === null) return "n;";
  if (typeof value === "boolean") return value ? "b1;" : "b0;";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("source analysis digest requires finite numbers");
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
    return `d${bytes.toString("hex")};`;
  }
  if (typeof value === "string") return `s${Buffer.byteLength(value, "utf8")}:${value}`;
  if (Array.isArray(value)) return `a${value.length}[${value.map(canonicalBytes).join("")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `o${entries.length}{${entries.map(([key, entry]) => canonicalBytes(key) + canonicalBytes(entry)).join("")}}`;
  }
  throw new Error("source analysis digest contains an unsupported value");
}

export function sourceAnalysisDigest(analysis: unknown): string {
  return createHash("sha256").update(canonicalBytes(analysis), "utf8").digest("hex");
}
