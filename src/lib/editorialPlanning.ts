import type { ContentItem, EditorialPlanningSnapshot, Job } from "./types";

const POLICY_ID = "policy:editorial-planning-v1";
const HOUR_MS = 60 * 60 * 1000;

export function buildEditorialPlanningSnapshot(
  job: Job,
  items: ContentItem[],
  asOf = new Date().toISOString(),
): EditorialPlanningSnapshot {
  const strategy = job.contentStrategy;
  const approval = job.strategyApproval;
  const revision = job.editorialPlanRevision ?? 1;
  if (!strategy || !job.strategyDigest || approval?.decision !== "approved") {
    throw new Error("approved strategy required for editorial planning snapshot");
  }
  if (approval.payloadDigest !== job.strategyDigest || approval.revision !== job.strategyRevision) {
    throw new Error("strategy approval binding mismatch");
  }
  const start = new Date(approval.decidedAt);
  const end = new Date(start.getTime() + strategy.horizonWeeks * 7 * 24 * HOUR_MS);
  const supported = strategy.channelRoles.filter((role) => role.operationallySupported);
  if (!supported.length) throw new Error("approved strategy has no supported planning channel");

  const relevant = items.filter((item) => {
    if (!item.scheduledFor || item.status === "cancelled") return false;
    const at = Date.parse(item.scheduledFor);
    return at >= start.getTime() && at < end.getTime();
  });
  const provenanceIds = new Set<string>([POLICY_ID, `strategy:${job.strategyDigest}`]);
  for (const item of relevant) provenanceIds.add(`content-item:${item.id}`);

  return {
    snapshotId: `planning-${job.id}-v${revision}`,
    asOf,
    horizonStartAt: start.toISOString(),
    horizonEndAt: end.toISOString(),
    timezone: "UTC",
    channelCapabilities: supported.map((role) => ({ channel: role.channel, formats: role.formats })),
    existingCommitments: relevant.flatMap((item) => item.platforms.map((channel) => ({
      id: `commitment:${item.id}:${channel}`,
      channel,
      publicationWindowStartAt: new Date(item.scheduledFor!).toISOString(),
      publicationWindowEndAt: new Date(Date.parse(item.scheduledFor!) + HOUR_MS).toISOString(),
    }))),
    productionCapacity: { maxItems: 8, maxItemsPerWeek: 2 },
    cadenceConstraints: { minimumHoursBetweenItems: 24, maxItemsPerChannelPerWeek: 2 },
    postingWindowObservations: [],
    assetReadiness: [],
    blockedDependencies: [],
    calendarProjection: relevant.map((item) => ({
      id: `calendar:${item.id}`,
      contentItemId: item.id,
      state: item.googleCalendarSync?.status ?? "not_projected",
      ...(item.googleCalendarSync?.eventId ? { externalEventId: item.googleCalendarSync.eventId } : {}),
      evidenceRefs: [`content-item:${item.id}`],
    })),
    provenanceIds: [...provenanceIds].sort(),
  };
}

export const EDITORIAL_PLANNING_POLICY_ID = POLICY_ID;
