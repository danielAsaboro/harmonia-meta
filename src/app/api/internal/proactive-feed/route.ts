import {
  getGoals,
  listContentItems,
  listJobs,
  listProposals,
  listReceipts,
} from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

/**
 * One-stop data feed for the worker's proactive agent: everything its checks
 * need in a single authenticated read (items, job health, insights, goals,
 * pending proposals). Keeps checks simple and the web surface small.
 */
async function get(_req: Request) {

  const [items, jobs, proposals, goals] = await Promise.all([
    listContentItems(),
    listJobs(),
    listProposals(50),
    getGoals(),
  ]);

  const now = Date.now();
  const STUCK_AFTER_MS = 2 * 3600_000;

  // Posts published in the last 48h (for the hourly publish-pulse check).
  const recentlyCompleted = jobs.filter(
    (j) => j.stage === "complete" && j.status === "complete" && Date.parse(j.updatedAt) > now - 48 * 3600_000,
  );
  const recentPublished = [];
  for (const j of recentlyCompleted) {
    const receipts = await listReceipts(j.id);
    for (const r of receipts) {
      if (r.actionType === "publish_x_post" && r.outcome === "applied" && r.detail?.id) {
        recentPublished.push({
          postId: String(r.detail.id),
          jobId: j.id,
          publishedAt: r.performedAt,
          likesSoFar: typeof r.detail.likes === "number" ? r.detail.likes : null,
        });
      }
    }
  }

  return Response.json({
    now: new Date(now).toISOString(),
    items: items.map((i) => ({
      id: i.id,
      text: i.text,
      status: i.status,
      publishMode: i.publishMode,
      platforms: i.platforms,
      scheduledFor: i.scheduledFor ?? null,
      jobId: i.jobId,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
    failedJobs: jobs
      .filter((j) => j.status === "failed")
      .map((j) => ({ id: j.id, stage: j.failure?.stage ?? "", error: j.failure?.publicMessage ?? "", permanent: !(j.failure?.retryable ?? true), at: j.updatedAt })),
    stuckJobs: jobs
      .filter((j) => j.status === "running" && Date.parse(j.updatedAt) < now - STUCK_AFTER_MS)
      .map((j) => ({ id: j.id, stage: j.stage, at: j.updatedAt })),
    pendingApprovalCount: jobs.filter((j) => j.stage === "awaiting_approval" || j.stage === "awaiting_strategy_approval").length,
    proposalsPending: proposals.filter((p) => p.status === "proposed").length,
    recentPublished,
    goals,
  });
}

export const GET = internalTenantHandler(get);
