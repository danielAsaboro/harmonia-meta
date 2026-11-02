import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../scripts/dev.sh", import.meta.url), "utf8");

describe("local development runtime", () => {
  it("adds the Homebrew JDK when macOS exposes only the Java launcher stub", () => {
    expect(script).toContain("/opt/homebrew/opt/openjdk/bin");
    expect(script).toContain('command -v java');
  });
});
