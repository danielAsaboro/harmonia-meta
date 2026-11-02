import { describe, expect, it } from "vitest";

import { parseDemoHistoryArgs } from "../scripts/create-demo-history";

describe("demo history CLI", () => {
  it("parses a complete dry-run request", () => {
    expect(parseDemoHistoryArgs([
      "--dry-run",
      "--workspace", "w",
      "--brand", "b",
      "--dataset", "aug27",
      "--anchor", "2026-08-27T00:00:00.000Z",
    ])).toEqual({
      mode: "dry-run",
      workspaceId: "w",
      brandId: "b",
      datasetId: "aug27",
      anchor: "2026-08-27T00:00:00.000Z",
    });
  });

  it("requires the dry-run digest for apply", () => {
    expect(() => parseDemoHistoryArgs([
      "--apply",
      "--workspace", "w",
      "--brand", "b",
      "--dataset", "aug27",
      "--anchor", "2026-08-27T00:00:00.000Z",
    ])).toThrow("--expected-digest is required for apply");
  });

  it("parses a manifest verification request", () => {
    expect(parseDemoHistoryArgs([
      "--verify",
      "--manifest", "workspaces/w/brands/b/demo_datasets/aug27",
    ])).toEqual({
      mode: "verify",
      manifestPath: "workspaces/w/brands/b/demo_datasets/aug27",
    });
  });

  it("rejects cleanup because cleanup is intentionally non-automatic", () => {
    expect(() => parseDemoHistoryArgs([
      "--cleanup",
      "--manifest", "workspaces/w/brands/b/demo_datasets/aug27",
    ])).toThrow("cleanup is not implemented automatically");
  });
});
