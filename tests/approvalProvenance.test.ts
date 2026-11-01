import { describe, expect, it } from "vitest";

import { firebasePrincipal, requireProductionOperator, telegramPrincipal } from "@/lib/authority";
import { approvalActor, assertApprovalPayload } from "@/lib/decisions";
import { actionPayloadDigest } from "@/lib/idempotency";
import type { PlannedAction } from "@/lib/types";
import type { TenantContext } from "@/lib/tenancy";

function action(payload: Record<string, unknown>): PlannedAction {
  return {
    id: "action-1",
    jobId: "job-1",
    type: "publish_x_post",
    title: "Publish launch post",
    description: "Publish the approved copy",
    risk: "high",
    requiresApproval: true,
    approvalState: "pending",
    payload,
    state: "planned",
  };
}

function context(principal: TenantContext["principal"]): TenantContext {
  return { workspaceId: "workspace-1", brandId: "brand-1", principal };
}

describe("approval provenance", () => {
  it("computes a canonical digest independent of object key order", () => {
    expect(actionPayloadDigest(action({ text: "Launch", metadata: { b: 2, a: 1 } })))
      .toBe(actionPayloadDigest(action({ metadata: { a: 1, b: 2 }, text: "Launch" })));
  });

  it("rejects a decision after the material action payload changes", () => {
    const expected = actionPayloadDigest(action({ text: "Original" }));
    expect(() => assertApprovalPayload(action({ text: "Changed" }), expected))
      .toThrow("approval payload changed");
  });

  it("derives dashboard and Telegram provenance from verified principals", () => {
    expect(approvalActor(context(firebasePrincipal({
      subjectId: "firebase-1",
      workspaceRole: "member",
      authenticationId: "session-1",
    })))).toEqual({
      actorType: "firebase_operator",
      actorSubjectId: "firebase-1",
      authenticationId: "session-1",
      channel: "dashboard",
    });
    expect(approvalActor(context(telegramPrincipal({
      subjectId: "telegram-1",
      authenticationId: "update-1",
      chatIdDigest: "a".repeat(64),
      callbackQueryIdDigest: "b".repeat(64),
    })))).toMatchObject({ actorType: "telegram_operator", channel: "telegram" });
  });

  it("permits paid-production approval only for administrators or allow-listed Telegram operators", () => {
    expect(() => requireProductionOperator(context(firebasePrincipal({
      subjectId: "member-1", workspaceRole: "member", authenticationId: "session-member",
    })))).toThrow(/administrator/i);
    expect(requireProductionOperator(context(firebasePrincipal({
      subjectId: "admin-1", workspaceRole: "admin", authenticationId: "session-admin",
    })))).toMatchObject({ subjectId: "admin-1" });
    expect(requireProductionOperator(context(telegramPrincipal({
      subjectId: "telegram-1", authenticationId: "update-1",
      chatIdDigest: "a".repeat(64), callbackQueryIdDigest: "b".repeat(64),
    })))).toMatchObject({ subjectId: "telegram-1" });
  });
});
