import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listChatMessages: vi.fn(),
  saveChatMessage: vi.fn(),
}));
const chatIntent = vi.hoisted(() => ({ parseIntent: vi.fn() }));
const sourceManifest = vi.hoisted(() => ({ createSourceJob: vi.fn() }));
const sourceRights = vi.hoisted(() => ({ hasRightsAttestation: vi.fn() }));
const chatAttachments = vi.hoisted(() => ({ requireReadyAttachments: vi.fn() }));

vi.mock("@/lib/firestore", () => ({
  appendEvent: vi.fn(),
  getJob: vi.fn(),
  listAssets: vi.fn(),
  listChatMessages: firestore.listChatMessages,
  listJobs: firestore.listJobs,
  saveChatMessage: firestore.saveChatMessage,
}));
vi.mock("@/lib/chatIntent", () => ({ parseIntent: chatIntent.parseIntent }));
vi.mock("@/lib/sourceManifest", () => ({ createSourceJob: sourceManifest.createSourceJob }));
vi.mock("@/lib/stageTrigger", () => ({ queueStageTrigger: vi.fn() }));
vi.mock("@/lib/tenancy", () => ({ currentTenant: () => ({ workspaceId: "workspace-local", brandId: "brand-local", principal: { subjectId: "user-local" } }) }));
vi.mock("@/lib/sourceRights", () => ({
  hasRightsAttestation: sourceRights.hasRightsAttestation,
  RIGHTS_ATTESTATION_PHRASE: "I confirm I have the rights to process this media.",
  sourceRightsAuthorization: () => ({ id: "rights-web" }),
  sourceRightsAuthorizationId: () => "rights-web",
}));
vi.mock("@/lib/chatAttachments", () => ({ requireReadyAttachments: chatAttachments.requireReadyAttachments }));
vi.mock("@/lib/agentAskClient", () => ({ requestAgentAnswer: vi.fn().mockRejectedValue(new Error("agent unavailable")) }));

import { metadata } from "../src/app/layout";
import { handleChat } from "../src/lib/chatHandler";

describe("source-agnostic product copy", () => {
  beforeEach(() => {
    firestore.listJobs.mockResolvedValue([]);
    firestore.listChatMessages.mockResolvedValue([]);
    firestore.saveChatMessage.mockResolvedValue(undefined);
    chatAttachments.requireReadyAttachments.mockResolvedValue([]);
    sourceRights.hasRightsAttestation.mockReturnValue(false);
    chatIntent.parseIntent.mockResolvedValue({ intent: "status" });
    sourceManifest.createSourceJob.mockResolvedValue({
      id: "job-natural-1", workspaceId: "workspace-local", brandId: "brand-local",
      status: "running", stage: "collect_sources", controlEpoch: 0, controlState: "running",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["linkedin_post"], allowedOutputs: ["linkedin_post"], platforms: ["linkedin"] },
      actions: [], assets: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("describes the supported source range in search metadata", () => {
    expect(metadata.description).toContain("video, audio, documents, webpages, and text");
  });

  it("offers multiple ways to begin when chat has no jobs", async () => {
    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "status" }),
    }));

    expect(await response.json()).toMatchObject({
      reply: "No jobs yet. Share a URL, upload a file, paste source material, or describe a content brief to create one.",
    });
  });

  it("offers source-agnostic examples when chat needs to explain its capabilities", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    chatIntent.parseIntent.mockResolvedValue({ intent: "unknown" });
    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "help me get started" }),
    }));

    const payload = await response.json() as { reply: string };
    expect(payload.reply).toContain("content strategy for our startup");
    expect(payload.reply).toContain("Plan the next month");
    expect(payload.reply).toContain("one-off launch announcement");
    expect(payload.reply).not.toContain("x_post");
    errorLog.mockRestore();
  });

  it("invites the operator to connect a recommended but disconnected platform", async () => {
    chatIntent.parseIntent.mockResolvedValue({
      intent: "establish_strategy",
      connectionSuggestions: ["linkedin"],
      workspaceContext: { strategyReady: false },
    });
    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Build our content strategy" }),
    }));
    const payload = await response.json() as { reply: string };
    expect(payload.reply).toContain("LinkedIn is a good fit but not connected yet");
    expect(payload.reply).toContain("Connect it in Settings");
    expect(payload.reply).toContain("still prepare the strategy and drafts now");
  });

  it("keeps connection guidance visible while asking a clarifying question", async () => {
    chatIntent.parseIntent.mockResolvedValue({
      intent: "establish_strategy",
      needsClarification: true,
      clarifyingQuestion: "What outcome should the strategy prioritize?",
      connectionSuggestions: ["linkedin"],
    });
    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Help us plan LinkedIn content" }),
    }));
    const payload = await response.json() as { reply: string };
    expect(payload.reply).toContain("What outcome should the strategy prioritize?");
    expect(payload.reply).toContain("LinkedIn is a good fit but not connected yet");
  });

  it("persists the coordinator's inferred strategy context when an ordinary request starts work", async () => {
    const strategyContext = {
      company: "Harmonia", product: "Content operations for startups", positioning: "Evidence-backed content operations",
      differentiators: ["Human approval before effects"], brandVoice: ["clear"], exclusions: [], safetyConstraints: ["No invented claims"],
      businessObjectives: ["Reach startup founders"], campaignObjectives: ["Build awareness"],
      audiences: [{ id: "founders", name: "Startup founders", pains: ["Inconsistent content"] }],
      funnelStage: "awareness", intendedConversion: "Visit the website", requestedChannels: ["linkedin"], supportedChannels: ["linkedin"], horizonWeeks: 4,
    };
    chatIntent.parseIntent.mockResolvedValue({
      intent: "create_job", userOutcome: "Help more founders find us",
      sources: [{ kind: "web", url: "https://example.com" }], desiredOutputs: ["linkedin_post"],
      platformRecommendations: ["linkedin"], strategyContext, workspaceContext: { strategyReady: false },
      requiresRightsAttestation: false,
    });

    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Can you help more founders find us? Here's our site: https://example.com" }),
    }));

    expect(response.status).toBe(200);
    expect(sourceManifest.createSourceJob).toHaveBeenCalledWith(expect.objectContaining({
      platforms: ["linkedin"], strategyContext,
      operatorBrief: "Can you help more founders find us? Here's our site: https://example.com",
    }));
  });

  it("binds a rights confirmation to the prior uploaded source in the same conversation", async () => {
    sourceRights.hasRightsAttestation.mockImplementation((message: string) => message === "I confirm I have rights to use this source");
    chatAttachments.requireReadyAttachments.mockImplementation(async (ids: string[]) => ids.length === 1 ? [{
      id: "attachment-video-1", filename: "launch.mp4", mime: "video/mp4", sizeBytes: 1024,
      workspaceId: "workspace-local", brandId: "brand-local", createdByUserId: "user-local",
      objectName: "chat-attachments/launch.mp4", storageUri: "file://chat-attachments/attachment-video-1", state: "ready",
      createdAt: "2026-09-04T04:07:00.000Z", updatedAt: "2026-09-04T04:07:00.000Z", category: "video",
    }] : []);
    firestore.listChatMessages.mockResolvedValue([
      { id: "original", role: "user", surface: "dashboard", text: "Turn this video into launch content", at: "2026-09-04T04:07:00.000Z", data: { attachments: [{ attachmentId: "attachment-video-1" }] } },
      { id: "rights-prompt", role: "assistant", surface: "dashboard", text: "Confirm source rights", at: "2026-09-04T04:07:01.000Z" },
    ]);
    chatIntent.parseIntent.mockResolvedValue({ intent: "create_job", userOutcome: "Turn this video into launch content", desiredOutputs: ["x_post"], requiresRightsAttestation: true });

    const response = await handleChat(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "I confirm I have rights to use this source", conversationId: "primary" }),
    }));

    expect(response.status).toBe(200);
    expect(sourceManifest.createSourceJob).toHaveBeenCalledWith(expect.objectContaining({
      operatorBrief: "Turn this video into launch content",
      directSources: [expect.objectContaining({ kind: "upload", attachmentId: "attachment-video-1" })],
    }));
  });
});
