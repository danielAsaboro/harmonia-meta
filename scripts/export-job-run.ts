import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getJob, listEvents, listReceipts, listUsageRecords } from "../src/lib/firestore";
import { jobObservations } from "../src/lib/recordReplay/jobExport";
import { recordAuthenticatedRun, validatePrivateReplayOutputPath } from "../src/lib/recordReplay/recorder";
import { replayScenarioSchema } from "../src/lib/recordReplay/schema";
import { servicePrincipal } from "../src/lib/authority";
import { runWithTenant } from "../src/lib/tenancy";

// Export one persisted job as a signed private_candidate replay bundle.
//   npx tsx scripts/export-job-run.ts --job <id> --workspace <id> --brand <id> --output ../private/run.json [--scenario success] [--authorize-source]
// Firestore comes from the environment: FIRESTORE_EMULATOR_HOST selects the
// local emulator and labels the bundle local_emulator. Review the candidate,
// then publish with scripts/approve-replay.ts.

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const jobId = option("--job");
const output = option("--output");
if (!jobId || !output) throw new Error("usage: --job <id> --output <private path outside the repo>");
const outputPath = validatePrivateReplayOutputPath(process.cwd(), path.resolve(output));
const scenario = replayScenarioSchema.parse(option("--scenario") ?? "success");

async function main(jobId: string) {
  const job = await getJob(jobId);
  const [events, usage, receipts] = await Promise.all([listEvents(jobId, 1000), listUsageRecords(jobId), listReceipts(jobId)]);
  const observations = jobObservations({ job: job as Parameters<typeof jobObservations>[0]["job"], events, usage, receipts });
  const bundle = recordAuthenticatedRun({
    bundleId: `${jobId}-${Date.now()}`,
    scenario,
    sourceRunId: jobId,
    sourceJobId: jobId,
    capturedAt: observations[0]?.capturedAt ?? new Date().toISOString(),
    captureEndedAt: observations.at(-1)?.capturedAt ?? new Date().toISOString(),
    sourceCaptureAuthorized: process.argv.includes("--authorize-source"),
    environment: process.env.FIRESTORE_EMULATOR_HOST ? "local_emulator" : "authenticated_cloud",
    observations: process.argv.includes("--authorize-source")
      ? observations
      : observations.filter((item) => item.kind !== "draft" && item.kind !== "transcript_segment"),
  });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ bundleId: bundle.bundleId, events: bundle.events.length, environment: bundle.provenance.environment, outputPath })}\n`);
}

const workspaceId = option("--workspace");
const brandId = option("--brand");
if (!workspaceId || !brandId) throw new Error("--workspace and --brand are required");
void runWithTenant({ workspaceId, brandId, principal: servicePrincipal("replay-export") }, () => main(jobId));
