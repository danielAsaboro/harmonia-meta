import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ActivityTrace,
  ContextUsage,
  InlineCitation,
  ReasoningSummary,
} from "../src/components/a2ui/HarmoniaElements";
import {
  ApprovalReview,
  CampaignBrief,
  DraftComparison,
  JobProgress,
  MomentExplorer,
  SurfaceEmpty,
  VerificationReceipt,
} from "../src/components/a2ui/HarmoniaWorkspaceElements";

describe("Harmonia A2UI elements", () => {
  test("activity trace renders safe progress without private reasoning", () => {
    const html = renderToStaticMarkup(createElement(ActivityTrace, {
      title: "Agent activity",
      steps: [{ id: "s1", label: "Analyst inspected the video", status: "complete" }],
    }));
    expect(html).toContain("Agent activity");
    expect(html).toContain("Analyst inspected the video");
    expect(html).not.toContain("rawReasoning");
  });

  test("context usage derives bounded utilization", () => {
    const html = renderToStaticMarkup(createElement(ContextUsage, {
      model: "gemini",
      inputTokens: 750,
      outputTokens: 25,
      contextLimit: 1_000,
    }));
    expect(html).toContain("77.5%");
    expect(html).toContain("775 / 1,000 tokens");
  });

  test("citations open safely without granting opener access", () => {
    const html = renderToStaticMarkup(createElement(InlineCitation, {
      title: "Source",
      url: "https://example.com/source",
      sourceId: "source-1",
    }));
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  test("reasoning is explicitly labeled as a summary", () => {
    const html = renderToStaticMarkup(createElement(ReasoningSummary, {
      summary: "The draft cites the uploaded transcript.",
    }));
    expect(html).toContain("Reasoning summary");
    expect(html).toContain("uploaded transcript");
  });
});

describe("Harmonia generated workspace elements", () => {
  test("renders hostile generated strings as escaped React text", () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>';
    const html = renderToStaticMarkup(createElement(SurfaceEmpty, {
      title: hostile,
      message: hostile,
    }));
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  test("renders bounded art direction as semantic data attributes", () => {
    const html = renderToStaticMarkup(createElement(CampaignBrief, {
      title: "Campaign direction",
      brief: "Lead with the customer outcome.",
      sourceKind: "text",
      platforms: ["x"],
      angles: [],
      tone: "ink",
      role: "hero",
      density: "airy",
      motion: "reveal",
    }));

    expect(html).toContain('data-tone="ink"');
    expect(html).toContain('data-role="hero"');
    expect(html).toContain('data-density="airy"');
    expect(html).toContain('data-motion="reveal"');
  });

  test("labels the active workflow stage without relying on color", () => {
    const html = renderToStaticMarkup(createElement(JobProgress, {
      title: "Content workflow",
      stage: "draft",
      status: "running",
      stages: [
        { id: "understand", label: "understand", status: "complete" },
        { id: "draft", label: "draft", status: "active" },
      ],
    }));

    expect(html).toContain("draft · In progress");
    expect(html).toContain('data-active="true"');
  });

  test("renders a source-grounded draft comparison", () => {
    const html = renderToStaticMarkup(createElement(DraftComparison, {
      title: "Choose the launch voice",
      agentFraming: true,
      drafts: [{ id: "d1", platform: "x", text: "Ship outcomes.", valid: true, selected: true, sourceCount: 1 }],
    }));
    expect(html).toContain("Choose the launch voice");
    expect(html).toContain("Ship outcomes.");
    expect(html).toContain("1 source");
    expect(html).toContain("Agent framing");
    expect(html).toContain('aria-label="Compare draft d1"');
    expect(html).toContain('aria-label="Request revision for draft d1"');
  });

  test("renders moments with semantic timing and transcript evidence", () => {
    const html = renderToStaticMarkup(createElement(MomentExplorer, {
      title: "Proof moments",
      source: { id: "source-video", label: "Founder interview", kind: "video", externalUrl: "https://www.youtube.com/watch?v=abcdefghijk" },
      moments: [{ id: "m1", title: "Setup proof", startSec: 4, endSec: 12, hook: "Half the setup", quote: "We cut setup time by half.", selected: true }],
      transcript: [{ id: "s1", startSec: 4, endSec: 12, text: "We cut setup time by half." }],
    }));
    expect(html).toContain("Proof moments");
    expect(html).toContain("00:04");
    expect(html).toContain("We cut setup time by half.");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-pressed="true"');
  });

  test("never renders approval controls from generated review detail", () => {
    const html = renderToStaticMarkup(createElement(ApprovalReview, {
      actionId: "publish-1",
      actionType: "publish_x_post",
      title: "Publish launch post",
      description: "Publish the approved post.",
      risk: "high",
      requiresApproval: true,
      approvalState: "approved",
      actionState: "executed",
      destination: "X",
      previewText: "Outcome launch.",
    }));
    expect(html).toContain("publish-1");
    expect(html).toContain("Outcome launch.");
    expect(html).not.toContain("Approve and continue");
    expect(html).not.toContain("Reject");
  });

  test("renders verification evidence without exposing receipt detail payloads", () => {
    const html = renderToStaticMarkup(createElement(VerificationReceipt, {
      receiptId: "receipt-1",
      actionId: "publish-1",
      actionType: "publish_x_post",
      title: "Verified external effect",
      performedAt: "2026-08-23T00:02:00.000Z",
      outcome: "applied",
      verified: true,
      verificationMethod: "official API lookup",
    }));
    expect(html).toContain("Verified");
    expect(html).toContain("official API lookup");
    expect(html).not.toContain("idempotencyKey");
  });

  test("labels an unverified receipt as verification pending", () => {
    const html = renderToStaticMarkup(createElement(VerificationReceipt, {
      receiptId: "receipt-2",
      actionId: "publish-2",
      actionType: "publish_x_post",
      title: "External effect receipt",
      performedAt: "2026-08-23T00:02:00.000Z",
      outcome: "applied",
      verified: false,
      tone: "paper",
      role: "feature",
      density: "balanced",
      motion: "none",
    }));

    expect(html).toContain("Verification pending");
    expect(html).toContain('data-tone="paper"');
  });
});
