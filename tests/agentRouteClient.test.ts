import { describe, expect, it, vi } from "vitest";

import { requestIntentRoute } from "@/lib/agentRouteClient";

const context = { strategyReady: true, planReady: true, calendarReady: false, pendingApprovalCount: 0, goals: [], channels: ["x"], upcomingItemCount: 0, recentJobs: [] };
const strategyContext = {
  company: "Harmonia", product: "An autonomous content engine for startups",
  positioning: "Turn source material into an evidence-backed content program",
  differentiators: ["Human approval before external effects"], brandVoice: ["clear", "evidence-led"],
  exclusions: [], safetyConstraints: ["Do not invent source claims"],
  businessObjectives: ["Build awareness with startup founders"], campaignObjectives: ["Create useful founder content"],
  audiences: [{ id: "startup-founders", name: "Startup founders", pains: ["Limited time for consistent content"] }],
  funnelStage: "awareness" as const, intendedConversion: "Visit the website to learn more",
  requestedChannels: ["linkedin"], supportedChannels: ["linkedin"], horizonWeeks: 4,
};

describe("Harmonia intent route client", () => {
  it("allows the coordinator's full model deadline before aborting", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      });
      void requestIntentRoute({ message: "Help people find us", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
        baseUrl: "http://localhost:8080", token: "token", fetchImpl: fetchImpl as typeof fetch,
        tenant: { workspaceId: "w", brandId: "b", userId: "u" },
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(capturedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends natural language and workspace context to the agent service", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      intent: "one_off_content", userOutcome: "Announce the launch", sourceUrls: [],
      outputConcepts: ["short_social_post"], assumptions: [], needsClarification: false,
      platformRecommendations: ["linkedin"], connectionSuggestions: ["linkedin"],
      clarifyingQuestion: null, requiresRightsAttestation: false, effectRequested: false,
      effectAuthorized: false, jobId: null, strategyContext: { ...strategyContext, researchRequest: null },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const route = await requestIntentRoute({ message: "Announce our launch", workspaceContext: context, attachmentCount: 0, recentConversation: [{ role: "user", text: "We sell developer tools." }] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    });
    expect(route.intent).toBe("one_off_content");
    expect(route.strategyContext).toEqual(strategyContext);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ message: "Announce our launch", workspaceContext: { strategyReady: true }, recentConversation: [{ role: "user", text: "We sell developer tools." }] });
  });

  it("rejects routes that claim to authorize an effect", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      intent: "effect_request", userOutcome: "Publish", sourceUrls: [], outputConcepts: [],
      platformRecommendations: ["x"], connectionSuggestions: [],
      assumptions: [], needsClarification: false, clarifyingQuestion: null,
      requiresRightsAttestation: false, effectRequested: true, effectAuthorized: true, jobId: null,
      strategyContext: null,
    }), { status: 200 }));
    await expect(requestIntentRoute({ message: "Publish it", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    })).rejects.toThrow(/invalid intent route/i);
  });

  it("reports safe validation locations without echoing rejected input", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: [{ type: "string_too_long", loc: ["body", "recentConversation", 3, "text"], msg: "String should have at most 2000 characters", input: "private conversation contents" }],
    }), { status: 422, headers: { "content-type": "application/json" } }));
    await expect(requestIntentRoute({ message: "Help people find us", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    })).rejects.toThrow("body.recentConversation.3.text (string_too_long)");
    await expect(requestIntentRoute({ message: "Help people find us", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    })).rejects.not.toThrow("private conversation contents");
  });

  it("reports the agent's structured public failure without provider details", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: {
        code: "agent_engine_unavailable", category: "dependency",
        message: "Harmonia's reasoning service is temporarily unavailable.", retryable: true,
        providerDetail: "must never be shown",
      },
    }), { status: 502, headers: { "content-type": "application/json" } }));
    await expect(requestIntentRoute({ message: "Help people find us", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    })).rejects.toThrow("[agent_engine_unavailable] Harmonia's reasoning service is temporarily unavailable.");
    await expect(requestIntentRoute({ message: "Help people find us", workspaceContext: context, attachmentCount: 0, recentConversation: [] }, {
      baseUrl: "http://localhost:8080", token: "token", fetchImpl,
      tenant: { workspaceId: "w", brandId: "b", userId: "u" },
    })).rejects.not.toThrow("must never be shown");
  });
});
