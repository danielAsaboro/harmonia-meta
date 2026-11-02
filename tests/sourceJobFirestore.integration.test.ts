import { afterAll, describe, expect, it } from "vitest";

import { firebasePrincipal } from "@/lib/authority";
import { db, getJob, saveCampaignOutputPlan } from "@/lib/firestore";
import { sealOutputPlan } from "@/lib/outputPlanning";
import { createSourceJob } from "@/lib/sourceManifest";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `source-job-test-${Date.now()}`;
const scope = {
  workspaceId,
  brandId: "brand-test",
  principal: firebasePrincipal({ subjectId: "user-test", workspaceRole: "owner", authenticationId: "firebase-test" }),
};

describe.skipIf(!emulator)("source job Firestore persistence", () => {
  it("creates a source job when optional strategy inputs are absent", async () => {
    const job = await runWithTenant(scope, () => createSourceJob({
      operatorBrief: "Credit NASA; export only; use a small-team analogy.",
      directSources: [{
        kind: "web",
        url: "https://example.com",
        rightsAuthorizationId: "rights-web",
      }],
      desiredOutputs: ["linkedin_post"],
      platforms: ["linkedin"],
    }));

    const persisted = await runWithTenant(scope, () => getJob(job.id));
    expect(persisted?.config).toEqual({
      operatorBrief: "Credit NASA; export only; use a small-team analogy.",
      sourceManifestId: expect.any(String),
      desiredOutputs: ["linkedin_post"],
      allowedOutputs: ["linkedin_post"],
      platforms: ["linkedin"],
    });
    const outputPlan = sealOutputPlan({
      id: `output-plan-${job.id}`,
      desiredOutputs: ["linkedin_post"], allowedOutputs: ["linkedin_post"],
      outputs: [{ id: "output-1-linkedin_post", outputType: "linkedin_post", quantity: 1,
        destinations: ["linkedin"], evidenceRefs: ["source-1:segment-1"],
        costClass: "local", approvalClass: "effect" }],
    });
    await runWithTenant(scope, () => saveCampaignOutputPlan(job.id, outputPlan));
    expect((await runWithTenant(scope, () => getJob(job.id))).campaignOutputPlan).toEqual(outputPlan);
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
