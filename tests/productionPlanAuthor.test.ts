import { describe, expect, it, vi } from "vitest";
import { authorProductionPlan } from "@/lib/productionPlanAuthor";
import { compileProductionOperations } from "@/lib/mediaProduction";

const job = {
  id: "job-author-1",
  sourceAnalysis: { summary: "A founder explains Harmonia's verified content workflow", moments: [] },
};
const pricing = {
  version: "google-media-2026-08-31",
  veo31FastUsdPerSecond: "0.080000",
  lyria3ClipFixedUsd: "0.040000",
};

describe("production plan author", () => {
  it("turns a grounded creative draft into a supported, exactly quoted first revision", async () => {
    const generateDraft = vi.fn().mockResolvedValue({
      goal: "Show the verified workflow", audience: "startup founders", tone: ["clear", "credible"],
      platform: "linkedin", aspectRatio: "9:16", resolution: "1080p", frameRate: 30,
      scenes: [
        { purpose: "Open on the problem", prompt: "A founder facing a fragmented content workflow", durationSec: 4 },
        { purpose: "Reveal Harmonia", prompt: "A precise autonomous content pipeline coming into focus", durationSec: 6 },
      ],
      soundtrack: { include: true, prompt: "Minimal instrumental technology pulse" },
    });
    const plan = await authorProductionPlan({
      job, workspaceId: "workspace-1", brandId: "brand-1", request: "Create a concise launch film",
      generateDraft, pricing,
    });
    expect(plan).toMatchObject({
      id: expect.stringMatching(/^media-/), jobId: job.id, revision: 1,
      target: { durationSec: 10, aspectRatio: "9:16", resolution: "1080p" },
      estimatedCostUsd: "0.840000", maximumCostUsd: "0.840000",
    });
    expect(Object.values(plan.operationCostsUsd)).toEqual(["0.320000", "0.480000", "0.040000"]);
    expect(plan.soundtrack).toMatchObject({ modelCapability: "lyria-3-clip", instrumental: true, targetDurationSec: 30 });
    expect(compileProductionOperations(plan).filter((operation) => operation.executionAuthority === "production_mandate")).toHaveLength(3);
  });

  it("keeps the plan identity and increments the revision when revising", async () => {
    const generateDraft = vi.fn().mockResolvedValue({
      goal: "Use one focused shot", audience: "startup founders", tone: ["direct"], platform: "x",
      aspectRatio: "16:9", resolution: "720p", frameRate: 24,
      scenes: [{ purpose: "One product reveal", prompt: "A calm product reveal", durationSec: 4 }],
      soundtrack: { include: false },
    });
    const plan = await authorProductionPlan({
      job, workspaceId: "workspace-1", brandId: "brand-1", request: "Remove the soundtrack",
      existing: { id: "media-existing", revision: 3 } as never, generateDraft, pricing,
    });
    expect(plan).toMatchObject({ id: "media-existing", revision: 4, estimatedCostUsd: "0.320000" });
    expect(plan.soundtrack).toBeUndefined();
  });

  it("fails closed instead of sealing paid operations with missing deployment prices", async () => {
    const generateDraft = vi.fn().mockResolvedValue({
      goal: "One shot", audience: "founders", tone: ["direct"], platform: "x",
      aspectRatio: "16:9", resolution: "720p", frameRate: 24,
      scenes: [{ purpose: "Reveal", prompt: "A calm product reveal", durationSec: 4 }],
      soundtrack: { include: true, prompt: "Minimal instrumental pulse" },
    });

    await expect(authorProductionPlan({
      job, workspaceId: "workspace-1", brandId: "brand-1", request: "Create a media plan",
      generateDraft, pricing: { ...pricing, lyria3ClipFixedUsd: "" },
    })).rejects.toThrow("Lyria 3 Clip pricing is unavailable");
  });
});
