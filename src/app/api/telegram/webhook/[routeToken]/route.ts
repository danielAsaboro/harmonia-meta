import {
  claimTelegramDecisionNonce,
  claimTelegramStrategyPrompt,
  finalizeTelegramDecisionNonce,
  finalizeTelegramStrategyPrompt,
  getTelegramConnection,
  getJob,
  getTelegramWebhookRoute,
  decideStrategy,
} from "@/lib/firestore";
import { approveProductionPlan, getProductionPlan, getProductionPlanWorkspaceForJob } from "@/lib/productionPlanStore";
import { resolveDecision } from "@/lib/decisions";
import { runWithTenant } from "@/lib/tenancy";
import { TelegramWebhookError, verifyTelegramWebhook } from "@/lib/telegramWebhook";
import { promptTelegramStrategyFeedback } from "@/lib/telegramStrategyApproval";
import { handleChat, type ChatResponse } from "@/lib/chatHandler";
import { sendTelegramMessage } from "@/lib/telegramApi";
import { sendTelegramProductionApproval } from "@/lib/telegramProductionApproval";

const MAX_UPDATE_BYTES = 64 * 1024;

async function existingStrategyDecision(jobId: string, payloadDigest: string, decision: "approved" | "rejected"): Promise<boolean> {
  const job = await getJob(jobId);
  return job.strategyApproval?.payloadDigest === payloadDigest && job.strategyApproval.decision === decision;
}

function errorResponse(error: unknown): Response {
  if (error instanceof TelegramWebhookError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("not found") ? 404
    : message.includes("expired") || message.includes("processing") || message.includes("mismatch") ? 409
      : 400;
  return Response.json({ error: message }, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ routeToken: string }> },
): Promise<Response> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPDATE_BYTES) {
    return errorResponse(new TelegramWebhookError("Telegram update is too large", 413));
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_UPDATE_BYTES) {
    return errorResponse(new TelegramWebhookError("Telegram update is too large", 413));
  }
  const { routeToken } = await params;
  try {
    const route = await getTelegramWebhookRoute(routeToken);
    if (!route) throw new TelegramWebhookError("Telegram webhook route not found", 404);
    const verified = verifyTelegramWebhook({
      route,
      routeToken,
      secret: req.headers.get("x-telegram-bot-api-secret-token") ?? "",
      update: JSON.parse(raw) as unknown,
    });
    if (verified.kind === "operator_message") {
      const result = await runWithTenant({
        workspaceId: route.workspaceId, brandId: route.brandId, principal: verified.principal,
      }, async () => {
        const connection = await getTelegramConnection();
        if (!connection) throw new Error("Telegram not connected");
        const chatResponse = await handleChat(new Request("https://harmonia.internal/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: verified.message, surface: "telegram",
            conversationId: "telegram", requestId: `telegram-${verified.updateId}`, attachmentIds: [],
          }),
        }));
        const payload = await chatResponse.json().catch(() => null) as (ChatResponse & { error?: string }) | null;
        const reply = payload?.reply ?? payload?.error ?? `Harmonia could not process that request (${chatResponse.status}).`;
        let delivered = true;
        try {
          if (payload?.intent === "approve_production_plan" && payload.jobId) {
            const workspace = await getProductionPlanWorkspaceForJob(payload.jobId);
            if (!workspace || workspace.aggregate.state !== "sealed") throw new Error("sealed production plan not found");
            await sendTelegramProductionApproval({
              connection,
              workspaceId: route.workspaceId,
              brandId: route.brandId,
              jobId: workspace.aggregate.jobId,
              planId: workspace.aggregate.id,
              planDigest: workspace.aggregate.currentPlanDigest,
              maximumCostUsd: workspace.revision.plan.maximumCostUsd,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            });
          } else {
            await sendTelegramMessage({ botToken: connection.botToken, chatId: connection.chatId, text: reply });
          }
        } catch {
          // The canonical chat mutation may already be durable. Acknowledge the
          // update so Telegram does not retry it and accidentally create a duplicate job.
          delivered = false;
        }
        return { chatResponse, payload, delivered };
      });
      return Response.json({
        ok: true, updateId: verified.updateId, replyDelivered: result.delivered,
        intent: result.payload?.intent,
      });
    }
    if (verified.kind === "strategy_feedback") {
      const claim = await claimTelegramStrategyPrompt(routeToken, verified.promptMessageId);
      const prompt = claim.prompt;
      if (prompt.workspaceId !== route.workspaceId || prompt.brandId !== route.brandId) throw new TelegramWebhookError("Telegram strategy prompt tenant mismatch", 409);
      if (prompt.actorSubjectId !== verified.principal.subjectId) throw new TelegramWebhookError("Telegram strategy feedback actor mismatch", 409);
      if (claim.duplicate) return Response.json({ ok: true, duplicate: true, decisionId: prompt.decisionId });
      const outcome = await runWithTenant({ workspaceId: route.workspaceId, brandId: route.brandId, principal: verified.principal }, async () => (
        await existingStrategyDecision(prompt.jobId, prompt.payloadDigest, "rejected")
          ? { reconciled: true }
          : decideStrategy(prompt.jobId, { decision: "rejected", payloadDigest: prompt.payloadDigest, feedback: verified.feedback })
      ));
      const decisionId = `${prompt.jobId}:strategy:${prompt.payloadDigest}`;
      await finalizeTelegramStrategyPrompt(routeToken, verified.promptMessageId, decisionId);
      return Response.json({ ok: true, decisionId, outcome });
    }
    const claim = await claimTelegramDecisionNonce(routeToken, verified.nonce);
    if (claim.nonce.workspaceId !== route.workspaceId || claim.nonce.brandId !== route.brandId) {
      throw new TelegramWebhookError("Telegram decision tenant mismatch", 409);
    }
    if (claim.duplicate) {
      return Response.json({ ok: true, duplicate: true, decisionId: claim.nonce.decisionId });
    }
    if (claim.nonce.target === "strategy_feedback") {
      const promptMessageId = await runWithTenant({ workspaceId: route.workspaceId, brandId: route.brandId, principal: verified.principal }, async () => {
        const connection = await getTelegramConnection();
        if (!connection) throw new Error("Telegram not connected");
        return promptTelegramStrategyFeedback({
          botToken: connection.botToken, chatId: connection.chatId, routeTokenDigest: connection.routeTokenDigest,
          workspaceId: route.workspaceId, brandId: route.brandId, jobId: claim.nonce.jobId,
          payloadDigest: claim.nonce.payloadDigest, actorSubjectId: verified.principal.subjectId,
          expiresAt: claim.nonce.expiresAt,
        });
      });
      const decisionId = `${claim.nonce.jobId}:strategy-feedback:${promptMessageId}`;
      await finalizeTelegramDecisionNonce(routeToken, verified.nonce, decisionId);
      return Response.json({ ok: true, duplicate: false, decisionId, awaitingFeedback: true });
    }
    if (claim.nonce.target === "production" && claim.nonce.decision !== "approved") {
      throw new TelegramWebhookError("invalid Telegram production decision", 409);
    }
    const outcome = await runWithTenant({
      workspaceId: route.workspaceId,
      brandId: route.brandId,
      principal: verified.principal,
    }, async () => {
      if (claim.nonce.target === "production") {
        const current = await getProductionPlan(claim.nonce.actionId);
        if (current?.state === "approved" && current.currentPlanDigest === claim.nonce.payloadDigest) {
          return { reconciled: true, planId: claim.nonce.actionId, planDigest: claim.nonce.payloadDigest };
        }
        return approveProductionPlan(claim.nonce.actionId, {
          planDigest: claim.nonce.payloadDigest,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }
      if (claim.nonce.target === "strategy") {
        return await existingStrategyDecision(claim.nonce.jobId, claim.nonce.payloadDigest, claim.nonce.decision)
          ? { reconciled: true }
          : decideStrategy(claim.nonce.jobId, {
            decision: claim.nonce.decision, payloadDigest: claim.nonce.payloadDigest,
            ...(claim.nonce.feedback ? { feedback: claim.nonce.feedback } : {}),
          });
      }
      return resolveDecision(
        claim.nonce.jobId, claim.nonce.actionId, claim.nonce.decision, claim.nonce.payloadDigest,
      );
    });
    const decisionId = claim.nonce.target === "production"
      ? `${claim.nonce.jobId}:production:${claim.nonce.actionId}:${claim.nonce.payloadDigest}`
      : claim.nonce.target === "strategy"
      ? `${claim.nonce.jobId}:strategy:${claim.nonce.payloadDigest}`
      : `${claim.nonce.jobId}:approval:${claim.nonce.actionId}`;
    await finalizeTelegramDecisionNonce(routeToken, verified.nonce, decisionId);
    return Response.json({ ok: true, duplicate: false, decisionId, outcome });
  } catch (error) {
    return errorResponse(error);
  }
}
