import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const cli = join(repoRoot, "scripts/verify-vertical-slice-evidence.ts");
const digest = "b".repeat(64);
const workflowTraceId = "a".repeat(32);
const approvalTraceId = "c".repeat(32);
const replayTraceId = "d".repeat(32);

function validBundle() {
  const stages = ["collect_sources", "extract_sources", "understand", "draft", "awaiting_approval", "publish", "verify"];
  return {
    schemaVersion: "harmonia.vertical-slice-evidence.v1", runId: "run-1", capturedAt: "2026-08-24T12:20:00.000Z",
    source: { kind: "source_manifest", manifestId: "manifest-1", sourceIds: ["video"], manifestDigest: digest },
    environment: {
      projectId: "project", location: "us-central1", webService: "web", webRevision: "web-r1",
      agentService: "agent", agentRevision: "agent-r1",
      agentEngineResource: "projects/123/locations/us-central1/reasoningEngines/456",
      firestoreDatabase: "projects/project/databases/(default)", pubsubTopic: "projects/project/topics/stages",
      mockAi: false, mockEffects: false, emulator: false,
    },
    job: { workspaceId: "ws", brandId: "brand", jobId: "job", createdAt: "2026-08-24T12:00:00.000Z", completedAt: "2026-08-24T12:18:00.000Z" },
    metrics: { sourceCount: 900, elapsedSec: 1080, handsOffProcessingSec: 1020, approvalWaitSec: 60, operatorActionCount: 1, outputCount: 3, approvedOutputCount: 1, verifiedOutputCount: 1 },
    events: stages.map((stage, index) => ({ eventId: `e-${index}`, stage, status: stage === "awaiting_approval" ? "waiting" : "completed", at: new Date(Date.parse("2026-08-24T12:01:00.000Z") + index * 60_000).toISOString(), operationId: `job:${stage}:0`, pubsubMessageId: `m-${index}`, traceId: index >= 5 ? approvalTraceId : workflowTraceId })),
    cognition: [{ role: "coordinator", model: "gemini-3.5-flash", provider: "gemini", policyVersion: "v1", usageRecordId: "u-1", operationId: "job:understand:coordinator", traceId: workflowTraceId }],
    approval: { approvalId: "approval", actionId: "action", decision: "approved", actorType: "firebase_operator", decidedAt: "2026-08-24T12:10:00.000Z", traceId: approvalTraceId },
    claim: { claimId: digest, actionId: "action", idempotencyKey: digest, state: "applied", receiptId: "receipt", attempt: 1, claimedAt: "2026-08-24T12:10:30.000Z", finalizedAt: "2026-08-24T12:11:30.000Z", operationId: "job:publish:action", traceId: approvalTraceId },
    effect: { actionId: "action", operationId: "job:publish:action", idempotencyKey: digest, receiptId: "receipt", kind: "export_content_artifact", outcome: "applied", executedAt: "2026-08-24T12:11:00.000Z", artifactDigest: digest, traceId: approvalTraceId },
    verification: { verificationId: "verification", receiptId: "receipt", operationId: "job:verify:action", method: "artifact_digest_reread", status: "verified", checkedAt: "2026-08-24T12:12:00.000Z", observedDigest: digest, traceId: approvalTraceId },
    replay: { operationId: "job:publish:action:replay", receiptId: "receipt", outcome: "already_applied", attemptedAt: "2026-08-24T12:13:00.000Z", traceId: replayTraceId },
    costs: { pricingVersion: "v1", currency: "USD", records: [{ usageRecordId: "u-1", operationId: "job:understand:coordinator", estimatedUsd: "0.010000", observedUsd: "0.009000" }], totalEstimatedUsd: "0.010000", totalObservedUsd: "0.009000" },
    evidenceFiles: [{ kind: "job_export", relativePath: "exports/job.json", sha256: digest }],
  };
}

function runCli(contents: string) {
  const directory = mkdtempSync(join(tmpdir(), "harmonia-evidence-cli-"));
  const path = join(directory, "bundle.json");
  writeFileSync(path, contents);
  return spawnSync(process.execPath, ["--import", "tsx", cli, path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("vertical-slice evidence CLI", () => {
  it("exits zero and emits a value-free JSON summary for valid evidence", () => {
    const result = runCli(JSON.stringify(validBundle()));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, failures: [] });
  });

  it("rejects malformed JSON without echoing its contents", () => {
    const result = runCli('{"token":"super-secret"');
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("super-secret");
    expect(JSON.parse(result.stdout).failures[0].code).toBe("invalid_json");
  });

  it.each(["token", "cookie", "transcript", "draftText", "authorizationHeader"])("rejects private key %s without leaking values", (key) => {
    const result = runCli(JSON.stringify({ ...validBundle(), [key]: "super-secret" }));
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("super-secret");
    expect(JSON.parse(result.stdout).failures).toContainEqual(expect.objectContaining({ code: "private_field" }));
  });

  it.each(["/tmp/private/job.json", "exports/../private.json"])("rejects unsafe evidence path %s", (relativePath) => {
    const bundle = validBundle();
    bundle.evidenceFiles[0].relativePath = relativePath;
    const result = runCli(JSON.stringify(bundle));
    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout).failures).toContainEqual(expect.objectContaining({ code: "unsafe_evidence_path" }));
  });

  it("is exposed through the package script", () => {
    const scripts = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], { cwd: repoRoot, encoding: "utf8" }));
    expect(scripts["verify:evidence"]).toBe("tsx scripts/verify-vertical-slice-evidence.ts");
  });
});
