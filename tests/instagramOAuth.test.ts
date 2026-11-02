import { describe, expect, it, vi } from "vitest";

import { getPlatform } from "@/lib/oauth";
import { discoverInstagramDestinations } from "@/lib/publishing/instagramOAuth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Instagram OAuth destination discovery", () => {
  it("requires the Meta business-login configuration for authorization", () => {
    const platform = getPlatform("instagram");

    expect(platform?.requiredEnv).toContain("INSTAGRAM_CONFIGURATION_ID");
    expect(platform?.oauth.extraAuthorizeEnvParams).toEqual({
      config_id: "INSTAGRAM_CONFIGURATION_ID",
    });
  });

  it("paginates Pages, filters non-professional accounts, and removes duplicates", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        data: [
          { id: "page-1", instagram_business_account: { id: "ig-1" } },
          { id: "page-2" },
        ],
        paging: { next: "https://graph.facebook.com/v21.0/me/accounts?after=abc" },
      }))
      .mockResolvedValueOnce(json({
        data: [
          { id: "page-1", instagram_business_account: { id: "ig-1" } },
          { id: "page-3", instagram_business_account: { id: "ig-3" } },
        ],
      }));

    await expect(discoverInstagramDestinations("token", [
      "instagram_basic", "instagram_content_publish", "pages_show_list",
    ], request)).resolves.toEqual([
      { kind: "instagram_professional", id: "ig-1", pageId: "page-1" },
      { kind: "instagram_professional", id: "ig-3", pageId: "page-3" },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects incomplete publishing permission grants", async () => {
    await expect(discoverInstagramDestinations("token", ["instagram_basic"], vi.fn()))
      .rejects.toThrow("Instagram publishing permissions are required");
  });

  it("sanitizes provider failures", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { message: "secret body" } }, 403));
    await expect(discoverInstagramDestinations("token", [
      "instagram_basic", "instagram_content_publish", "pages_show_list",
    ], request)).rejects.toThrow("Instagram Page discovery failed (403)");
    await expect(discoverInstagramDestinations("token", [
      "instagram_basic", "instagram_content_publish", "pages_show_list",
    ], request)).rejects.not.toThrow("secret body");
  });
});
