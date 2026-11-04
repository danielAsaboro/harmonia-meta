import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredBrandBrief } from "@/lib/brandBrief";

const mocks = vi.hoisted(() => ({
  getGoals: vi.fn(),
  parseIntent: vi.fn(),
  requestAgentAnswer: vi.fn(),
  answerFromContext: vi.fn(),
  createChatCompletion: vi.fn(),
}));

vi.mock("@/lib/firestore", () => ({
  appendEvent: vi.fn(),
  getGoals: mocks.getGoals,
  getJob: vi.fn(),
  listAssets: vi.fn(),
  listChatMessages: vi.fn().mockResolvedValue([]),
  listJobs: vi.fn().mockResolvedValue([]),
  saveChatMessage: vi.fn(),
}));
vi.mock("@/lib/chatIntent", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/chatIntent")>()), parseIntent: mocks.parseIntent }));
vi.mock("@/lib/tenancy", () => ({ currentTenant: () => ({ workspaceId: "w1", brandId: "b1", principal: { subjectId: "u1" } }), tenantSubjectId: () => "u1" }));
vi.mock("@/lib/chatAttachments", () => ({ requireReadyAttachments: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/agentAskClient", () => ({ requestAgentAnswer: mocks.requestAgentAnswer }));
vi.mock("@/lib/contextAnswer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contextAnswer")>()),
  fetchContextRecord: vi.fn().mockResolvedValue({ id: "job-1", stage: "drafting" }),
  answerFromContext: mocks.answerFromContext,
}));
vi.mock("@/lib/metaChatCompletion", () => ({ createChatCompletion: mocks.createChatCompletion }));

import { brandBriefContext, BRAND_CONTEXT_MAX_CHARS } from "@/lib/brandBriefContext";
import { handleChat } from "@/lib/chatHandler";

const stored = {
  website: "https://acme.test/", digest: "d", createdAt: "2026-11-01T00:00:00.000Z", evidence: [], pages: [], unverifiedResearchDropped: 0, modelCalls: [],
  brief: {
    company: "Acme", product: "Client reporting", category: "Reporting", positioning: "Five-minute client reports", differentiators: [],
    audiences: [{ id: "agency-owners", name: "Agency owners", pains: ["Reporting eats a day", "Clients ignore dashboards", "Slides break", "Fourth pain"], jobsToBeDone: [], objections: [], evidenceIds: [] }],
    competitors: [{ name: "Rival", howWeDiffer: "Dashboards", evidenceIds: [] }], pillars: [],
    voiceRules: ["Numbers first", "No hype"], exclusions: [], businessObjectives: [], campaignObjectives: [], funnelStage: "awareness", intendedConversion: "Trial",
  },
} satisfies StoredBrandBrief;

const chat = (body: Record<string, unknown>) => handleChat(new Request("http://localhost/api/chat", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

describe("brand brief in chat prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseIntent.mockResolvedValue({ intent: "unknown" });
    mocks.requestAgentAnswer.mockResolvedValue({ answer: "ok", operationId: "ask-1", traceId: "t", activity: [] });
    mocks.answerFromContext.mockResolvedValue("ok");
  });

  it("renders company, positioning, each customer's top pains and voice within the bound", () => {
    expect(brandBriefContext(stored)).toBe([
      "Company: Acme. Positioning: Five-minute client reports",
      "Customer agency-owners (Agency owners) pains: Reporting eats a day; Clients ignore dashboards; Slides break",
      "Voice: Numbers first; No hype",
    ].join("\n"));
    const many = { ...stored, brief: { ...stored.brief, audiences: Array.from({ length: 6 }, (_, index) => ({ ...stored.brief.audiences[0], id: `a${index}`, pains: ["x".repeat(300)] })) } };
    expect(brandBriefContext(many)!.length).toBe(BRAND_CONTEXT_MAX_CHARS);
    expect(brandBriefContext(undefined)).toBeUndefined();
  });

  it("sends the brief with plain questions to the agent, and nothing without one", async () => {
    mocks.getGoals.mockResolvedValue({ brandBrief: stored });
    await chat({ message: "who are we writing for?" });
    expect(mocks.requestAgentAnswer).toHaveBeenCalledWith("who are we writing for?", { brandContext: brandBriefContext(stored) });

    mocks.getGoals.mockResolvedValue({});
    await chat({ message: "who are we writing for?" });
    expect(mocks.requestAgentAnswer).toHaveBeenLastCalledWith("who are we writing for?", { brandContext: undefined });
  });

  it("passes the brief to answers about one record", async () => {
    mocks.getGoals.mockResolvedValue({ brandBrief: stored });
    await chat({ message: "is this right for our customers?", context: { kind: "job", id: "job-1" } });
    expect(mocks.answerFromContext).toHaveBeenCalledWith("is this right for our customers?", { id: "job-1", stage: "drafting" }, brandBriefContext(stored));
  });
});

describe("record answers and agent requests", () => {
  it("puts the brief in the record prompt only when there is one", async () => {
    const { answerFromContext } = await vi.importActual<typeof import("@/lib/contextAnswer")>("@/lib/contextAnswer");
    mocks.createChatCompletion.mockResolvedValue("ok");
    await answerFromContext("q", { a: 1 }, "Company: Acme.");
    expect(mocks.createChatCompletion.mock.calls[0][0].messages[1].content).toBe("Brand brief (who the company, its customers and its voice are; frames the answer, never a source of record facts):\nCompany: Acme.\n\nRecord JSON:\n{\"a\":1}\n\nQuestion: q");
    await answerFromContext("q", { a: 1 });
    expect(mocks.createChatCompletion.mock.calls[1][0].messages[1].content).toBe("Record JSON:\n{\"a\":1}\n\nQuestion: q");
  });

  it("adds brandContext to the ask body only when given", async () => {
    const { requestAgentAnswer } = await vi.importActual<typeof import("@/lib/agentAskClient")>("@/lib/agentAskClient");
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ answer: "ok", operationId: "ask-1", traceId: "t", activity: [] }));
    const options = { baseUrl: "http://localhost:8080", token: "t", tenant: { workspaceId: "w1", brandId: "b1", userId: "u1" }, fetchImpl };
    await requestAgentAnswer("q", { ...options, brandContext: "Company: Acme." });
    await requestAgentAnswer("q", options);
    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toEqual([{ question: "q", brandContext: "Company: Acme." }, { question: "q" }]);
  });
});
