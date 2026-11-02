import { afterEach, describe, expect, it } from "vitest";

import { oauthRedirectUri } from "@/lib/oauth";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("OAuth redirect URI generation", () => {
  it("uses the configured public app URL behind Cloud Run proxies", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://useharmonia.xyz/";

    expect(oauthRedirectUri(new Request("http://0.0.0.0:8080/api/oauth/youtube/authorize"), "youtube"))
      .toBe("https://useharmonia.xyz/api/oauth/youtube/callback");
  });

  it("falls back to the request origin for local development", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(oauthRedirectUri(new Request("http://localhost:3000/api/oauth/x/authorize"), "x"))
      .toBe("http://localhost:3000/api/oauth/x/callback");
  });
});
