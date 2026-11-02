import { describe, expect, it } from "vitest";

import { getPlatform } from "@/lib/oauth";

describe("social OAuth product availability", () => {
  it.each(["instagram", "linkedin", "linkedin-organization", "youtube", "tiktok"])(
    "allows %s OAuth connection before publish evidence exists",
    (platform) => {
      expect(getPlatform(platform)?.productAvailability).toBe("oauth_connectable");
    },
  );

  it("keeps the unsupported Facebook connector disabled", () => {
    expect(getPlatform("facebook")?.productAvailability).toBe("credential_groundwork");
  });
});
