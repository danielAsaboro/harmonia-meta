import { describe, expect, it } from "vitest";
import { firebasePrincipal } from "@/lib/authority";
import { hasRightsAttestation, sourceRightsAuthorization } from "@/lib/sourceRights";

describe("source-rights authorization", () => {
  it("requires an explicit deterministic attestation phrase", () => {
    expect(hasRightsAttestation("please make clips")).toBe(false);
    expect(hasRightsAttestation("I confirm I have rights to use this source")).toBe(true);
  });

  it("persists verified actor provenance before ingestion", () => {
    expect(sourceRightsAuthorization({
      workspaceId: "workspace-1", brandId: "brand-1",
      principal: firebasePrincipal({ subjectId: "user-1", workspaceRole: "member", authenticationId: "session-1" }),
    }, "youtube", "2026-08-26T00:00:00.000Z")).toMatchObject({
      version: "source-rights-v1", sourceKind: "youtube", attestedBySubjectId: "user-1", channel: "dashboard",
    });
  });
});
