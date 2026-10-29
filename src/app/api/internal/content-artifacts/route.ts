import { artifactProductionSubmissionSchema } from "@/lib/contentArtifacts/submission";
import { resolveContentPackPayload, sealContentArtifact } from "@/lib/contentArtifacts/digest";
import { deriveArtifactActions } from "@/lib/contentArtifacts/actions";
import { applyPolicy } from "@/lib/policy";
import { appendEvent, createNotification, finalizeArtifactProduction, getConnection, getJob, transitionStageWithOutbox } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { currentTraceId } from "@/lib/telemetry";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";
import { materializeExecutableJobCommands } from "@/lib/jobEffectCommands";
import { createHash } from "node:crypto";
import type { ActionSeed } from "@/lib/policy";

function derivePlannedMediaActions(job: Awaited<ReturnType<typeof getJob>>): ActionSeed[] {
  const outputs = new Set(job.campaignOutputPlan?.outputs.map((item) => item.outputType) ?? []); const actions: ActionSeed[] = []; const angles = job.sourceAnalysis?.angles ?? []; const moments = (job.sourceAnalysis?.moments ?? []).filter((item) => item.endSec > item.startSec);
  for (const [index, outputType] of ["social_image", "quote_card", "diagram"].filter((item) => outputs.has(item as never)).entries()) { const angle = angles[index]; if (!angle) continue; const prompt = `${outputType.replaceAll("_", " ")} for a startup campaign. Evidence-grounded concept: ${angle.title}. ${angle.rationale}. No unsupported claims or watermarks.`; actions.push({ id: `generate-${outputType}-${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}`, jobId: job.id, type: "generate_image", title: `Generate ${outputType.replaceAll("_", " ")}`, description: "Generate an internal evidence-grounded image asset.", angleId: angle.id, payload: { type: "generate_image", prompt } }); }
  if (outputs.has("short_clip")) for (const moment of moments.slice(0, 2)) actions.push({ id: `clip-${moment.id}`, jobId: job.id, type: "render_clip", title: `Cut clip: ${moment.title}`, description: "Render an internal captioned source clip.", momentId: moment.id, payload: { type: "render_clip", momentId: moment.id, format: "vertical", captions: true } });
  if (outputs.has("reel") && moments.length >= 2) actions.push({ id: "reel-top-moments", jobId: job.id, type: "render_reel", title: "Render source highlight reel", description: "Render an internal reel from grounded source moments.", payload: { type: "render_reel", momentIds: moments.slice(0, 6).map((item) => item.id), format: "vertical", captions: true } });
  return actions;
}

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, artifactProductionSubmissionSchema, async (body) => {
    const job = await getJob(body.jobId); if (job.stage !== "draft" && job.stage !== "awaiting_approval") return Response.json({ error: `job stage is '${job.stage}'` }, { status: 409 });
    const plan = job.campaignOutputPlan; if (!plan) return Response.json({ error: "campaign output plan is missing" }, { status: 409 });
    const acceptedReviews = body.result.finalReview?.reviews ?? body.result.firstReview.reviews; const traceId = currentTraceId(); const now = new Date().toISOString();
    const sealDraft = (draft: (typeof body.result.accepted.artifacts)[number], payload = draft.payload) => {
      const planned = plan.outputs.find((item) => item.id === draft.outputPlanItemId); if (!planned || planned.outputType !== draft.outputType) throw new Error(`artifact ${draft.id} is outside the output plan`);
      if (draft.sourceSegmentRefs.some((ref) => !planned.evidenceRefs.includes(ref))) throw new Error(`artifact ${draft.id} references evidence outside its output-plan item`);
      const review = acceptedReviews.find((item) => item.artifactId === draft.id); if (!review || review.decision !== "accept") throw new Error(`artifact ${draft.id} has no accepted exact review`);
      return sealContentArtifact({ id: draft.id, jobId: body.jobId, outputPlanId: plan.id, outputPlanDigest: plan.digest, outputType: draft.outputType, revision: body.result.revision ? 2 : 1, title: draft.title, sourceSegmentRefs: draft.sourceSegmentRefs, producer: { role: draft.payload.kind === "content_pack" ? "harmonia_content_pack_assembler" : "noni_artifact_producer", model: draft.payload.kind === "content_pack" ? "deterministic" : body.producerModel, traceId }, review: { role: "dara_artifact_editor", traceId, decision: "accept" }, mimeType: "text/markdown", createdAt: now, payload });
    };
    const drafts = body.result.accepted.artifacts;
    const sealedChildren = drafts.filter((draft) => draft.payload.kind !== "content_pack").map((draft) => sealDraft(draft));
    const sealedById = new Map(sealedChildren.map((artifact) => [artifact.id, artifact] as const));
    const artifacts = drafts.map((draft) => {
      if (draft.payload.kind !== "content_pack") return sealedById.get(draft.id)!;
      return sealDraft(draft, resolveContentPackPayload(draft.payload, sealedChildren));
    });
    const [x, linkedin] = await Promise.all([getConnection("x"), getConnection("linkedin")]);
    const destination = linkedin?.health !== "reconnect_required" && linkedin?.defaultDestinationId ? linkedin.destinations?.find((item) => item.id === linkedin.defaultDestinationId && (item.kind === "linkedin_member" || item.kind === "linkedin_organization")) ?? null : null;
    const actions = applyPolicy([...deriveArtifactActions(artifacts, { x: Boolean(x && x.health !== "reconnect_required"), linkedinDestination: destination && (destination.kind === "linkedin_member" || destination.kind === "linkedin_organization") ? destination : null }), ...derivePlannedMediaActions(job)]);
    const lineage = { editorialPlanId: body.editorialPlanId, editorialPlanDigest: body.editorialPlanDigest, editorialItemId: body.editorialItemId, briefId: body.briefId }; const needsApproval = actions.filter((item) => item.requiresApproval); const autoRun = actions.filter((item) => !item.requiresApproval);
    const result = await finalizeArtifactProduction(body.jobId, lineage, body.result, artifacts, actions, needsApproval.length > 0); if (result.outcome === "already_applied") return Response.json({ ok: true, alreadyApplied: true });
    if (needsApproval.length) { await appendEvent(body.jobId, "draft", `${artifacts.length} accepted artifact(s); ${autoRun.length} export(s), ${needsApproval.length} awaiting approval`, "agent"); await createNotification({ kind: "approval_needed", title: "Approval needed", body: `Job ${body.jobId.slice(0, 8)} has ${needsApproval.length} publication action(s) waiting.`, severity: "warning", refType: "job", refId: body.jobId, href: "/dashboard", createdAt: now }); return Response.json({ ok: true, awaitingApproval: true, artifactCount: artifacts.length }); }
    await materializeExecutableJobCommands(job.id); const outboxId = await transitionStageWithOutbox(job.id, "draft", "publish", `${autoRun.length} verified export action(s) dispatched`); await dispatchStageOutboxRecord(outboxId).catch(() => undefined); return Response.json({ ok: true, triggered: "publish", artifactCount: artifacts.length });
  });
}
