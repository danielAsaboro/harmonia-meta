import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const eraseWorkspace = source.slice(
  source.indexOf("export async function eraseWorkspaceData"),
  source.indexOf("export async function createJob"),
);

describe("workspace erasure safety contract", () => {
  it("refuses erasure while provider credentials still require revocation", () => {
    expect(eraseWorkspace).toContain("tenantCollection(CONNECTIONS).get()");
    expect(eraseWorkspace).toContain("disconnect external connections before workspace deletion");
  });

  it("deletes outstanding OAuth state records scoped to the workspace", () => {
    expect(eraseWorkspace).toContain('.collection("oauth_states")');
    expect(eraseWorkspace).toContain('.where("workspaceId", "==", plan.workspaceId)');
  });

  it("removes only the matching user-to-workspace pointer", () => {
    expect(eraseWorkspace).toContain('.collection("users").doc(actorSubjectId)');
    expect(eraseWorkspace).toContain('user.get("defaultWorkspaceId") === plan.workspaceId');
    expect(eraseWorkspace).toContain("await user.ref.delete()");
  });
});
