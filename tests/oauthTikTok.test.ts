import { afterEach, describe, expect, it, vi } from "vitest";

import { exchangeCode, getPlatform } from "../src/lib/oauth";

describe("TikTok OAuth parameter compatibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
  });

  it("declares TikTok's client_key parameter", () => {
    expect(getPlatform("tiktok")?.oauth.clientIdParam).toBe("client_key");
  });

  it("uses client_key when exchanging a TikTok authorization code", async () => {
    process.env.TIKTOK_CLIENT_KEY = "sandbox-client-key";
    process.env.TIKTOK_CLIENT_SECRET = "sandbox-client-secret";
    let postedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      postedBody = String(init?.body);
      return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
    }));

    await exchangeCode(getPlatform("tiktok")!, {
      code: "code",
      redirectUri: "https://useharmonia.xyz/api/oauth/tiktok/callback",
    });

    const params = new URLSearchParams(postedBody);
    expect(params.get("client_key")).toBe("sandbox-client-key");
    expect(params.has("client_id")).toBe(false);
  });
});
