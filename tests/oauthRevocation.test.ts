import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatform, revokeAccess } from "@/lib/oauth";

describe("OAuth token revocation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("revokes Google grants with the refresh token", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    await revokeAccess(getPlatform("google-calendar")!, {
      accessToken: "access-token",
      refreshToken: "refresh-token",
    }, request);

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe("token=refresh-token");
  });

  it("revokes X grants using confidential-client authentication", async () => {
    vi.stubEnv("X_CLIENT_ID", "client-id");
    vi.stubEnv("X_CLIENT_SECRET", "client-secret");
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    await revokeAccess(getPlatform("x")!, { accessToken: "access-token" }, request);

    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/oauth2/revoke");
    expect(init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    });
    expect(String(init?.body)).toBe("token=access-token&client_id=client-id");
  });

  it("keeps local credentials available for retry when revocation fails", async () => {
    const request = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response("invalid token", { status: 400 }));
    await expect(revokeAccess(
      getPlatform("google-calendar")!,
      { accessToken: "access-token" },
      request,
    )).rejects.toThrow("revocation failed (400)");
  });

  it("refuses unsupported providers instead of pretending to revoke access", async () => {
    await expect(revokeAccess(
      getPlatform("tiktok")!,
      { accessToken: "access-token" },
      vi.fn(),
    )).rejects.toThrow("token revocation is not implemented for tiktok");
  });
});
