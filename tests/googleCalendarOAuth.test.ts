import { describe, expect, it } from "vitest";
import { getPlatform } from "@/lib/oauth";

describe("Google Calendar OAuth registration", () => {
  it("requests only app-created calendar access and offline consent", () => {
    const platform = getPlatform("google-calendar");
    expect(platform).toBeDefined();
    expect(platform?.requiredEnv).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    expect(platform?.oauth.scopes).toEqual(["https://www.googleapis.com/auth/calendar.app.created"]);
    expect(platform?.oauth.extraAuthorizeParams).toEqual({ access_type: "offline", prompt: "consent" });
  });
});
