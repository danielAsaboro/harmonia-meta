import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("public tool contract matrix", () => {
  const document = readFileSync(join(process.cwd(), "docs/tool-contracts.mdx"), "utf8");
  it.each([
    "fetch_trend_signals", "search_trend_signals", "get_engagement_insights",
    "get_operator_feed", "get_job_status", "suggest_posting_windows",
    "status", "data", "error", "evidence", "read-only", "MCP",
  ])("documents %s", (required) => expect(document).toContain(required));
});
