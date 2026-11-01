import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard chat drawer contract", () => {
  it("supplies one durable request identity with each chat submission", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/ChatDrawer.tsx"), "utf8");
    expect(source).toContain("const requestId = crypto.randomUUID()");
    expect(source).toContain("requestId,");
  });
});
