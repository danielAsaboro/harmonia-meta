import { engagementSubmissionSchema } from "@/lib/contracts";
import { appendEvent, getJob, saveLearnings } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { listCommandsForJob } from "@/lib/effectCommandStore";
import { decideTerminalOutcome } from "@/lib/effectCommands";

/**
 * Learn-stage completion: stores reaction metrics + takeaways and closes the
 * job. This is where the feedback loop hands learnings to future jobs.
 */
export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, engagementSubmissionSchema, async (body) => {
    const job = await getJob(body.jobId);
    if (job.stage !== "learn") {
      return Response.json(
        { error: `job stage is '${job.stage}', engagement accepted at 'learn'` },
        { status: 409 },
      );
    }
    const commands = await listCommandsForJob(body.jobId);
    const terminalOutcome = decideTerminalOutcome(commands);
    await saveLearnings(
      body.jobId,
      body.engagement.map((e) => ({ ...e, checkedAt: new Date().toISOString() })),
      { ...body.learnings, generatedAt: new Date().toISOString() },
      terminalOutcome,
    );
    await appendEvent(
      body.jobId,
      "learn",
      `${body.engagement.length} post(s) measured; ${body.learnings.notes.length} takeaway(s) stored for future ideation`,
      "agent",
    );
    return Response.json({ ok: true, terminalOutcome });
  });
}
