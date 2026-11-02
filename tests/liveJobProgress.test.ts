import { describe, expect, it } from "vitest";
import { currentJobProgressOperations } from "../src/lib/a2ui/liveJobProgress";

const operations = [{ version: "v0.9", updateComponents: { surfaceId: "studio-run-canvas-r1", components: [{ id: "root", component: "JobProgress", jobId: "job-1", title: "Job Status", stage: "collect_sources", status: "running", stages: [], children: [], agentFraming: true, emphasis: "primary" }] } }];

describe("live generated job progress", () => {
  it("rebinds a historical progress card to current persisted state without mutating history", () => {
    const result = currentJobProgressOperations(operations, { id: "job-1", stage: "complete", status: "complete" });
    const text = JSON.stringify(result);
    expect(text).toContain('"stage":"complete"');
    expect(text).not.toContain('"status":"active"');
    expect(JSON.stringify(operations)).toContain('"stage":"collect_sources"');
  });
  it("refuses to relabel another job's status as the active job", () => {
    expect(() => currentJobProgressOperations(operations, { id: "job-2", stage: "draft", status: "running" })).toThrow("different job");
  });
  it("shows the actual failed stage rather than stale progress", () => {
    const text = JSON.stringify(currentJobProgressOperations(operations, { id: "job-1", stage: "draft", status: "failed" }));
    expect(text).toContain('"id":"draft","label":"draft","status":"failed"');
  });
});
