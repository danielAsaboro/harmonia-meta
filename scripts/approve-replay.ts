import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importReplayBundle } from "../src/lib/recordReplay/importer";
import { signReplayBundle } from "../src/lib/recordReplay/integrity";

// Release a reviewed private candidate for the public /proof page:
//   npx tsx scripts/approve-replay.ts --input ../private/run.json
// This is the explicit human decision the replay contract requires; it
// re-verifies the candidate, flips release, re-signs, and writes evidence/replays/.

const index = process.argv.indexOf("--input");
const input = index >= 0 ? process.argv[index + 1] : undefined;
if (!input) throw new Error("usage: --input <reviewed private candidate>");
const candidate = importReplayBundle(readFileSync(path.resolve(input), "utf8"), { destination: "private" });
const { integrity: _integrity, ...unsigned } = candidate;
const released = signReplayBundle({ ...unsigned, release: "approved_public_bundle" });
importReplayBundle(released, { destination: "public" });
const target = path.join(process.cwd(), "evidence", "replays", `${released.bundleId}.json`);
writeFileSync(target, `${JSON.stringify(released, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ bundleId: released.bundleId, digest: released.integrity.digest, target })}\n`);
