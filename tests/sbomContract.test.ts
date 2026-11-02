import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release inventory contract", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const script = readFileSync(new URL("../scripts/generate-sbom.sh", import.meta.url), "utf8");

  it("generates Node and locked Python inventories", () => {
    expect(pkg.scripts["security:sbom"]).toBe("bash scripts/generate-sbom.sh");
    expect(script).toContain("npm sbom --sbom-format cyclonedx");
    expect(script).toContain("python-lock-sbom.mjs");
  });

  it("supports an actual built-image inventory without inventing one", () => {
    expect(script).toContain("docker scout sbom");
    expect(script).toContain("IMAGE_REF");
  });
});
