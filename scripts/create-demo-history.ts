import { pathToFileURL } from "node:url";

import {
  applyDemoHistory,
  discoverDemoHistory,
  verifyDemoHistory,
  type DemoHistoryInput,
  type DemoHistoryPlan,
} from "../src/lib/demoHistoryStore";

type DryRunArgs = { mode: "dry-run" } & DemoHistoryInput;
type ApplyArgs = { mode: "apply"; expectedDigest: string } & DemoHistoryInput;
type VerifyArgs = { mode: "verify"; manifestPath: string };
export type DemoHistoryArgs = DryRunArgs | ApplyArgs | VerifyArgs;

const VALUE_FLAGS = new Set([
  "--workspace",
  "--brand",
  "--dataset",
  "--anchor",
  "--expected-digest",
  "--manifest",
]);

function valuesFrom(argv: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag)) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (result.has(flag)) throw new Error(`${flag} may only be supplied once`);
    result.set(flag, value);
    index += 1;
  }
  return result;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

export function parseDemoHistoryArgs(argv: readonly string[]): DemoHistoryArgs {
  if (argv.includes("--cleanup")) throw new Error("cleanup is not implemented automatically");
  const modes = ["--dry-run", "--apply", "--verify"].filter((mode) => argv.includes(mode));
  if (modes.length !== 1) throw new Error("exactly one of --dry-run, --apply, or --verify is required");
  const unknown = argv.filter((value) => value.startsWith("--")
    && !VALUE_FLAGS.has(value)
    && !["--dry-run", "--apply", "--verify"].includes(value));
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
  const values = valuesFrom(argv);
  if (modes[0] === "--verify") {
    return { mode: "verify", manifestPath: required(values, "--manifest") };
  }
  const common: DemoHistoryInput = {
    workspaceId: required(values, "--workspace"),
    brandId: required(values, "--brand"),
    datasetId: required(values, "--dataset"),
    anchor: required(values, "--anchor"),
  };
  if (modes[0] === "--dry-run") return { mode: "dry-run", ...common };
  const expectedDigest = values.get("--expected-digest");
  if (!expectedDigest) throw new Error("--expected-digest is required for apply");
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error("--expected-digest must be a SHA-256 digest");
  return { mode: "apply", ...common, expectedDigest };
}

function summarizePlan(plan: DemoHistoryPlan) {
  const { records, ...summary } = plan;
  return {
    ...summary,
    destinations: records.map((record) => ({
      sourcePath: record.sourcePath,
      intendedDestinationPath: record.intendedDestinationPath,
      actualDestinationPath: record.actualDestinationPath,
      quarantined: record.quarantined,
      sourceDigest: record.sourceDigest,
      destinationDigest: record.destinationDigest,
    })),
  };
}

async function main(): Promise<void> {
  const args = parseDemoHistoryArgs(process.argv.slice(2));
  if (args.mode === "verify") {
    console.log(JSON.stringify(await verifyDemoHistory(args.manifestPath), null, 2));
    return;
  }
  const plan = await discoverDemoHistory(args);
  if (args.mode === "dry-run") {
    console.log(JSON.stringify(summarizePlan(plan), null, 2));
    return;
  }
  console.log(JSON.stringify(await applyDemoHistory(plan, args.expectedDigest), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
