import { z } from "zod";
import { createHash } from "node:crypto";
import { requestAgentAnswer } from "@/lib/agentAskClient";
import { answerFromContext, fetchContextRecord, isValidContext } from "@/lib/contextAnswer";
import {
  appendEvent,
  getJob,
  listAssets,
  listChatMessages,
  listJobs,
  saveChatMessage,
} from "@/lib/firestore";
import { currentTenant } from "@/lib/tenancy";
import { parseIntent } from "@/lib/chatIntent";
import { queueStageTrigger } from "@/lib/stageTrigger";
import type { Job, PlannedAction, SourceInput, Stage } from "@/lib/types";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";
import { requireReadyAttachments, type ChatAttachment } from "@/lib/chatAttachments";
import { actionPayloadDigest } from "@/lib/idempotency";
import { createPendingOperation, type PendingOperation } from "@/lib/pendingOperations";
import { hasRightsAttestation, RIGHTS_ATTESTATION_PHRASE, sourceRightsAuthorization, sourceRightsAuthorizationId } from "@/lib/sourceRights";
import { createSourceJob } from "@/lib/sourceManifest";
import { latestHealthySnapshot, listLibraryConnections } from "@/lib/brandLibraries/repository";
import { outputKindSchema } from "@/lib/contracts";
import { getProductionPlanWorkspaceForJob, proposeProductionPlan, requestProductionRerender, type ProductionPlanAggregate, type ProductionPlanWorkspaceView, type ProductionRerenderRequest } from "@/lib/productionPlanStore";
import { authorProductionPlan } from "@/lib/productionPlanAuthor";
import type { VideoProductionPlan } from "@/lib/mediaProduction";

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  surface: z.enum(["dashboard", "telegram"]).default("dashboard"),
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).default("primary"),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  /** Grounded Q&A about one record ("chat with any item"). */
  context: z
    .object({
      kind: z.enum(["job", "content_item", "proposal"]),
      id: z.string().min(1),
    })
    .optional(),
  attachmentIds: z.array(z.string().min(1)).max(10).default([]),
});

export interface JobCard {
  id: string;
  stage: Stage;
  status: string;
  title?: string;
  failure?: { stage: Stage; error: string; permanent: boolean };
}

export interface PendingActionSummary {
  id: string;
  title: string;
  type: string;
  risk: string;
  payloadDigest: string;
}

export interface ChatAsset {
  actionId: string;
  mime: string;
}

export interface ChatAttachmentSummary {
  attachmentId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  state: "ready";
  previewUrl: string;
}

export interface ChatResponse {
  intent: string;
  reply: string;
  job?: JobCard;
  jobs?: JobCard[];
  artifacts?: ContentArtifact[];
  pendingActions?: PendingActionSummary[];
  /** Media produced by the referenced job, so conversations render richly. */
  assets?: ChatAsset[];
  attachments?: ChatAttachmentSummary[];
  confirmation?: { operationId: string; payloadDigest: string };
  jobId?: string;
  /** Durable stream run linked to a persisted assistant message. */
  chatRunId?: string;
}

type FullJob = Awaited<ReturnType<typeof getJob>>;
type AnyJob = Pick<Job, "id" | "stage" | "status" | "sourceAnalysis" | "failure">;
type ApprovalJob = Pick<FullJob, "id" | "stage" | "status" | "sourceAnalysis" | "failure" | "actions" | "contentStrategy" | "strategyDigest" | "strategyApprovalState">;

function toCard(job: AnyJob): JobCard {
  return {
    id: job.id,
    stage: job.stage,
    status: job.status,
    title: job.sourceAnalysis?.summary,
    failure: job.failure
      ? { stage: job.failure.stage, error: job.failure.publicMessage, permanent: !job.failure.retryable }
      : undefined,
  };
}

function pendingOf(job: FullJob): PlannedAction[] {
  return job.actions.filter((a) => a.approvalState === "pending" && a.state === "planned");
}

function summarizeActions(actions: PlannedAction[]): PendingActionSummary[] {
  return actions.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    risk: a.risk,
    payloadDigest: actionPayloadDigest(a),
  }));
}

export async function buildApprovalConfirmation(
  job: ApprovalJob,
  surface: "dashboard" | "telegram",
  createOperation: typeof createPendingOperation = createPendingOperation,
): Promise<ChatResponse> {
  const pending = pendingOf(job as FullJob);
  const strategyPending = job.stage === "awaiting_strategy_approval" && job.strategyApprovalState === "pending" && job.contentStrategy && job.strategyDigest;
  if (strategyPending) {
    const summary: PendingActionSummary = {
      id: "strategy", title: `Ryan strategy v${job.contentStrategy!.version}`,
      type: "content_strategy", risk: "material", payloadDigest: job.strategyDigest!,
    };
    if (surface === "telegram") return {
      intent: "approve", reply: `Job ${job.id} has Ryan's four-week strategy waiting for digest-bound approval.`,
      jobId: job.id, job: toCard(job as FullJob), pendingActions: [summary],
    };
    const operation = await createOperation({
      handler: "decide_strategy", title: `Decide: ${summary.title}`,
      description: job.contentStrategy!.thesis, risk: "material",
      arguments: { jobId: job.id, actionId: "strategy", payloadDigest: job.strategyDigest },
    }) as Pick<PendingOperation, "id">;
    return {
      intent: "approve", reply: `Review Ryan's strategy for job ${job.id}, then use the explicit confirmation control.`,
      jobId: job.id, job: toCard(job as FullJob), pendingActions: [summary],
      confirmation: { operationId: operation.id, payloadDigest: job.strategyDigest! },
    };
  }
  if (pending.length === 0) {
    return {
      intent: "approve",
      reply: `Job ${job.id} has no pending approvals (stage: ${job.stage}).`,
      jobId: job.id,
      job: toCard(job as FullJob),
    };
  }
  if (surface === "telegram") {
    return {
      intent: "approve",
      reply: `Job ${job.id} has ${pending.length} pending action(s). Use the verified inline confirmation:`,
      jobId: job.id,
      job: toCard(job as FullJob),
      pendingActions: summarizeActions(pending),
    };
  }
  const target = pending[0];
  const payloadDigest = actionPayloadDigest(target);
  const operation = await createOperation({
    handler: "decide_job_action",
    title: `Decide: ${target.title}`,
    description: target.description,
    risk: target.risk === "high" ? "high" : target.risk === "low" ? "low" : "material",
    arguments: { jobId: job.id, actionId: target.id, payloadDigest },
  }) as Pick<PendingOperation, "id">;
  return {
    intent: "approve",
    reply: `Review '${target.title}' for job ${job.id}, then use the explicit confirmation control.`,
    jobId: job.id,
    job: toCard(job as FullJob),
    pendingActions: summarizeActions(pending),
    confirmation: { operationId: operation.id, payloadDigest },
  };
}

export async function buildProductionApprovalConfirmation(
  workspace: ProductionPlanWorkspaceView,
  surface: "dashboard" | "telegram",
  createOperation: typeof createPendingOperation = createPendingOperation,
): Promise<ChatResponse> {
  const { aggregate, revision } = workspace;
  const summary: PendingActionSummary = {
    id: aggregate.id,
    title: `Production plan v${aggregate.currentRevision}: ${revision.plan.goal}`,
    type: "production_plan",
    risk: "material",
    payloadDigest: aggregate.currentPlanDigest,
  };
  if (aggregate.state !== "sealed") return {
    intent: "approve_production_plan",
    reply: `Production plan ${aggregate.id} is ${aggregate.state}, not sealed for approval. Publication approval remains separate.`,
    jobId: aggregate.jobId,
    pendingActions: [],
  };
  if (surface === "telegram") return {
    intent: "approve_production_plan",
    reply: `Production plan ${aggregate.id} v${aggregate.currentRevision} is sealed at a maximum cost of $${revision.plan.maximumCostUsd}. Use the verified production confirmation; this does not approve publication.`,
    jobId: aggregate.jobId,
    pendingActions: [summary],
  };
  const operation = await createOperation({
    handler: "decide_production_plan",
    title: `Approve ${summary.title}`,
    description: `Authorize only the sealed paid media graph up to $${revision.plan.maximumCostUsd}; publication remains separately gated.`,
    risk: "material",
    arguments: { jobId: aggregate.jobId, actionId: aggregate.id, payloadDigest: aggregate.currentPlanDigest },
  }) as Pick<PendingOperation, "id">;
  return {
    intent: "approve_production_plan",
    reply: `Review production plan ${aggregate.id} v${aggregate.currentRevision}, then use the explicit production confirmation. Publication remains separately gated.`,
    jobId: aggregate.jobId,
    pendingActions: [summary],
    confirmation: { operationId: operation.id, payloadDigest: aggregate.currentPlanDigest },
  };
}

async function assetsOf(jobId: string) {
  try {
    const assets = await listAssets(jobId);
    if (assets.length === 0) return undefined;
    return assets.map((a) => ({ actionId: a.actionId, mime: a.mime }));
  } catch {
    return undefined;
  }
}

async function resolveProductionWorkspace(jobId?: string): Promise<ProductionPlanWorkspaceView | null> {
  if (jobId) return getProductionPlanWorkspaceForJob(jobId);
  const jobs = await listJobs();
  for (const job of jobs) {
    const workspace = await getProductionPlanWorkspaceForJob(job.id);
    if (workspace) return workspace;
  }
  return null;
}

export function productionStatusReply(workspace: ProductionPlanWorkspaceView): string {
  const { aggregate, revision, operations } = workspace;
  const counts = new Map<string, number>();
  for (const operation of operations) counts.set(operation.state, (counts.get(operation.state) ?? 0) + 1);
  const active = operations.filter((operation) => ["claimed", "submitting", "waiting_provider"].includes(operation.state));
  const failed = operations.filter((operation) => operation.state === "failed" || operation.state === "uncertain");
  const stateSummary = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => `${count} ${state}`).join(", ");
  const activeSummary = active.length
    ? ` Active: ${active.map((operation) => `${operation.type}${operation.provider ? ` via ${operation.provider}` : ""}`).join(", ")}.`
    : " No operation is actively executing.";
  const failureSummary = failed.length
    ? ` Attention required: ${failed.map((operation) => `${operation.type}: ${operation.failureReason ?? operation.state}`).join("; ")}.`
    : "";
  return `Production plan ${aggregate.id} v${revision.revision} is ${aggregate.state}. Operations: ${stateSummary || "none"}.${activeSummary}${failureSummary} Production approval does not authorize publication.`;
}

export function productionModelExplanation(workspace: ProductionPlanWorkspaceView): string {
  const plan = workspace.revision.plan;
  const sceneModels = plan.scenes.map((scene) => scene.video
    ? `${scene.id} uses ${scene.video.modelCapability} for ${scene.video.mode} at ${scene.video.resolution}, ${scene.video.durationSec}s, ${scene.video.aspectRatio}`
    : `${scene.id} uses source media only`);
  const soundtrack = plan.soundtrack
    ? `Soundtrack uses ${plan.soundtrack.modelCapability} for ${plan.soundtrack.targetDurationSec}s (${plan.soundtrack.instrumental ? "instrumental" : "vocals"}).`
    : "No generated soundtrack is included, so no music-generation cost is authorized.";
  return `Model selection for production plan ${workspace.aggregate.id} v${workspace.revision.revision}: ${sceneModels.join("; ")}. ${soundtrack} These are the exact sealed controls; changing them creates a new revision and invalidates the current mandate.`;
}

export async function createOrReviseProductionPlanFromChat(
  input: { jobId: string; request: string; revise: boolean },
  dependencies: {
    getJob?: typeof getJob;
    getWorkspace?: typeof getProductionPlanWorkspaceForJob;
    author?: typeof authorProductionPlan;
    propose?: typeof proposeProductionPlan;
    tenant?: { workspaceId: string; brandId: string };
  } = {},
): Promise<{ plan: VideoProductionPlan; aggregate: ProductionPlanAggregate }> {
  const loadJob = dependencies.getJob ?? getJob;
  const loadWorkspace = dependencies.getWorkspace ?? getProductionPlanWorkspaceForJob;
  const author = dependencies.author ?? authorProductionPlan;
  const propose = dependencies.propose ?? proposeProductionPlan;
  const tenant = dependencies.tenant ?? currentTenant();
  const [job, workspace] = await Promise.all([loadJob(input.jobId), loadWorkspace(input.jobId)]);
  if (input.revise && !workspace) throw new Error(`job ${input.jobId} has no production plan to revise`);
  if (!input.revise && workspace) throw new Error(`job ${input.jobId} already has production plan ${workspace.aggregate.id}; revise it instead`);
  const plan = await author({
    job,
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    request: input.request,
    ...(workspace ? { existing: workspace.revision.plan } : {}),
  });
  const aggregate = await propose(plan);
  return { plan, aggregate };
}

export async function requestProductionRerenderFromChat(
  jobId: string,
  stableRequestId: string,
  dependencies: {
    getWorkspace?: typeof getProductionPlanWorkspaceForJob;
    request?: typeof requestProductionRerender;
  } = {},
): Promise<ProductionRerenderRequest> {
  const workspace = await (dependencies.getWorkspace ?? getProductionPlanWorkspaceForJob)(jobId);
  if (!workspace) throw new Error(`job ${jobId} has no production plan to rerender`);
  const requestId = `rerender-${createHash("sha256").update(stableRequestId).digest("hex").slice(0, 24)}`;
  return (dependencies.request ?? requestProductionRerender)(workspace.aggregate.id, { requestId });
}

export async function handleChat(req: Request, options: { chatRunId?: string } = {}): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid chat payload" }, { status: 400 });
  }
  const { message, surface, conversationId, requestId, context, attachmentIds } = parsed.data;

  let attachments: ChatAttachment[] = [];
  try {
    attachments = await requireReadyAttachments(attachmentIds);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }

  let payload: ChatResponse;
  let status = 200;
  try {
    const result = await buildResponse(req, message, surface, conversationId, context, attachments, requestId);
    if ("__http" in result) return result.__http; // e.g. operator forbidden
    payload = result.payload;
    status = result.status ?? 200;
  } catch (e) {
    return Response.json(
      { error: `chat failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // Persist the exchange so past conversations render in the console.
  // JSON round-trip drops undefined fields (e.g. titles not yet ingested),
  // which Firestore rejects.
  try {
    await saveChatMessage({
      surface,
      conversationId,
      role: "user",
      text: message,
      data: attachments.length ? {
        attachments: attachments.map((attachment) => ({
          attachmentId: attachment.id,
          filename: attachment.filename,
          mime: attachment.mime,
          sizeBytes: attachment.sizeBytes,
          state: "ready",
          previewUrl: `/api/chat/attachments/${attachment.id}`,
        })),
      } : undefined,
    });
    await saveChatMessage({
      surface,
      conversationId,
      role: "assistant",
      text: payload.reply,
      data: JSON.parse(JSON.stringify({
        ...payload,
        ...(options.chatRunId ? { chatRunId: options.chatRunId } : {}),
      })) as Record<string, unknown>,
    });
  } catch (e) {
    console.error("chat history persistence failed:", e);
  }

  return Response.json(payload, { status });
}

type HandlerResult =
  | { payload: ChatResponse; status?: number }
  | { __http: Response };

const PLATFORM_LABELS: Record<string, string> = { x: "X", linkedin: "LinkedIn", "linkedin-organization": "LinkedIn company page", instagram: "Instagram", tiktok: "TikTok" };

function connectionGuidance(platforms: string[] | undefined): string {
  if (!platforms?.length) return "";
  const labels = platforms.map((platform) => PLATFORM_LABELS[platform] ?? platform);
  return ` ${labels.join(" and ")} ${labels.length === 1 ? "is" : "are"} a good fit but not connected yet. Connect ${labels.length === 1 ? "it" : "them"} in Settings before publishing; Harmonia can still prepare the strategy and drafts now.`;
}

async function buildResponse(req: Request, message: string, surface: "dashboard" | "telegram", conversationId: string, context?: { kind: "job" | "content_item" | "proposal"; id: string }, attachments: ChatAttachment[] = [], requestId?: string): Promise<HandlerResult> {

  // Grounded Q&A about a specific record ("chat with any item").
  if (context && isValidContext(context)) {
    const record = await fetchContextRecord(context);
    if (!record) {
      return { payload: {
        intent: "context_qa",
        reply: `I could not find that ${context.kind.replace("_", " ")} (${context.id}). It may have been removed.`,
      } satisfies ChatResponse };
    }
    let reply: string;
    try {
      reply = await answerFromContext(message, record);
    } catch (e) {
      return { payload: {
        intent: "context_qa",
        reply: `Contextual answer failed: ${e instanceof Error ? e.message : String(e)}`,
      } satisfies ChatResponse };
    }
    return { payload: {
      intent: "context_qa",
      reply,
      jobId: context.kind === "job" ? context.id : undefined,
    } satisfies ChatResponse as ChatResponse };
  }

  let intent;
  let history: Awaited<ReturnType<typeof listChatMessages>> = [];
  let effectiveMessage = message;
  let effectiveAttachments = attachments;
  const rightsAttested = hasRightsAttestation(message);
  try {
    const attachmentContext = attachments.length
      ? `\n\nAttached files: ${attachments.map((attachment) => `${attachment.filename} (${attachment.mime})`).join(", ")}`
      : "";
    history = await listChatMessages(8, surface, conversationId);
    const recentConversation = history
      .filter((turn): turn is typeof turn & { role: "user" | "assistant" } => turn.role === "user" || turn.role === "assistant")
      .map((turn) => ({ role: turn.role, text: turn.text }));
    intent = await parseIntent(`${message}${attachmentContext}`, attachments.length, recentConversation);
  } catch (e) {
    return { __http: Response.json(
      { error: `intent parsing failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    ) };
  }

  if (rightsAttested && attachments.length === 0) {
    const priorSourceTurn = [...history].reverse().find((turn) => {
      if (turn.role !== "user" || !turn.data || typeof turn.data !== "object") return false;
      const summaries = (turn.data as { attachments?: unknown }).attachments;
      return Array.isArray(summaries) && summaries.some((summary) => summary && typeof summary === "object" && typeof (summary as { attachmentId?: unknown }).attachmentId === "string");
    });
    const attachmentIds = priorSourceTurn && Array.isArray((priorSourceTurn.data as { attachments?: unknown }).attachments)
      ? (priorSourceTurn.data as { attachments: unknown[] }).attachments.flatMap((summary) => summary && typeof summary === "object" && typeof (summary as { attachmentId?: unknown }).attachmentId === "string" ? [(summary as { attachmentId: string }).attachmentId] : [])
      : [];
    if (priorSourceTurn && attachmentIds.length > 0) {
      try {
        effectiveAttachments = await requireReadyAttachments(attachmentIds);
        effectiveMessage = priorSourceTurn.text;
        const attachmentContext = `\n\nAttached files: ${effectiveAttachments.map((attachment) => `${attachment.filename} (${attachment.mime})`).join(", ")}`;
        const recentConversation = history
          .filter((turn): turn is typeof turn & { role: "user" | "assistant" } => turn.role === "user" || turn.role === "assistant")
          .map((turn) => ({ role: turn.role, text: turn.text }));
        intent = await parseIntent(`${effectiveMessage}${attachmentContext}`, effectiveAttachments.length, recentConversation);
      } catch (error) {
        return { __http: Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) };
      }
    }
  }

  if (intent.needsClarification && intent.clarifyingQuestion) {
    return { payload: { intent: intent.intent, reply: `${intent.clarifyingQuestion}${connectionGuidance(intent.connectionSuggestions)}` } satisfies ChatResponse };
  }

  if (["establish_strategy", "revise_strategy"].includes(intent.intent) && ((intent.sources?.length ?? 0) > 0 || effectiveAttachments.length > 0)) {
    intent = { ...intent, intent: "create_job" };
  }

  switch (intent.intent) {
    case "create_job": {
      const descriptors = [...(intent.sources ?? [])];
      if (descriptors.length === 0 && effectiveAttachments.length === 0) {
        descriptors.push({ kind: "pasted_text", title: "Operator brief", text: intent.userOutcome ?? effectiveMessage });
      }
      const needsRightsAttestation = intent.requiresRightsAttestation || effectiveAttachments.length > 0 || descriptors.some((source) => source.kind === "youtube");
      if (needsRightsAttestation && !rightsAttested) return { payload: { intent: intent.intent, reply: `Before processing uploaded or YouTube media, send the request again with: “${RIGHTS_ATTESTATION_PHRASE}”.` } satisfies ChatResponse };
      const directSources: SourceInput[] = [];
      for (const attachment of effectiveAttachments) {
        const authorization = sourceRightsAuthorization(currentTenant(), "upload");
        directSources.push({ kind: "upload", attachmentId: attachment.id, rightsAuthorizationId: sourceRightsAuthorizationId(authorization) });
      }
      for (const source of descriptors) {
        const authorization = sourceRightsAuthorization(currentTenant(), source.kind);
        const rightsAuthorizationId = sourceRightsAuthorizationId(authorization);
        if (source.kind === "pasted_text") directSources.push({ ...source, rightsAuthorizationId });
        else directSources.push({ ...source, rightsAuthorizationId });
      }
      let librarySnapshotId: string | undefined;
      if (intent.libraryName) {
        const libraries = await listLibraryConnections();
        const library = libraries.find((candidate) => candidate.name.toLocaleLowerCase() === intent.libraryName!.toLocaleLowerCase());
        if (!library) return { payload: { intent: intent.intent, reply: `No connected brand library is named “${intent.libraryName}”. Select an existing library in Settings first.` } satisfies ChatResponse };
        const snapshot = await latestHealthySnapshot(library.id);
        if (!snapshot) return { payload: { intent: intent.intent, reply: `Brand library “${library.name}” has no healthy synchronized snapshot yet.` } satisfies ChatResponse };
        librarySnapshotId = snapshot.id;
      }
      if (directSources.length || librarySnapshotId) {
        const desiredOutputs = (intent.desiredOutputs ?? []).map((item) => outputKindSchema.safeParse(item)).filter((item) => item.success).map((item) => item.data);
        if (!desiredOutputs.length) desiredOutputs.push(intent.workspaceContext?.channels.includes("linkedin") ? "linkedin_post" : "x_post");
        const platforms = Array.from(new Set(intent.strategyContext?.supportedChannels ?? intent.platformRecommendations ?? ["x"]));
        const job = await createSourceJob({ operatorBrief: effectiveMessage, librarySnapshotId, directSources, desiredOutputs, allowedOutputs: desiredOutputs, platforms, strategyContext: intent.strategyContext });
        await appendEvent(job.id, "collect_sources", `source manifest created via ${surface} chat`, "operator");
        await queueStageTrigger(job.id, "collect_sources");
        const inherited = intent.workspaceContext?.strategyReady ? " It is using your approved workspace strategy as context." : " Harmonia will state its assumptions before strategy approval.";
        return { payload: { intent: intent.intent, reply: `Started job ${job.id} for “${intent.userOutcome ?? "your content request"}”. Harmonia will collect the sources, extract or transcribe them, decide where the material fits, and prepare the work for review.${inherited}${connectionGuidance(intent.connectionSuggestions)}`, jobId: job.id, job: toCard(job) } satisfies ChatResponse };
      }
      return { payload: {
        intent: intent.intent,
        reply: "Add at least one source: a YouTube or public web URL, an uploaded file, or pasted factual context.",
      } satisfies ChatResponse };
    }

    case "establish_strategy":
      return { payload: { intent: intent.intent, reply: `Share your company website (or attach your current positioning material). Harmonia will research the public context, draft the content strategy, and bring the exact strategy back for approval.${connectionGuidance(intent.connectionSuggestions)}` } satisfies ChatResponse };

    case "revise_strategy":
      return { payload: { intent: intent.intent, reply: `${intent.workspaceContext?.strategyReady ? "Tell me what changed—or share the updated company/product source—and Harmonia will revise the approved strategy without making any publishing changes." : "There is no approved workspace strategy yet. Share your company website and the business outcome you want; Harmonia will establish one first."}${connectionGuidance(intent.connectionSuggestions)}` } satisfies ChatResponse };

    case "advance_plan":
      return { payload: { intent: intent.intent, reply: `${intent.workspaceContext?.strategyReady ? (intent.workspaceContext.planReady ? `Your active plan is “${intent.workspaceContext.planSummary ?? "the current editorial plan"}”. Share the new campaign, source, or constraint and Harmonia will re-plan it against that strategy.` : "Your strategy is ready. Share the campaign window or next source and Harmonia will turn it into the editorial plan and calendar.") : "Harmonia needs a content strategy before it can build an ongoing plan. Share your company website and desired business outcome to start."}${connectionGuidance(intent.connectionSuggestions)}` } satisfies ChatResponse };

    case "manage_calendar":
      return { payload: { intent: intent.intent, reply: `${intent.workspaceContext?.planReady ? `Your plan is active with ${intent.workspaceContext.upcomingItemCount} upcoming item(s). Tell me the date, cadence, or priority change you want; external calendar sync will still require its normal confirmation.` : "There is no active editorial plan to schedule yet. Start with the company strategy, then Harmonia will build the plan and calendar in context."}${connectionGuidance(intent.connectionSuggestions)}` } satisfies ChatResponse };

    case "effect_request":
      return { payload: { intent: intent.intent, reply: "I can prepare that effect, but routing a request does not authorize it. Open the pending work, review the exact digest-bound action, and confirm only the action you want executed." } satisfies ChatResponse };

    case "status": {
      if (intent.jobId) {
        const job = await getJob(intent.jobId);
        const reply = job.failure
          ? `Job ${job.id} failed at '${job.failure.stage}' (${job.failure.retryable ? "transient" : "permanent"}): ${job.failure.publicMessage}`
          : job.stage === "awaiting_strategy_approval"
            ? `Job ${job.id} is waiting for approval of Ryan's strategy digest ${job.strategyDigest ?? "(missing)"}.`
            : job.stage === "awaiting_approval"
            ? `Job ${job.id} is waiting for your approval on ${pendingOf(job).length} action(s).`
            : `Job ${job.id} is at stage '${job.stage}' (${job.status}).`;
        return { payload: {
          intent: intent.intent,
          reply,
          jobId: job.id,
          job: toCard(job),
          pendingActions: job.stage === "awaiting_approval" ? summarizeActions(pendingOf(job)) : undefined,
          assets: await assetsOf(job.id),
        } satisfies ChatResponse };
      }
      const jobs = await listJobs();
      return { payload: {
        intent: intent.intent,
        reply: jobs.length
          ? `${jobs.length} recent job(s), newest first:`
          : "No jobs yet. Share a URL, upload a file, paste source material, or describe a content brief to create one.",
        jobs: jobs.slice(0, 5).map(toCard),
      } satisfies ChatResponse };
    }

    case "production_status": {
      const workspace = await resolveProductionWorkspace(intent.jobId);
      if (!workspace) return { payload: {
        intent: intent.intent,
        reply: intent.jobId ? `Job ${intent.jobId} has no production plan.` : "No recent job has a production plan.",
        ...(intent.jobId ? { jobId: intent.jobId } : {}),
      } satisfies ChatResponse };
      return { payload: {
        intent: intent.intent,
        reply: productionStatusReply(workspace),
        jobId: workspace.aggregate.jobId,
      } satisfies ChatResponse };
    }

    case "explain_production_plan": {
      const workspace = await resolveProductionWorkspace(intent.jobId);
      if (!workspace) return { payload: {
        intent: intent.intent,
        reply: intent.jobId ? `Job ${intent.jobId} has no production plan to explain.` : "No recent job has a production plan to explain.",
        ...(intent.jobId ? { jobId: intent.jobId } : {}),
      } satisfies ChatResponse };
      return { payload: {
        intent: intent.intent,
        reply: productionModelExplanation(workspace),
        jobId: workspace.aggregate.jobId,
      } satisfies ChatResponse };
    }

    case "approve_production_plan": {
      const workspace = await resolveProductionWorkspace(intent.jobId);
      if (!workspace) return { payload: {
        intent: intent.intent,
        reply: intent.jobId ? `Job ${intent.jobId} has no production plan to approve.` : "No recent job has a production plan to approve.",
        ...(intent.jobId ? { jobId: intent.jobId } : {}),
      } satisfies ChatResponse };
      return { payload: await buildProductionApprovalConfirmation(workspace, surface) };
    }

    case "create_production_plan":
    case "revise_production_plan": {
      if (!intent.jobId) return { payload: {
        intent: intent.intent,
        reply: `Specify the exact job ID to ${intent.intent === "create_production_plan" ? "create" : "revise"} a production plan.`,
      } satisfies ChatResponse };
      const result = await createOrReviseProductionPlanFromChat({
        jobId: intent.jobId,
        request: intent.productionRequest ?? message,
        revise: intent.intent === "revise_production_plan",
      });
      return { payload: {
        intent: intent.intent,
        reply: `${result.aggregate.state === "proposed" ? "Proposed" : "Created"} production plan ${result.plan.id} v${result.plan.revision} for job ${result.plan.jobId}: ${result.plan.scenes.length} shot(s), ${result.plan.target.durationSec}s, exact estimated and maximum cost $${result.plan.maximumCostUsd}. Review and seal this exact revision before production approval; publication remains separately gated.`,
        jobId: result.plan.jobId,
      } satisfies ChatResponse, status: 201 };
    }

    case "rerender_production_plan": {
      if (!intent.jobId) return { payload: {
        intent: intent.intent,
        reply: "Specify the exact job ID to rerender without changing paid assets.",
      } satisfies ChatResponse };
      if (!requestId) return { payload: {
        intent: intent.intent,
        reply: "Rerendering requires a durable request identity; no render run was scheduled.",
        jobId: intent.jobId,
      } satisfies ChatResponse, status: 409 };
      const rerender = await requestProductionRerenderFromChat(
        intent.jobId, requestId,
      );
      return { payload: {
        intent: intent.intent,
        reply: `Scheduled cost-free internal render run ${rerender.internalRun} for production plan ${rerender.planId}. Existing paid provider artifacts and mandate charges are unchanged; publication remains separately gated.`,
        jobId: intent.jobId,
      } satisfies ChatResponse, status: 202 };
    }

    case "list_artifacts": {
      if (!intent.jobId) {
        const jobs = await listJobs();
        return { payload: {
          intent: intent.intent,
          reply: "Which job? Recent jobs:",
          jobs: jobs.slice(0, 5).map(toCard),
        } satisfies ChatResponse };
      }
      const job = await getJob(intent.jobId);
      const artifacts = job.contentArtifacts ?? [];
      if (artifacts.length === 0) {
        return { payload: {
          intent: intent.intent,
          reply: `Job ${job.id} has no content artifacts yet (stage: ${job.stage}).`,
          jobId: job.id,
          job: toCard(job),
        } satisfies ChatResponse };
      }
      return { payload: {
        intent: intent.intent,
        reply: `${artifacts.length} immutable content artifact(s) for "${job.sourceAnalysis?.summary ?? job.id}":`,
        jobId: job.id,
        job: toCard(job),
        artifacts,
        assets: await assetsOf(job.id),
      } satisfies ChatResponse };
    }

    case "approve": {
      const jobId = intent.jobId;
      let job = jobId ? await getJob(jobId) : null;

      if (!job) {
        const jobs = await listJobs();
        const awaiting = jobs.filter((j) => j.stage === "awaiting_approval" || j.stage === "awaiting_strategy_approval");
        if (awaiting.length === 1) {
          job = await getJob(awaiting[0].id);
        } else if (awaiting.length === 0) {
          return { payload: {
            intent: intent.intent,
            reply: "No jobs are currently awaiting approval.",
            jobs: jobs.slice(0, 5).map(toCard),
          } satisfies ChatResponse };
        } else {
          return { payload: {
            intent: intent.intent,
            reply: `${awaiting.length} jobs are awaiting approval — which one?`,
            jobs: awaiting.map(toCard),
          } satisfies ChatResponse };
        }
      }

      return { payload: await buildApprovalConfirmation(job, surface) };
    }

    default: {
      {
        try {
          const result = await requestAgentAnswer(message);
          const askJobId = result.operationId;
          for (const item of result.activity) {
            await appendEvent(askJobId, "learn", item.publicMessage, "agent", {
              operationId: result.operationId,
              traceId: result.traceId,
              activity: {
                kind: "tool_call",
                status: item.status,
                role: "nova_liaison",
                toolName: item.toolName,
                publicMessage: item.publicMessage,
                ...(item.code ? { code: item.code } : {}),
                ...(item.category ? { category: item.category } : {}),
                ...(item.retryable === undefined ? {} : { retryable: item.retryable }),
                attempt: item.sequence,
              },
            });
          }
          return { payload: {
            intent: "agent",
            reply: result.answer,
          } satisfies ChatResponse };
        } catch (error) {
          console.error("agent ask failed; falling back to guidance", error);
        }
      }
      return { payload: {
        intent: "unknown",
        reply:
          "Tell me the outcome you need. For example:\n" +
          "- \"Build a content strategy for our startup from our website\"\n" +
          "- \"Plan the next month of founder content\"\n" +
          "- \"Turn this video into the best content for our current plan\"\n" +
          "- \"Write a one-off launch announcement for founders\"\n" +
          "- \"status of job <id>\" or \"status\"\n" +
          "- \"show artifacts for <id>\"\n" +
          "- \"approve job <id>\" (strategy and publication effects have separate explicit approvals)",
      } satisfies ChatResponse };
    }
  }
}
