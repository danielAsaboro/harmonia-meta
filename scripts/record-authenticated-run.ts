import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { recordAuthenticatedRun, validatePrivateReplayOutputPath, type AuthenticatedRunInput } from "../src/lib/recordReplay/recorder";

function argument(name: string): string { const index = process.argv.indexOf(name); const value = process.argv[index + 1]; if (index < 0 || !value) throw new Error(`missing ${name}`); return value; }
const inputPath = path.resolve(argument("--input"));
const outputPath = validatePrivateReplayOutputPath(process.cwd(), argument("--output"));
const input = JSON.parse(readFileSync(inputPath, "utf8")) as AuthenticatedRunInput;
const bundle = recordAuthenticatedRun(input);
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ bundleId: bundle.bundleId, digest: bundle.integrity.digest, scenario: bundle.scenario, outputPath })}\n`);
