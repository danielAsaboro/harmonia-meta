import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("checked-in verification gate", () => {
  const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");

  it("runs application, agent, emulator, type, lint, and build checks", () => {
    for (const command of [
      "npm test",
      "npm run test:integration",
      "npm run test:agent",
      "npm run lint",
      "npx tsc --noEmit",
      "npm run build",
    ]) expect(workflow).toContain(`run: ${command}`);
  });

  it("installs Java and the official Firestore emulator for required integration tests", () => {
    expect(workflow).toContain("actions/setup-java@");
    expect(workflow).toContain("cloud-firestore-emulator");
  });
});
