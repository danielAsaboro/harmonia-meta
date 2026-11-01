import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChatResponse } from "../src/lib/chatHandler";
import type { JobFull } from "../src/components/jobTypes";
import { loadGeneratedPresentation } from "../src/lib/a2ui/generatedPresentation";

const job: JobFull = {
  id: "job-1", status: "running", stage: "draft", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:01:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [],
};

describe("streamed A2UI presentation integration", () => {
  it("keeps a successful chat mutation terminally successful when presentation fails", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/chat/stream/route.ts"), "utf8");
    const presentationCatch = route.slice(route.indexOf("} catch (error) {", route.indexOf("loadGeneratedPresentation")), route.indexOf("          }\n          for (let offset", route.indexOf("loadGeneratedPresentation")));
    expect(presentationCatch).toContain("Maya could not compose the campaign workspace");
    expect(presentationCatch).not.toContain("throw error");
  });
  it("reloads authenticated job state and returns exact slot operations", async () => {
    const canvas = [{ version: "v0.9", createSurface: { surfaceId: "studio-run-1-canvas-r1", catalogId: "catalog" } }];
    const conversation = [{ version: "v0.9", createSurface: { surfaceId: "studio-run-1-conversation-r1", catalogId: "catalog" } }];
    const approval = [{ version: "v0.9", createSurface: { surfaceId: "studio-run-1-approval-r1", catalogId: "catalog" } }];
    const generate = vi.fn().mockResolvedValue({ canvas, conversation, approval });
    const response: ChatResponse = { intent: "status", reply: "Drafting.", jobId: "job-1" };

    const result = await loadGeneratedPresentation({
      runId: "run-1",
      message: "Show status",
      response,
      loadJob: vi.fn().mockResolvedValue(job),
      loadReceipts: vi.fn().mockResolvedValue([]),
      loadAssets: vi.fn().mockResolvedValue([{ actionId: "image-1", mime: "image/png", sizeBytes: 4, digest: "d" }]),
      generate,
    });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      message: "Show status",
      job: expect.objectContaining({ id: "job-1", assets: [expect.objectContaining({ actionId: "image-1" })] }),
    }));
    expect(result?.operations).toEqual([...canvas, ...conversation, ...approval]);
  });

  it("does not invent a surface when the chat response has no active job", async () => {
    const generate = vi.fn();
    const result = await loadGeneratedPresentation({
      runId: "run-2",
      message: "Hello",
      response: { intent: "unknown", reply: "Create a job first." },
      loadJob: vi.fn(),
      loadReceipts: vi.fn(),
      loadAssets: vi.fn(),
      generate,
    });
    expect(result).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("propagates managed presentation failure without generic operations", async () => {
    await expect(loadGeneratedPresentation({
      runId: "run-3",
      message: "Show status",
      response: { intent: "status", reply: "Drafting.", jobId: "job-1" },
      loadJob: vi.fn().mockResolvedValue(job),
      loadReceipts: vi.fn().mockResolvedValue([]),
      loadAssets: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockRejectedValue(new Error("Agent Engine unavailable")),
    })).rejects.toThrow("Agent Engine unavailable");
  });

  it("preserves verification action ids for receipt matching", async () => {
    const generate = vi.fn().mockResolvedValue({ canvas: [], conversation: [], approval: [] });
    await loadGeneratedPresentation({
      runId: "run-4",
      message: "Show verification",
      response: { intent: "status", reply: "Verified.", jobId: "job-1" },
      loadJob: vi.fn().mockResolvedValue({
        ...job,
        verifications: [{
          target: "external-post",
          actionId: "publish-1",
          verified: true,
          method: "official API lookup",
          evidence: { kind: "http", fetchedAt: "2026-08-23T00:02:00.000Z" },
          checkedAt: "2026-08-23T00:02:00.000Z",
        }],
      }),
      loadReceipts: vi.fn().mockResolvedValue([]),
      loadAssets: vi.fn().mockResolvedValue([]),
      generate,
    });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ verifications: [expect.objectContaining({ actionId: "publish-1" })] }),
    }));
  });
});
