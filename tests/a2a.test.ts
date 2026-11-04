import { describe, expect, it } from "vitest";
import { agentCard, campaignTask, taskState } from "@/lib/a2a";
import { agentTokenRouteAllowed } from "@/lib/agentTokens";

describe("A2A surface", () => {
  it("publishes a card with JSON-RPC transport, bearer auth and two skills", () => {
    const card = agentCard("https://harmonia.example");
    expect(card.url).toBe("https://harmonia.example/api/a2a");
    expect(card.preferredTransport).toBe("JSONRPC");
    expect(card.securitySchemes.workspaceToken).toMatchObject({ type: "http", scheme: "bearer" });
    expect(card.skills.map((skill) => skill.id)).toEqual(["create_campaign", "campaign_status"]);
  });

  it("maps a human approval gate to input-required, never to completed", () => {
    expect(taskState("awaiting_strategy_approval", "waiting_for_approval")).toBe("input-required");
    expect(taskState("awaiting_approval", "running")).toBe("input-required");
    expect(taskState("collect_sources", "running")).toBe("submitted");
    expect(taskState("draft", "running")).toBe("working");
    expect(taskState("complete", "complete")).toBe("completed");
    expect(taskState("understand", "failed")).toBe("failed");
  });

  it("returns finished drafts as task artifacts", () => {
    const task = campaignTask({
      id: "job-1", stage: "complete", status: "complete",
      contentArtifacts: [{ id: "x1", payload: { kind: "x_post", text: "Support tickets fell 31%." } }] as never,
    }, "ctx");
    expect(task.status.state).toBe("completed");
    expect(task.artifacts).toEqual([{ artifactId: "x1", name: "x_post", parts: [{ kind: "text", text: "Support tickets fell 31%." }] }]);
  });

  it("lets a workspace token reach the A2A endpoint but not approvals", () => {
    expect(agentTokenRouteAllowed("POST", "/api/a2a")).toBe(true);
    expect(agentTokenRouteAllowed("POST", "/api/jobs/job-1/strategy/decision")).toBe(false);
  });
});
