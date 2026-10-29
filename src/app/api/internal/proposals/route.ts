import { proposalSubmissionSchema } from "@/lib/contracts";
import { createNotification, listProposals, saveProposal } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";

/** All proposals (newest first) — dashboard inbox feed. */
export async function GET() {
  return Response.json({ proposals: await listProposals() });
}

/**
 * Ingest endpoint for the worker's proactive agent. Proposals are deduplicated
 * by their deterministic id; each NEW proposal fires a bell notification so
 * the operator sees autonomous suggestions without watching a page.
 */
export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, proposalSubmissionSchema, async (body) => {
    const existing = new Set((await listProposals()).map((p) => p.id));
    let created = 0;
    let skipped = 0;
    for (const p of body.proposals) {
      if (existing.has(p.id)) {
        skipped += 1;
        continue;
      }
      await saveProposal({
        ...p,
        status: "proposed",
        createdAt: new Date().toISOString(),
      });
      await createNotification({
        kind: "topic_proposal",
        title:
          p.source === "trend_scan"
            ? "New topic idea from trend scan"
            : p.source === "engagement_watch"
              ? "Follow-up idea from engagement watch"
              : p.source === "calendar_gap"
                ? "Idea to fill your content calendar gap"
                : "Your top post deserves a refresh",
        body: p.topic,
        severity: "info",
        href: "/dashboard/monitoring?tab=proposals",
        createdAt: new Date().toISOString(),
        readAt: null,
      });
      created += 1;
    }
    return Response.json({ ok: true, created, skipped });
  });
}
