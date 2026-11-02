import { describe, expect, it } from "vitest";

import {
  createCommandEnvelope,
  decideJobControl,
  type JobControlState,
} from "@/lib/operations/commands";

const actor = {
  actorType: "firebase_operator" as const,
  subjectId: "user-1",
  authenticationId: "firebase-session-1",
};
const state: JobControlState = {
  jobId: "job-1",
  status: "running",
  controlState: "running",
  controlEpoch: 2,
};

function envelope(action: "pause" | "resume" | "cancel", expectedControlEpoch = 2, commandId = `command-${action}`) {
  return createCommandEnvelope({
    commandId,
    jobId: "job-1",
    action,
    expectedControlEpoch,
    ...(action === "cancel" ? { confirmation: "CANCEL job-1" } : {}),
    actor,
    receivedAt: "2026-08-31T00:00:00.000Z",
  });
}

describe("job control commands", () => {
  it("applies pause, resume, and cancellation through one versioned control state", () => {
    const paused = decideJobControl(state, envelope("pause"));
    expect(paused).toMatchObject({ accepted: true, next: { controlState: "paused", controlEpoch: 3 } });

    const resumed = decideJobControl(paused.next!, envelope("resume", 3));
    expect(resumed).toMatchObject({ accepted: true, next: { controlState: "running", controlEpoch: 4 } });

    const cancelled = decideJobControl(state, envelope("cancel"));
    expect(cancelled).toMatchObject({ accepted: true, next: { controlState: "cancelled", controlEpoch: 3 } });
  });

  it("rejects stale versions and invalid lifecycle transitions without mutating state", () => {
    const stale = decideJobControl(state, envelope("pause", 1));
    expect(stale).toMatchObject({
      accepted: false,
      errorCode: "stale_control_epoch",
    });
    expect(stale).not.toHaveProperty("next");
    expect(decideJobControl({ ...state, status: "complete" }, envelope("cancel"))).toMatchObject({
      accepted: false,
      errorCode: "job_terminal",
    });
    expect(decideJobControl(state, envelope("resume"))).toMatchObject({
      accepted: false,
      errorCode: "job_not_paused",
    });
  });

  it("requires an exact job-scoped cancellation confirmation", () => {
    const command = createCommandEnvelope({
      commandId: "command-cancel-unconfirmed",
      jobId: "job-1",
      action: "cancel",
      expectedControlEpoch: 2,
      confirmation: "CANCEL another-job",
      actor,
      receivedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(decideJobControl(state, command)).toMatchObject({
      accepted: false,
      errorCode: "confirmation_required",
    });
  });

  it("binds the command digest to action, aggregate, version, and actor", () => {
    const original = envelope("pause");
    expect(original.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope("cancel").payloadDigest).not.toBe(original.payloadDigest);
    expect(createCommandEnvelope({
      commandId: original.commandId,
      jobId: "job-1",
      action: "pause",
      expectedControlEpoch: 2,
      actor: { ...actor, subjectId: "user-2" },
      receivedAt: original.receivedAt,
    }).payloadDigest).not.toBe(original.payloadDigest);
  });

  it("keeps semantic retries stable when server receipt time changes", () => {
    const original = envelope("pause");
    const retry = createCommandEnvelope({
      commandId: original.commandId,
      jobId: original.jobId,
      action: original.action,
      expectedControlEpoch: original.expectedControlEpoch,
      actor: original.actor,
      receivedAt: "2026-08-31T00:01:00.000Z",
    });
    expect(retry.payloadDigest).toBe(original.payloadDigest);
  });
});
