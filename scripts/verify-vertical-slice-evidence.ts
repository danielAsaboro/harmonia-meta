import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

import {
  type EvidenceFailure,
  verifyVerticalSliceEvidence,
} from "../src/lib/verticalSliceEvidence";

const PRIVATE_KEYS = new Set([
  "authorizationheader",
  "cookie",
  "drafttext",
  "token",
  "transcript",
]);

function scanPrivateKeys(value: unknown, currentPath = ""): EvidenceFailure[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => scanPrivateKeys(entry, `${currentPath}.${index}`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const entryPath = currentPath ? `${currentPath}.${key}` : key;
    const ownFailure = PRIVATE_KEYS.has(key.toLowerCase())
      ? [{ code: "private_field", path: entryPath, message: "Private field names are forbidden in evidence bundles." }]
      : [];
    return [...ownFailure, ...scanPrivateKeys(entry, entryPath)];
  });
}

function scanEvidencePaths(value: unknown): EvidenceFailure[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  const evidenceFiles = (value as { evidenceFiles?: unknown }).evidenceFiles;
  if (!Array.isArray(evidenceFiles)) {
    return [];
  }

  return evidenceFiles.flatMap((entry, index) => {
    const relativePath = entry && typeof entry === "object"
      ? (entry as { relativePath?: unknown }).relativePath
      : undefined;
    if (typeof relativePath !== "string") {
      return [];
    }
    const normalized = relativePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (path.posix.isAbsolute(normalized) || segments.includes("..") || normalized.length === 0) {
      return [{
        code: "unsafe_evidence_path",
        path: `evidenceFiles.${index}.relativePath`,
        message: "Evidence file paths must be safe relative paths.",
      }];
    }
    return [];
  });
}

function emit(ok: boolean, failures: EvidenceFailure[]): never {
  writeSync(1, `${JSON.stringify({ ok, failures })}\n`);
  process.exit(ok ? 0 : 1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  emit(false, [{ code: "missing_path", path: "", message: "Provide one evidence bundle path." }]);
}

let raw: string;
try {
  raw = readFileSync(inputPath, "utf8");
} catch {
  emit(false, [{ code: "read_failed", path: "", message: "Evidence bundle could not be read." }]);
}

let input: unknown;
try {
  input = JSON.parse(raw);
} catch {
  emit(false, [{ code: "invalid_json", path: "", message: "Evidence bundle is not valid JSON." }]);
}

const guardFailures = [...scanPrivateKeys(input), ...scanEvidencePaths(input)];
if (guardFailures.length > 0) {
  emit(false, guardFailures);
}

const result = verifyVerticalSliceEvidence(input);
emit(result.ok, result.failures);
