import { describe, expect, it } from "vitest";

import { effectClaimSubmissionSchema, receiptSubmissionSchema } from "@/lib/contracts";
import { decideEffectFinalization } from "@/lib/effectClaims";
import type { EffectClaim } from "@/lib/types";

const claim: EffectClaim = {
  id: "a".repeat(64), jobId: "job-1", actionId: "action-1",
  actionType: "export_content_artifact", idempotencyKey: "a".repeat(64),
  operationId: "job-1:publish:action-1", traceId: "b".repeat(32),
  claimToken: "claim-token-1", state: "claimed", attempt: 1,
  claimedAt: "2026-08-25T01:00:00.000Z", leaseExpiresAt: "2026-08-25T01:05:00.000Z",
};

describe("effect claim contracts and finalization", () => {
  it("accepts immutable artifact export identities and receipts", () => {
    const identity = {
      jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
      idempotencyKey: "a".repeat(64), operationId: "job-1:effect:export",
      traceId: "b".repeat(32), claimToken: "claim-token-1",
    };
    expect(effectClaimSubmissionSchema.safeParse(identity).success).toBe(true);
    expect(receiptSubmissionSchema.safeParse({
      ...identity, outcome: "applied",
      artifact: { kind: "asset_store", url: "/api/internal/content-artifacts/artifact-1", fetchedAt: "2026-08-30T00:00:00.000Z", digest: "c".repeat(64) },
      detail: { artifactId: "artifact-1", artifactDigest: "d".repeat(64), markdownDigest: "e".repeat(64), jsonDigest: "f".repeat(64) },
    }).success).toBe(true);
  });
  it.each(["publish_x_post", "publish_x_thread", "publish_linkedin_post"])(
    "accepts the %s external effect at claim and receipt boundaries",
    (actionType) => {
      const identity = {
        jobId: "job-1", actionId: "action-1", actionType,
        idempotencyKey: "a".repeat(64), operationId: `job-1:effect:${actionType}`,
        traceId: "b".repeat(32), claimToken: "claim-token-1",
      };
      expect(effectClaimSubmissionSchema.safeParse(identity).success).toBe(true);
      expect(receiptSubmissionSchema.safeParse({
        ...identity, outcome: "applied", detail: { providerId: "opaque-provider-id" },
      }).success).toBe(true);
    },
  );

  it("requires a unique claim token and real trace metadata", () => {
    const valid = {
      jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
      idempotencyKey: "a".repeat(64), operationId: "job-1:publish:action-1",
      traceId: "b".repeat(32), claimToken: "claim-token-1",
    };
    expect(effectClaimSubmissionSchema.safeParse(valid).success).toBe(true);
    expect(effectClaimSubmissionSchema.safeParse({ ...valid, claimToken: "" }).success).toBe(false);
    expect(effectClaimSubmissionSchema.safeParse({ ...valid, traceId: "0".repeat(32) }).success).toBe(false);
  });

  it("requires receipt finalization to present its claim token", () => {
    const valid = {
      jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
      idempotencyKey: "a".repeat(64), operationId: "job-1:publish:action-1",
      traceId: "b".repeat(32), claimToken: "claim-token-1",
      outcome: "applied", detail: {},
    };
    expect(receiptSubmissionSchema.safeParse(valid).success).toBe(true);
    expect(receiptSubmissionSchema.safeParse({ ...valid, claimToken: undefined }).success).toBe(false);
  });

  it("finalizes only the owning claim and links the immutable receipt", () => {
    expect(decideEffectFinalization(claim, "claim-token-1", "receipt-1", "applied", new Date("2026-08-25T01:01:00Z"))).toMatchObject({
      duplicate: false,
      claim: { state: "applied", receiptId: "receipt-1", finalizedAt: "2026-08-25T01:01:00.000Z" },
    });
    expect(() => decideEffectFinalization(claim, "another-owner", "receipt-1", "applied")).toThrow("owner mismatch");
  });

  it("returns the original receipt when a finalized claim is presented again", () => {
    const applied = { ...claim, state: "applied" as const, receiptId: "receipt-original" };
    expect(decideEffectFinalization(applied, "another-owner", "receipt-new", "applied")).toMatchObject({
      duplicate: true, receiptId: "receipt-original",
    });
  });
});
