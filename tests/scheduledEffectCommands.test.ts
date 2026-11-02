import { describe, expect, it } from "vitest";

import { firebasePrincipal } from "@/lib/authority";
import { buildScheduledEffectCommand, planScheduledMutation } from "@/lib/scheduledEffects";
import type { ContentItem } from "@/lib/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const item: ContentItem = {
  id: "item-1", jobId: "job-1", text: "Launch", platforms: ["x"], status: "scheduled",
  publishMode: "auto", scheduledFor: "2026-08-27T09:00:00.000Z",
  createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z",
};
const context = {
  workspaceId: "workspace-1", brandId: "brand-1",
  principal: firebasePrincipal({ subjectId: "user-1", workspaceRole: "member", authenticationId: "session-1" }),
};

describe("scheduled effect authorization", () => {
  it("records exact-payload authorization when an operator schedules auto mode", () => {
    const command = buildScheduledEffectCommand(item, context);
    expect(command.authorization).toMatchObject({ kind: "approval", approvedPayloadDigest: command.payloadDigest });
    expect(command.executeAfter).toBe(item.scheduledFor);
  });

  it("cancels the old command and requires review after material edits", () => {
    const command = buildScheduledEffectCommand(item, context);
    const result = planScheduledMutation(item, command, { text: "Changed" }, "2026-08-26T01:00:00.000Z");
    expect(result.command?.state).toBe("cancelled");
    expect(result.item).toMatchObject({ text: "Changed", status: "draft", publishMode: "approval" });
  });

  it("does not invalidate a command for non-material metadata updates", () => {
    const command = buildScheduledEffectCommand(item, context);
    const result = planScheduledMutation(item, command, {}, "2026-08-26T01:00:00.000Z");
    expect(result.command?.state).toBe("prepared");
  });

  it("never exposes raw scheduled payloads through the worker wake-up feed", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/api/internal/items/route.ts"), "utf8");
    expect(source).toContain("Response.json({ commandIds:");
    expect(source).not.toMatch(/Response\.json\(\{\s*due/);
    expect(source).not.toContain("export const POST");
  });
});
