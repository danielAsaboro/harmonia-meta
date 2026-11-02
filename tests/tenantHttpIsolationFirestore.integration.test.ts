import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/jobs/[id]/route";
import { db } from "@/lib/firestore";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const foreignWorkspaceId = "http-isolation-foreign";
const jobId = "shared-http-job";
let authenticatedWorkspaceId = "";

function request(workspaceOverride: string): Request {
  return new Request(`http://localhost/api/jobs/${jobId}`, {
    headers: {
      cookie: "harmonia_session=dev-local",
      "x-workspace-id": workspaceOverride,
      "x-brand-id": "caller-controlled-brand",
    },
  });
}

function routeArgs() {
  return { params: Promise.resolve({ id: jobId }) };
}

function job(workspaceId: string, brandId: string) {
  const now = "2026-08-30T15:00:00.000Z";
  return {
    id: jobId,
    workspaceId,
    brandId,
    createdByUserId: "operator",
    createdAt: now,
    updatedAt: now,
    status: "running",
    stage: "draft",
    config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
    actions: [],
  };
}

describe.skipIf(!emulator)("HTTP tenant isolation", () => {
  beforeAll(() => {
    process.env.HARMONIA_DEV_AUTH_BYPASS = "1";
  });

  it("ignores caller-controlled tenant headers and reads only the authenticated workspace", async () => {
    await db().doc(`workspaces/${foreignWorkspaceId}/jobs/${jobId}`).set(
      job(foreignWorkspaceId, "foreign-brand"),
    );

    await expect(GET(request(foreignWorkspaceId), routeArgs())).rejects.toThrow("job not found");

    const user = await db().collection("users").doc("dev-local-user").get();
    authenticatedWorkspaceId = user.get("defaultWorkspaceId") as string;
    const authenticatedBrandId = user.get("defaultBrandId") as string;
    expect(authenticatedWorkspaceId).toBeTruthy();
    expect(authenticatedWorkspaceId).not.toBe(foreignWorkspaceId);

    await db().doc(`workspaces/${authenticatedWorkspaceId}/jobs/${jobId}`).set(
      job(authenticatedWorkspaceId, authenticatedBrandId),
    );

    const response = await GET(request(foreignWorkspaceId), routeArgs());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job).toMatchObject({ id: jobId, workspaceId: authenticatedWorkspaceId });
    expect(body.job.workspaceId).not.toBe(foreignWorkspaceId);
  });

  afterAll(async () => {
    delete process.env.HARMONIA_DEV_AUTH_BYPASS;
    if (!emulator) return;
    await db().recursiveDelete(db().doc(`workspaces/${foreignWorkspaceId}`));
    if (authenticatedWorkspaceId) {
      await db().recursiveDelete(db().doc(`workspaces/${authenticatedWorkspaceId}`));
    }
    await db().collection("users").doc("dev-local-user").delete();
  });
});
