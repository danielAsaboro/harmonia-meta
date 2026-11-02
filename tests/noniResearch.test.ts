import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Noni read-only research surface", () => {
  it("exposes a tenant-scoped internal route backed by verified durable publication truth", () => {
    const route = "src/app/api/internal/published-content/route.ts";
    expect(existsSync(route)).toBe(true);
    if (!existsSync(route)) return;
    const source = readFileSync(route, "utf8");
    expect(source).toContain("internalTenantHandler");
    expect(source).toContain("listVerifiedPublications");
  });

  it("requires applied receipts, successful verification, and canonical URLs", () => {
    const source = readFileSync("src/lib/firestore.ts", "utf8");
    expect(source).toContain("export async function listVerifiedPublications");
    expect(source).toContain('receipt.outcome !== "applied"');
    expect(source).toContain("verification.verified");
    expect(source).toContain("canonicalUrl");
  });
});
