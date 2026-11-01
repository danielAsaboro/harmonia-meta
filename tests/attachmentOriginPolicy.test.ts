import { describe, expect, it } from "vitest";
import { attachmentOriginPolicy } from "@/lib/attachmentOrigins";

describe("attachment origin policy", () => {
  const environment = {
    PUBLIC_BASE_URL: "https://useharmonia.xyz",
    ATTACHMENT_ALLOWED_ORIGINS: "https://useharmonia.xyz, https://harmonia-web.example.run.app",
  };

  it.each([
    "https://useharmonia.xyz",
    "https://harmonia-web.example.run.app",
  ])("accepts configured origin %s", (origin) => {
    const policy = attachmentOriginPolicy(environment, "https://useharmonia.xyz/api/chat/attachments/session");
    expect(policy.accepts(origin)).toBe(true);
    expect(policy.uploadOrigin(origin)).toBe(origin);
  });

  it("rejects an origin outside the configured allowlist", () => {
    const policy = attachmentOriginPolicy(environment, "https://useharmonia.xyz/api/chat/attachments/session");
    expect(policy.accepts("https://attacker.example")).toBe(false);
  });

  it("fails closed when an allowlisted origin is malformed", () => {
    expect(() => attachmentOriginPolicy({
      ...environment,
      ATTACHMENT_ALLOWED_ORIGINS: "https://useharmonia.xyz,not-a-url",
    }, "https://useharmonia.xyz/api/chat/attachments/session")).toThrow("invalid attachment allowed origin");
  });

  it("falls back to the canonical public origin when no allowlist is configured", () => {
    const policy = attachmentOriginPolicy(
      { PUBLIC_BASE_URL: "https://useharmonia.xyz" },
      "https://harmonia-web.example.run.app/api/chat/attachments/session",
    );
    expect(policy.accepts("https://useharmonia.xyz")).toBe(true);
    expect(policy.accepts("https://harmonia-web.example.run.app")).toBe(false);
  });
});
