import { describe, expect, it, vi } from "vitest";

import { discoverPublishDestinations } from "@/lib/oauth";
import { PLATFORMS } from "@/lib/platforms";

const platform = (id: string) => PLATFORMS.find((item) => item.id === id)!;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("OAuth destination routing", () => {
  it("routes YouTube grants through explicit channel discovery", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [{ id: "channel-1" }] }));
    await expect(discoverPublishDestinations(platform("youtube"), {
      accessToken: "token",
      scopes: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    }, request)).resolves.toEqual([{ kind: "youtube_channel", id: "channel-1" }]);
  });

  it("does not invent destinations for non-publishing connections", async () => {
    await expect(discoverPublishDestinations(platform("google-calendar"), {
      accessToken: "token",
      scopes: "https://www.googleapis.com/auth/calendar.app.created",
    }, vi.fn())).resolves.toEqual([]);
  });

  it("routes the dedicated LinkedIn organization client independently", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      elements: [{ state: "APPROVED", role: "ADMINISTRATOR", organizationalTarget: "urn:li:organization:42" }],
    }));
    await expect(discoverPublishDestinations(platform("linkedin-organization"), {
      accessToken: "token",
      scopes: "w_organization_social",
    }, request)).resolves.toEqual([{ kind: "linkedin_organization", id: "42" }]);
  });
});
