import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("required Firestore integration harness", () => {
  it("exposes a checked-in required integration command", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["test:integration"]).toBe("bash scripts/test-firestore-integration.sh");
  });

  it("starts and owns a Firestore emulator before running integration tests", () => {
    const script = readFileSync(new URL("../scripts/test-firestore-integration.sh", import.meta.url), "utf8");
    expect(script).toContain("gcloud beta emulators firestore start");
    expect(script).toContain("FIRESTORE_EMULATOR_HOST");
    expect(script).toContain("vitest run tests/*Firestore.integration.test.ts");
    expect(script).toContain("durableRuntimeObservability.integration.test.ts");
  });
});
