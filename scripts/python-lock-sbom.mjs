import { readFileSync } from "node:fs";

const lockPath = process.argv[2];
if (!lockPath) throw new Error("usage: node scripts/python-lock-sbom.mjs <requirements.lock>");
const components = readFileSync(lockPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const [name, version] = line.split("==");
    if (!name || !version) throw new Error(`unlocked Python requirement: ${line}`);
    return { type: "library", name, version, purl: `pkg:pypi/${name.toLowerCase()}@${version}` };
  });

process.stdout.write(`${JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: { component: { type: "application", name: "harmonia-agent" } },
  components,
}, null, 2)}\n`);
