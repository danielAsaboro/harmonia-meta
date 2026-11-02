import { Timestamp } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import { inertCollectionForPath, makeDocumentInert, repairInertTimeline, shiftValue } from "../scripts/reanchor-timestamps";

describe("timestamp history reanchoring", () => {
  it("shifts exact ISO timestamps recursively without depending on field names", () => {
    const result = shiftValue({ payload: ["2026-08-30T12:30:00.000Z"] }, "", -86_400_000);
    expect(result.value).toEqual({ payload: ["2026-08-29T12:30:00.000Z"] });
    expect(result.touchedTimestampValues).toBe(1);
  });

  it("preserves Date and Firestore Timestamp storage types", () => {
    const date = new Date("2026-08-30T12:30:00.000Z");
    const timestamp = Timestamp.fromDate(date);
    const shifted = shiftValue({ date, timestamp }, "", -86_400_000).value as Record<string, unknown>;
    expect(shifted.date).toBeInstanceOf(Date);
    expect((shifted.date as Date).toISOString()).toBe("2026-08-29T12:30:00.000Z");
    expect(shifted.timestamp).toBeInstanceOf(Timestamp);
    expect((shifted.timestamp as Timestamp).toDate().toISOString()).toBe("2026-08-29T12:30:00.000Z");
  });

  it("recognizes worker-facing collections at any valid document depth", () => {
    expect(inertCollectionForPath("workspaces/w/brands/b/jobs/j/stage_executions/understand")).toBe("stage_executions");
    expect(inertCollectionForPath("workspaces/w/brands/b/data_batches/batch/work_items/item")).toBe("work_items");
  });

  it("terminalizes runnable records without migration-specific labels", () => {
    const now = "2026-08-27T00:00:00.000Z";
    expect(makeDocumentInert("effect_commands", { state: "prepared", operationId: "op" }, now).value).toMatchObject({
      state: "cancelled",
      invalidatedReason: "superseded",
    });
    expect(makeDocumentInert("content_items", { status: "scheduled", effectCommandId: "cmd" }, now).value).toMatchObject({
      status: "cancelled",
      failureReason: "superseded",
    });
    expect(makeDocumentInert("jobs", { status: "running", stage: "publish", controlState: "running" }, now).value).toMatchObject({
      status: "failed",
      stage: "failed",
      controlState: "cancelled",
    });
  });

  it("does not alter terminal records beyond their timestamp shift", () => {
    const document = { state: "applied", updatedAt: "2026-08-30T00:00:00.000Z" };
    expect(makeDocumentInert("effect_commands", document, "2026-08-27T00:00:00.000Z")).toEqual({
      value: document,
      changed: false,
    });
  });

  it("is idempotent at zero offset and keeps inert transitions after creation", () => {
    const document = { createdAt: "2026-08-29T10:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", status: "failed", stage: "failed", controlState: "cancelled" };
    expect(shiftValue(document, "", 0)).toEqual({ value: document, changed: false, touchedTimestampValues: 0 });
    expect(repairInertTimeline("jobs", document, "2026-08-27T00:00:00.000Z").value).toMatchObject({
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    });
  });
});
