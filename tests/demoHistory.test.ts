import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  buildDemoProvenance,
  collectInstants,
  demoDocumentId,
  isIsoInstant,
  shiftDemoValue,
} from "../src/lib/demoHistory";

describe("demo history transformations", () => {
  it("shifts nested ISO instants and Firestore timestamps by one offset", () => {
    const input = {
      createdAt: "2026-08-30T12:00:00.000Z",
      nested: [Timestamp.fromDate(new Date("2026-08-31T12:00:00.000Z"))],
    };

    expect(shiftDemoValue(input, -3 * 86_400_000)).toEqual({
      createdAt: "2026-08-27T12:00:00.000Z",
      nested: [Timestamp.fromDate(new Date("2026-08-28T12:00:00.000Z"))],
    });
  });

  it("does not alter partial dates or timestamp-like prose", () => {
    const input = { id: "2026-08-30", text: "created 2026-08-30T12:00Z" };

    expect(shiftDemoValue(input, 10)).toEqual(input);
    expect(isIsoInstant(input.id)).toBe(false);
    expect(isIsoInstant(input.text)).toBe(false);
  });

  it("collects complete instants from nested values", () => {
    expect(collectInstants({
      a: "2026-08-30T00:00:00.000Z",
      b: [Timestamp.fromMillis(1_788_048_000_000), "no"],
    })).toEqual([1_788_048_000_000, 1_788_048_000_000]);
  });

  it("generates stable path-bound document identities", () => {
    const first = demoDocumentId("aug27", "workspaces/w/jobs/j1");

    expect(first).toBe(demoDocumentId("aug27", "workspaces/w/jobs/j1"));
    expect(first).not.toBe(demoDocumentId("aug27", "workspaces/w/jobs/j2"));
    expect(first).toMatch(/^demo_[a-f0-9]{40}$/);
  });

  it("builds explicit teaching-demo provenance", () => {
    expect(buildDemoProvenance({
      datasetId: "aug27",
      sourcePath: "workspaces/w/jobs/j1",
      originAnchor: "2026-08-27T00:00:00.000Z",
      originalStatus: "running",
      originalStage: "draft",
    })).toEqual({
      kind: "teaching_demo",
      datasetId: "aug27",
      sourceDocumentPath: "workspaces/w/jobs/j1",
      originAnchor: "2026-08-27T00:00:00.000Z",
      originalStatus: "running",
      originalStage: "draft",
    });
  });
});
