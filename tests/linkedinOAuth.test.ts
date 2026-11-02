import { describe, expect, it, vi } from "vitest";

import { discoverLinkedInDestinations } from "@/lib/publishing/linkedinOAuth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LinkedIn OAuth destination discovery", () => {
  it("keeps the member and includes only approved administrator organizations", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ sub: "member-7", name: "Daniel" }))
      .mockResolvedValueOnce(json({
        elements: [
          { state: "APPROVED", role: "ADMINISTRATOR", organizationalTarget: "urn:li:organization:42" },
          { state: "REQUESTED", role: "ADMINISTRATOR", organizationalTarget: "urn:li:organization:43" },
          { state: "APPROVED", role: "CURATOR", organizationalTarget: "urn:li:organization:44" },
        ],
      }));

    await expect(discoverLinkedInDestinations(
      "secret-token",
      ["openid", "w_member_social", "w_organization_social"],
      request,
    )).resolves.toEqual([
      { kind: "linkedin_member", id: "member-7" },
      { kind: "linkedin_organization", id: "42" },
    ]);
    expect(request).toHaveBeenNthCalledWith(1, "https://api.linkedin.com/v2/userinfo", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
    }));
  });

  it("rejects grants without a publishing scope", async () => {
    await expect(discoverLinkedInDestinations("token", ["openid", "profile"], vi.fn()))
      .rejects.toThrow("LinkedIn publishing permission is required");
  });

  it("discovers approved organizations without requiring member identity scope", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      elements: [
        { state: "APPROVED", role: "ADMINISTRATOR", organizationalTarget: "urn:li:organization:42" },
      ],
    }));
    await expect(discoverLinkedInDestinations("token", ["w_organization_social"], request))
      .resolves.toEqual([{ kind: "linkedin_organization", id: "42" }]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not expose provider bodies in errors", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ message: "token=very-secret" }, 401));

    await expect(discoverLinkedInDestinations("secret-token", ["w_member_social"], request))
      .rejects.toThrow("LinkedIn identity request failed (401)");
    await expect(discoverLinkedInDestinations("secret-token", ["w_member_social"], request))
      .rejects.not.toThrow("very-secret");
  });
});
