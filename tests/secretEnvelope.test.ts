import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/secretEnvelope";

const key = Buffer.alloc(32, 7).toString("base64");

describe("connection secret envelopes", () => {
  it("stores no plaintext and binds ciphertext to tenant metadata", () => {
    const encrypted = encryptSecret("access-secret", key, "workspace-1:x");
    expect(JSON.stringify(encrypted)).not.toContain("access-secret");
    expect(decryptSecret(encrypted, key, "workspace-1:x")).toBe("access-secret");
    expect(() => decryptSecret(encrypted, key, "workspace-2:x")).toThrow();
  });

  it("fails closed without a valid 256-bit key", () => {
    expect(() => encryptSecret("secret", "", "scope")).toThrow("envelope key");
  });
});
