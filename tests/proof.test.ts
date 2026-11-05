import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signReplayBundle } from "@/lib/recordReplay/integrity";
import { digestReplayState, reduceReplayState } from "@/lib/recordReplay/state";
import type { UnsignedReplayBundle } from "@/lib/recordReplay/schema";
import { concurrentGroups, loadBrandBrief, loadNarratedVideo, loadProbeReport, loadPublicRuns, loadScreenEval, type RunSummary } from "@/lib/proof";

const at = (ms: number) => new Date(Date.UTC(2026, 10, 4, 12, 0, 0, ms)).toISOString();

function bundle(release: "private_candidate" | "approved_public_bundle", bundleId: string) {
  const events = [
    { kind: "stage_transition", payload: { jobId: "j", stage: "understand", status: "running" } },
    { kind: "specialist_handoff", payload: { jobId: "j", from: "nimi_analyst", to: "ryan_strategist", summary: "3 grounded moments" } },
    { kind: "moment", payload: { jobId: "j", momentId: "m1", title: "Nine days to forty hours", startSec: 12, endSec: 19.5 } },
    { kind: "usage", payload: { jobId: "j", model: "muse-spark-1.3", inputTokens: 1200, outputTokens: 300, estimatedCostUsd: 0.00278 } },
    { kind: "usage", payload: { jobId: "j", model: "muse-wonder-1.0", inputTokens: 5000, outputTokens: 2000, estimatedCostUsd: 0.06 } },
    { kind: "usage", payload: { jobId: "j", model: "muse-spark-1.3", inputTokens: 800, outputTokens: 100, estimatedCostUsd: 0.001425 } },
    { kind: "draft", payload: { jobId: "j", draftId: "d1", platform: "x", text: "Activation took nine days. Now it takes forty hours.", valid: true } },
    { kind: "approval", payload: { jobId: "j", actionId: "a1", decision: "approved" } },
    { kind: "stage_transition", payload: { jobId: "j", stage: "complete", status: "complete" } },
  ].map((event, sequence) => ({ ...event, sequence, capturedAt: at(sequence * 100), offsetMs: sequence * 100 }));
  return signReplayBundle({
    schema: "harmonia.authenticated-replay", schemaVersion: "1.0.0", bundleId, executionMode: "recorded_replay",
    evidenceClassification: "historical_replay", scenario: "awaiting_approval", capturedAt: at(0), captureEndedAt: at(900), release,
    provenance: { sourceRunId: "run-1", sourceJobId: "j", environment: "authenticated_cloud", sanitizerVersion: "1.0.0", sourceCaptureAuthorized: true },
    events, terminalStateDigest: digestReplayState(reduceReplayState(events as never)),
  } as UnsignedReplayBundle);
}

function evidenceDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "harmonia-proof-"));
  mkdirSync(path.join(dir, "replays"));
  process.env.HARMONIA_EVIDENCE_DIR = dir;
  return dir;
}

afterEach(() => { delete process.env.HARMONIA_EVIDENCE_DIR; });

describe("public proof", () => {
  it("shows only approved, untampered bundles and totals their cost by model", async () => {
    const dir = evidenceDir();
    writeFileSync(path.join(dir, "replays", "a.json"), JSON.stringify(bundle("approved_public_bundle", "public-1")));
    writeFileSync(path.join(dir, "replays", "b.json"), JSON.stringify(bundle("private_candidate", "private-1")));
    const tampered = bundle("approved_public_bundle", "public-2");
    (tampered.events[6].payload as { text: string }).text = "Edited after capture.";
    writeFileSync(path.join(dir, "replays", "c.json"), JSON.stringify(tampered));

    const { runs, rejected } = await loadPublicRuns();

    expect(runs.map((run) => run.bundleId)).toEqual(["public-1"]);
    expect(rejected.map((item) => item.file)).toEqual(["b.json", "c.json"]);
    expect(rejected[0].reason).toContain("not approved for public release");
    expect(rejected[1].reason).toContain("integrity");
    const [run] = runs;
    expect(run.stages).toEqual(["understand", "complete"]);
    expect(run.handoffs[0]).toMatchObject({ from: "nimi_analyst", to: "ryan_strategist" });
    expect(run.cost).toEqual([
      { model: "muse-wonder-1.0", inputTokens: 5000, outputTokens: 2000, usd: 0.06 },
      { model: "muse-spark-1.3", inputTokens: 2000, outputTokens: 400, usd: 0.00278 + 0.001425 },
    ]);
    expect(run.totalUsd).toBeCloseTo(0.064205, 6);
  });

  it("reports missing evidence instead of filling it in", async () => {
    evidenceDir();
    expect(await loadProbeReport()).toEqual({ state: "missing", reason: "No live probe report has been committed yet." });
    expect(await loadPublicRuns()).toEqual({ runs: [], rejected: [] });
  });

  it("reads a committed probe report", async () => {
    const dir = evidenceDir();
    writeFileSync(path.join(dir, "meta-probe.json"), JSON.stringify({
      probe: "harmonia-meta-models", ranAt: "2026-11-04T12:00:00+00:00", baseUrl: "https://api.meta.ai/v1", passed: true,
      checks: [{ check: "responses", model: "muse-wonder-1.0", ok: true, httpStatus: 200, latencyMs: 812, requestId: "req-1", usage: { input_tokens: 31 } }],
    }));
    const loaded = await loadProbeReport();
    expect(loaded.state).toBe("ok");
    if (loaded.state === "ok") expect(loaded.value.checks[0].requestId).toBe("req-1");
  });

  it("reads the committed source-screen eval", async () => {
    const dir = evidenceDir();
    writeFileSync(path.join(dir, "source-screen-eval.json"), readFileSync(path.join(process.cwd(), "evidence", "source-screen-eval.json")));
    const loaded = await loadScreenEval();
    expect(loaded.state).toBe("ok");
    if (loaded.state === "ok" && loaded.value.glimmer.state === "ran" && "combined" in loaded.value.glimmer) {
      expect(loaded.value.glimmer.combined.wronglyWithheld).toEqual([]);
      expect(loaded.value.rules.caught).toBeLessThanOrEqual(loaded.value.glimmer.combined.caught);
    }
  });

  it("shows the committed website brand brief with its Meta response ids and list-price receipt", async () => {
    const dir = evidenceDir();
    mkdirSync(path.join(dir, "onboarding"));
    for (const name of ["cal.com-2026-11-04.json", "cal.com-2026-11-04.receipt.json"]) {
      writeFileSync(path.join(dir, "onboarding", name), readFileSync(path.join(process.cwd(), "evidence", "onboarding", name)));
    }
    const loaded = await loadBrandBrief();
    expect(loaded.state).toBe("ok");
    if (loaded.state !== "ok") return;
    expect(loaded.value.modelCalls.map((call) => call.model)).toContain("muse-wonder-1.0");
    expect(loaded.value.modelCalls.every((call) => call.responseId.startsWith("resp_"))).toBe(true);
    expect(loaded.value.receipt?.calls.map((call) => call.step)).toEqual(loaded.value.modelCalls.map((call) => call.step));
    const sum = loaded.value.receipt?.calls.reduce((total, call) => total + call.costUsd, 0) ?? 0;
    expect(loaded.value.receipt?.totalUsd).toBeCloseTo(sum, 6);
    expect(loaded.value.research.painSignals.every((signal) => signal.url.startsWith("https://"))).toBe(true);
  });

  it("shows the committed narrated video and its listen-back check", async () => {
    const dir = evidenceDir();
    mkdirSync(path.join(dir, "media"));
    writeFileSync(path.join(dir, "media", "harmonia-demo.json"), readFileSync(path.join(process.cwd(), "evidence", "media", "harmonia-demo.json")));
    const loaded = await loadNarratedVideo();
    expect(loaded.state).toBe("ok");
    if (loaded.state !== "ok") return;
    expect(loaded.value.narrationCheck.passed).toBe(true);
    expect(loaded.value.imageModel).toBe("muse-image-1.0");
    expect(loaded.value.videoUrl).toBe("/media/harmonia-narrated-demo.mp4");
    // The served copy must be the committed evidence file, byte for byte.
    expect(readFileSync(path.join(process.cwd(), "public", "media", "harmonia-narrated-demo.mp4")).equals(readFileSync(path.join(process.cwd(), "evidence", "media", "harmonia-demo.mp4")))).toBe(true);
  });

  it("reports a missing brief and video as missing", async () => {
    evidenceDir();
    expect((await loadBrandBrief()).state).toBe("missing");
    expect((await loadNarratedVideo()).state).toBe("missing");
  });

  it("groups runs whose captures overlap in time", () => {
    const run = (bundleId: string, capturedAt: string, durationMs: number) => ({ bundleId, capturedAt, durationMs }) as RunSummary;
    expect(concurrentGroups([
      run("a", "2026-11-04T15:02:41Z", 1_340_000), run("b", "2026-11-04T15:02:43Z", 1_340_000), run("c", "2026-11-04T15:02:46Z", 1_336_000),
      run("d", "2026-11-04T15:38:17Z", 407_000), run("e", "2026-11-04T14:51:17Z", 150_000),
    ])).toEqual([["a", "b", "c"]]);
  });
});
