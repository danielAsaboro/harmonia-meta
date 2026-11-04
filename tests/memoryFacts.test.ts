import { describe, expect, it } from "vitest";
import { memoryWriteSchema, rankMemoryFacts } from "@/lib/memoryFacts";

const evidence = { workspace_id: "w1", brand_id: "b1", job_id: "job-1", kind: "decision" as const, record_id: "a1" };

describe("workspace memory facts", () => {
  it("ranks by shared words, breaks ties by recency and drops unrelated facts", () => {
    const facts = [
      { kind: "learning" as const, fact: "Short launch hooks were approved fastest.", evidence_ref: evidence, createdAt: "2026-11-01T00:00:00.000Z" },
      { kind: "learning" as const, fact: "Launch threads with a metric hook earned replies.", evidence_ref: evidence, createdAt: "2026-11-02T00:00:00.000Z" },
      { kind: "learning" as const, fact: "Pricing posts underperformed.", evidence_ref: evidence, createdAt: "2026-11-03T00:00:00.000Z" },
    ];
    expect(rankMemoryFacts(facts, "launch hook ideas", 5).map((fact) => fact.fact)).toEqual([
      "Launch threads with a metric hook earned replies.",
      "Short launch hooks were approved fastest.",
    ]);
    expect(rankMemoryFacts(facts, "launch", 1)).toEqual([
      { kind: "learning", fact: "Launch threads with a metric hook earned replies.", evidence_ref: evidence },
    ]);
  });

  it("returns operator preferences first, newest first, even with no shared words", () => {
    const facts = [
      { kind: "preference" as const, fact: "Operator preference: never use hashtags.", evidence_ref: evidence, createdAt: "2026-11-01T00:00:00.000Z" },
      { kind: "preference" as const, fact: "Operator preference: end with a question for founders.", evidence_ref: evidence, createdAt: "2026-11-04T00:00:00.000Z" },
      { kind: "preference" as const, fact: "Operator preference: oldest one.", evidence_ref: evidence, createdAt: "2026-10-01T00:00:00.000Z" },
      { kind: "learning" as const, fact: "Launch threads with a metric hook earned replies.", evidence_ref: evidence, createdAt: "2026-11-02T00:00:00.000Z" },
    ];
    expect(rankMemoryFacts(facts, "launch hook ideas", 3).map((fact) => fact.fact)).toEqual([
      "Operator preference: end with a question for founders.",
      "Operator preference: never use hashtags.",
      "Launch threads with a metric hook earned replies.",
    ]);
  });

  it("accepts at most five typed facts per write", () => {
    const fact = { kind: "preference", fact: "Use concise hooks.", evidence_ref: evidence };
    expect(memoryWriteSchema.safeParse({ brandId: "b1", facts: [fact] }).success).toBe(true);
    expect(memoryWriteSchema.safeParse({ brandId: "b1", facts: Array(6).fill(fact) }).success).toBe(false);
    expect(memoryWriteSchema.safeParse({ brandId: "b1", facts: [{ ...fact, raw: "draft" }] }).success).toBe(false);
  });
});
