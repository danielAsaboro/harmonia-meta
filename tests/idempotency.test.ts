import { describe, expect, it } from "vitest";
import { contentHash, idempotencyKey, newId } from "@/lib/idempotency";

describe("idempotency keys", () => {
  it("are stable for identical inputs", () => {
    expect(idempotencyKey("job1", "a1", contentHash("hello"))).toBe(
      idempotencyKey("job1", "a1", contentHash("hello")),
    );
  });

  it("differ across jobs, actions, or content", () => {
    const base = idempotencyKey("job1", "a1", contentHash("x"));
    expect(base).not.toBe(idempotencyKey("job2", "a1", contentHash("x")));
    expect(base).not.toBe(idempotencyKey("job1", "a2", contentHash("x")));
    expect(base).not.toBe(idempotencyKey("job1", "a1", contentHash("y")));
  });

  it("newId returns unique identifiers", () => {
    expect(newId()).not.toBe(newId());
  });
});
