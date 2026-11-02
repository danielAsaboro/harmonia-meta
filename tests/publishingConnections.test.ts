import { describe, expect, it } from "vitest";

import { sanitizeSocialConnection, selectDefaultDestination } from "@/lib/publishing/connections";
import type { ConnectionDoc } from "@/lib/firestore";

const connection: ConnectionDoc = {
  platform: "linkedin",
  mode: "oauth",
  handle: "Daniel",
  accountId: "member-1",
  scopes: "openid profile w_member_social",
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  credentialRevision: 3,
  health: "active",
  destinations: [
    { kind: "linkedin_member", id: "member-1" },
    { kind: "linkedin_organization", id: "org-1" },
  ],
  defaultDestinationId: "member-1",
  connectedAt: "2026-08-29T06:00:00.000Z",
};

describe("workspace social connections", () => {
  it("returns destination metadata without returning credentials", () => {
    const projection = sanitizeSocialConnection(connection);

    expect(projection).toEqual({
      platform: "linkedin",
      mode: "oauth",
      handle: "Daniel",
      accountId: "member-1",
      scopes: ["openid", "profile", "w_member_social"],
      credentialRevision: 3,
      health: "active",
      destinations: connection.destinations,
      defaultDestinationId: "member-1",
      connectedAt: "2026-08-29T06:00:00.000Z",
    });
    expect(projection).not.toHaveProperty("accessToken");
    expect(projection).not.toHaveProperty("refreshToken");
  });

  it("selects only a destination owned by the connection", () => {
    expect(selectDefaultDestination(connection, "org-1").defaultDestinationId).toBe("org-1");
    expect(() => selectDefaultDestination(connection, "org-other")).toThrow("destination is not authorized");
  });
});
