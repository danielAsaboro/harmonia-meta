import { describe, expect, it } from "vitest";
import { assertImmutableRecord, residentCollectionPath } from "@/lib/residentAutonomy/repository";

describe("resident autonomy repository boundary", () => {
  it("keeps every collection under the authenticated workspace", () => {
    expect(residentCollectionPath({ workspaceId: "workspace-1", brandId: "brand-1" }, "cycles")).toBe("workspaces/workspace-1/autonomy_cycles");
    expect(() => residentCollectionPath({ workspaceId: "../other", brandId: "brand-1" }, "cycles")).toThrow(/workspace/i);
  });
  it("rejects mutation of immutable evolutionary records", () => {
    const existing = { id: "obs-1", workspaceId: "w", brandId: "b", value: 1 };
    expect(assertImmutableRecord(existing, { ...existing })).toEqual(existing);
    expect(() => assertImmutableRecord(existing, { ...existing, value: 2 })).toThrow(/immutable/i);
  });
});
