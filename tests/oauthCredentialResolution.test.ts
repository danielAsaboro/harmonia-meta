import { describe, expect, it } from "vitest";

import { getPlatform, oauthCredentialEnvNames } from "@/lib/oauth";

describe("OAuth application credential resolution", () => {
  it("resolves Meta APP_ID and APP_SECRET variables", () => {
    const instagram = getPlatform("instagram");
    expect(instagram).toBeDefined();
    expect(oauthCredentialEnvNames(instagram!)).toEqual({
      clientId: "INSTAGRAM_APP_ID",
      clientSecret: "INSTAGRAM_APP_SECRET",
    });
  });

  it("preserves standard client and key naming", () => {
    expect(oauthCredentialEnvNames(getPlatform("youtube")!)).toEqual({
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
    expect(oauthCredentialEnvNames(getPlatform("tiktok")!)).toEqual({
      clientId: "TIKTOK_CLIENT_KEY",
      clientSecret: "TIKTOK_CLIENT_SECRET",
    });
  });
});
