import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The public /proof page reads committed, metadata-only evidence files.
  outputFileTracingIncludes: { "/proof": ["./evidence/**/*"], "/proof/runs/[bundleId]": ["./evidence/replays/*"], "/api/proof": ["./evidence/**/*"] },
  // The private parent workspace owns agent instructions. Do not generate
  // public-repo AGENTS.md/CLAUDE.md files during local development.
  agentRules: false,
  async rewrites() {
    return [{ source: "/.well-known/agent-card.json", destination: "/api/agent-card" }];
  },
};

export default nextConfig;
