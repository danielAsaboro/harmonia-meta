import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface DemoProvenance {
  kind: "teaching_demo";
  datasetId: string;
  sourceDocumentPath: string;
  originAnchor: string;
  originalStatus?: string;
  originalStage?: string;
}

export function isIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && ISO_INSTANT.test(value)
    && Number.isFinite(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function collectInstants(value: unknown): number[] {
  if (isIsoInstant(value)) return [Date.parse(value)];
  if (value instanceof Timestamp) return [value.toMillis()];
  if (Array.isArray(value)) return value.flatMap(collectInstants);
  if (isPlainObject(value)) return Object.values(value).flatMap(collectInstants);
  return [];
}

export function shiftDemoValue(value: unknown, offsetMs: number): unknown {
  if (!Number.isSafeInteger(offsetMs)) throw new Error("demo history offset must be a safe integer");
  if (isIsoInstant(value)) return new Date(Date.parse(value) + offsetMs).toISOString();
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis() + offsetMs);
  if (Array.isArray(value)) return value.map((item) => shiftDemoValue(item, offsetMs));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftDemoValue(item, offsetMs)]),
    );
  }
  return value;
}

export function demoDocumentId(datasetId: string, sourcePath: string): string {
  if (!datasetId || !sourcePath) throw new Error("demo dataset and source path are required");
  const digest = createHash("sha256").update(`${datasetId}\n${sourcePath}`, "utf8").digest("hex").slice(0, 40);
  return `demo_${digest}`;
}

export function buildDemoProvenance(input: {
  datasetId: string;
  sourcePath: string;
  originAnchor: string;
  originalStatus?: string;
  originalStage?: string;
}): DemoProvenance {
  if (!input.datasetId || !input.sourcePath || !isIsoInstant(input.originAnchor)) {
    throw new Error("valid demo provenance binding required");
  }
  return {
    kind: "teaching_demo",
    datasetId: input.datasetId,
    sourceDocumentPath: input.sourcePath,
    originAnchor: new Date(input.originAnchor).toISOString(),
    ...(input.originalStatus ? { originalStatus: input.originalStatus } : {}),
    ...(input.originalStage ? { originalStage: input.originalStage } : {}),
  };
}
