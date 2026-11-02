import { describe, expect, it } from "vitest";

import { projectWorkspaceContentContext } from "@/lib/workspaceContentContext";
import type { Job, ContentItem } from "@/lib/types";

describe("workspace content context", () => {
  it("projects the latest approved strategy, plan, calendar and approval load", () => {
    const jobs = [{
      id: "job-1", stage: "awaiting_approval", status: "waiting_for_approval",
      createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      strategyApprovalState: "approved", contentStrategy: { thesis: "Own the reliable-agent category", channelRoles: [{ channel: "linkedin" }] },
      editorialPlan: { summary: "Four weeks of founder proof" }, actions: [{ approvalState: "pending", state: "planned" }],
      sourceAnalysis: { summary: "Launch interview" },
    }] as unknown as Job[];
    const items = [{ id: "item-1", status: "scheduled", scheduledFor: "2026-09-08T09:00:00Z", platforms: ["linkedin"] }] as ContentItem[];
    const result = projectWorkspaceContentContext({ goals: { topics: ["agent reliability"], audience: "startup founders" }, jobs, items, now: new Date("2026-09-01T00:00:00Z") });
    expect(result).toMatchObject({ strategyReady: true, planReady: true, calendarReady: true, pendingApprovalCount: 1, upcomingItemCount: 1, channels: ["linkedin"] });
    expect(result.strategySummary).toContain("reliable-agent");
    expect(result.goals).toContain("Audience: startup founders");
  });

  it("bounds generated job titles before sending them to the intent router", () => {
    const jobs = [{
      id: "job-long-summary", stage: "strategize", status: "failed",
      createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      sourceAnalysis: { summary: "Evidence-backed startup content operations. ".repeat(80) },
    }] as unknown as Job[];
    const result = projectWorkspaceContentContext({ goals: { topics: [] }, jobs, items: [] });
    expect(result.recentJobs[0].title).toHaveLength(2_000);
    expect(result.recentJobs[0].title?.endsWith("…")).toBe(true);
  });
});
