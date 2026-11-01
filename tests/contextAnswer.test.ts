import { describe, expect, it } from "vitest";
import { isValidContext } from "@/lib/contextAnswer";

describe("isValidContext", () => {
  it("accepts known kinds with ids", () => {
    expect(isValidContext({ kind: "job", id: "j1" })).toBe(true);
    expect(isValidContext({ kind: "content_item", id: "item-1" })).toBe(true);
    expect(isValidContext({ kind: "proposal", id: "prop-1" })).toBe(true);
  });

  it("rejects unknown kinds and missing ids", () => {
    expect(isValidContext({ kind: "receipt", id: "r1" })).toBe(false);
    expect(isValidContext({ kind: "job" })).toBe(false);
    expect(isValidContext(null)).toBe(false);
    expect(isValidContext("job")).toBe(false);
  });
});
