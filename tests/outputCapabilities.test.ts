import { describe, expect, it } from "vitest";
import { OUTPUT_CAPABILITIES, availableOutputKinds } from "@/lib/outputCapabilities";
import { OUTPUT_KINDS } from "@/lib/contracts";

describe("output capability registry", () => {
  it("covers every output kind and exposes only complete capabilities", () => {
    expect(Object.keys(OUTPUT_CAPABILITIES).sort()).toEqual([...OUTPUT_KINDS].sort());
    expect(availableOutputKinds({ hasTimedVideo: false, hasVerbatimQuote: true })).not.toContain("short_clip");
    expect(availableOutputKinds({ hasTimedVideo: true, hasVerbatimQuote: true })).toContain("short_clip");
    expect(OUTPUT_CAPABILITIES.linkedin_post.state).toBe("publish_when_connected");
    expect(OUTPUT_CAPABILITIES.blog_article.state).toBe("verified_export");
  });
});
