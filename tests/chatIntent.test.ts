import { describe, expect, it } from "vitest";
import { normalizeParsedIntent, parseLocalIntent } from "@/lib/chatIntent";

describe("local intent grammar", () => {

  it("normalizes a Gemini pasted-text descriptor that omits its model-generated title", () => {
    expect(normalizeParsedIntent({
      intent: "create_job",
      sources: [{ kind: "pasted_text", text: "Harmonia turns sources into approved content." }],
      desiredOutputs: ["x_post"],
    })).toEqual({
      intent: "create_job",
      sources: [{ kind: "pasted_text", title: "Operator context", text: "Harmonia turns sources into approved content." }],
      desiredOutputs: ["x_post"],
    });
  });

  it("routes youtube urls to create_job", async () => {
    expect(parseLocalIntent("make a job from https://youtu.be/jNQXAC9IVRw please"))
      .toMatchObject({ intent: "create_job", sources: [{ kind: "youtube", url: "https://youtu.be/jNQXAC9IVRw" }] });
    expect(parseLocalIntent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toMatchObject({ intent: "create_job", sources: [{ kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] });
  });

  it("detects approve with optional job id", async () => {
    expect(parseLocalIntent("approve")).toEqual({ intent: "approve" });
    expect(parseLocalIntent("approve job demo-launch")).toMatchObject({
      intent: "approve",
      jobId: "demo-launch",
    });
  });

  it("detects drafts and status intents", async () => {
    expect(parseLocalIntent("show artifacts for demo-clips")).toMatchObject({
      intent: "list_artifacts", jobId: "demo-clips",
    });
    expect(parseLocalIntent("status")).toEqual({ intent: "status" });
    expect(parseLocalIntent("what's the status of job demo-podcast?")).toMatchObject({
      intent: "status", jobId: "demo-podcast",
    });
  });

  it("treats longer operator context as a pasted-text source", async () => {
    const res = parseLocalIntent("Announce our usage-based billing launch for AI agent workloads today");
    expect(res.intent).toBe("create_job");
    expect(res.sources).toEqual([expect.objectContaining({ kind: "pasted_text" })]);
    expect(res.sources?.[0]).toMatchObject({ text: expect.stringContaining("usage-based billing") });
  });

  it("returns unknown for short smalltalk", async () => {
    expect(parseLocalIntent("hello there")).toEqual({ intent: "unknown" });
  });

});
