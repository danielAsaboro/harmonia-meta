import { describe, expect, it } from "vitest";

import { resolveDecision } from "@/lib/decisions";
import { servicePrincipal } from "@/lib/authority";
import { runWithTenant } from "@/lib/tenancy";

describe("approval authority", () => {
  it("rejects a service principal before storage or effects", async () => {
    await expect(runWithTenant({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      principal: servicePrincipal("worker-request-1"),
    }, () => resolveDecision("job-1", "action-1", "approved", "a".repeat(64)))).rejects.toThrow(
      "human content operator required",
    );
  });
});
