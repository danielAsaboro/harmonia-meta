import { describe, expect, it, vi } from "vitest";

import { discoverYouTubeDestinations } from "@/lib/publishing/youtubeOAuth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

describe("YouTube OAuth destination discovery", () => {
  it("returns the one channel explicitly authorized by mine=true", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [{ id: "channel-9" }] }));
    await expect(discoverYouTubeDestinations("token", scopes, request)).resolves.toEqual([
      { kind: "youtube_channel", id: "channel-9" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token" }) }),
    );
  });

  it("rejects missing channels and multiple channels", async () => {
    await expect(discoverYouTubeDestinations("token", scopes, vi.fn().mockResolvedValue(json({ items: [] }))))
      .rejects.toThrow("must resolve exactly one YouTube channel");
    await expect(discoverYouTubeDestinations("token", scopes, vi.fn().mockResolvedValue(json({ items: [{ id: "1" }, { id: "2" }] }))))
      .rejects.toThrow("must resolve exactly one YouTube channel");
  });

  it("rejects insufficient scopes and sanitizes provider errors", async () => {
    await expect(discoverYouTubeDestinations("token", [scopes[0]], vi.fn()))
      .rejects.toThrow("YouTube upload and read permissions are required");
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      error: { message: "secret body", errors: [{ reason: "youtubeSignupRequired" }] },
    }, 403));
    await expect(discoverYouTubeDestinations("token", scopes, request))
      .rejects.toThrow("YouTube channel discovery failed (403: youtubeSignupRequired)");
    await expect(discoverYouTubeDestinations("token", scopes, request))
      .rejects.not.toThrow("secret body");
  });
});
