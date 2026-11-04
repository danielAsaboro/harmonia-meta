import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";

// A2A (Agent2Agent) surface: an agent card describing Harmonia, and the two
// JSON-RPC methods other agents need to hand it work and follow it. A task is
// a Harmonia campaign; human approval shows up as `input-required`, because no
// calling agent can approve a strategy or a post.

export const A2A_PROTOCOL_VERSION = "0.3.0";

export function agentCard(baseUrl: string) {
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: "Harmonia",
    description: "A team of Meta-model agents that turns a startup's source material into reviewed social content. Strategy and every post wait for the workspace operator's approval.",
    url: `${baseUrl}/api/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    provider: { organization: "Harmonia", url: baseUrl },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    securitySchemes: { workspaceToken: { type: "http", scheme: "bearer", description: "A revocable hmn_ token the operator mints under Settings." } },
    security: [{ workspaceToken: [] }],
    skills: [
      {
        id: "create_campaign",
        name: "Create a content campaign",
        description: "Turn pasted text or a public URL into a grounded strategy and platform drafts (LinkedIn, X, captions). Include the rights attestation phrase for sources you may use.",
        tags: ["content", "social", "strategy", "startups"],
        examples: ["Turn this talk transcript into a LinkedIn post and two X posts for founders."],
      },
      {
        id: "campaign_status",
        name: "Follow a campaign",
        description: "Read a campaign's stage, what waits for human approval, and its finished drafts.",
        tags: ["status"],
        examples: ["What is waiting for approval on my last campaign?"],
      },
    ],
  };
}

type TaskState = "submitted" | "working" | "input-required" | "completed" | "failed";

export function taskState(stage: string, status: string): TaskState {
  if (status === "failed" || stage === "failed") return "failed";
  if (stage === "complete" || status === "complete") return "completed";
  if (stage.startsWith("awaiting") || status === "waiting_for_approval") return "input-required";
  if (stage === "collect_sources") return "submitted";
  return "working";
}

export interface CampaignView {
  id: string;
  stage: string;
  status: string;
  failure?: { publicMessage?: string } | null;
  contentArtifacts?: ContentArtifact[];
}

export function campaignTask(job: CampaignView, contextId: string, note?: string) {
  const state = taskState(job.stage, job.status);
  const text = note ?? (state === "input-required"
    ? `Waiting for the operator's approval at ${job.stage.replaceAll("_", " ")}.`
    : state === "failed" ? job.failure?.publicMessage ?? "The campaign failed." : `Stage: ${job.stage.replaceAll("_", " ")}.`);
  return {
    kind: "task",
    id: job.id,
    contextId,
    status: { state, message: { kind: "message", role: "agent", messageId: `${job.id}:${job.stage}`, parts: [{ kind: "text", text }] } },
    artifacts: (job.contentArtifacts ?? []).map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.payload.kind,
      parts: [{ kind: "text", text: contentArtifactPreview(artifact) }],
    })),
  };
}

export function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
