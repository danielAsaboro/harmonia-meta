import { describe, expect, it } from "vitest";
import { proposalDecisionSchema, proposalSubmissionSchema } from "@/lib/contracts";

const validProposal = {
  id: "prop-0123456789abcdef",
  source: "trend_scan",
  topic: "Founder take on the agents-replacing-tools wave",
  angle: "Contrarian operator perspective",
  reason: "Front-page attention window",
  sources: ["https://news.ycombinator.com/item?id=8800001"],
  suggestedPost: "",
};

describe("proposalSubmissionSchema", () => {
  it("accepts a well-formed batch", () => {
    const parsed = proposalSubmissionSchema.safeParse({ proposals: [validProposal] });
    expect(parsed.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const parsed = proposalSubmissionSchema.safeParse({
      proposals: [{ id: "prop-abcdef0123456789", source: "engagement_watch", topic: "Follow up on breakout post" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.proposals[0].sources).toEqual([]);
      expect(parsed.data.proposals[0].angle).toBe("");
    }
  });

  it("rejects unknown sources and bad urls", () => {
    expect(
      proposalSubmissionSchema.safeParse({
        proposals: [{ ...validProposal, source: "vibes" }],
      }).success,
    ).toBe(false);
    expect(
      proposalSubmissionSchema.safeParse({
        proposals: [{ ...validProposal, sources: ["not-a-url"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects empty batches", () => {
    expect(proposalSubmissionSchema.safeParse({ proposals: [] }).success).toBe(false);
  });
});

describe("proposalDecisionSchema", () => {
  it("accepts approved and rejected decisions", () => {
    expect(proposalDecisionSchema.safeParse({ id: "p1", decision: "approved" }).success).toBe(true);
    expect(proposalDecisionSchema.safeParse({ id: "p1", decision: "rejected" }).success).toBe(true);
  });

  it("rejects other decisions", () => {
    expect(proposalDecisionSchema.safeParse({ id: "p1", decision: "maybe" }).success).toBe(false);
  });
});
