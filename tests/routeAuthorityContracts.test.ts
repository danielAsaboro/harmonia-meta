import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const operatorMutationRoutes = [
  "src/app/api/chat/attachments/[id]/complete/route.ts",
  "src/app/api/chat/attachments/[id]/route.ts",
  "src/app/api/chat/attachments/session/route.ts",
  "src/app/api/chat/operations/[id]/decision/route.ts",
  "src/app/api/chat/route.ts",
  "src/app/api/chat/stream/route.ts",
  "src/app/api/content-items/[id]/approve/route.ts",
  "src/app/api/content-items/route.ts",
  "src/app/api/jobs/[id]/actions/[actionId]/decision/route.ts",
  "src/app/api/jobs/[id]/operations/[operationId]/resolve/route.ts",
  "src/app/api/jobs/route.ts",
  "src/app/api/notifications/route.ts",
  "src/app/api/proposals/decide/route.ts",
];

const administratorMutationRoutes = [
  "src/app/api/jobs/[id]/actions/[actionId]/replay/route.ts",
  "src/app/api/jobs/[id]/retry/route.ts",
  "src/app/api/oauth/[platform]/authorize/route.ts",
  "src/app/api/settings/connections/[platform]/route.ts",
  "src/app/api/settings/goals/route.ts",
  "src/app/api/settings/telegram/route.ts",
];

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("route authority contracts", () => {
  it("uses a browser operator boundary for content mutations", () => {
    for (const file of operatorMutationRoutes) {
      expect(source(file), file).not.toContain("tenantHandler(");
      expect(source(file), file).toContain("operatorTenantHandler(");
    }
  });

  it("uses an administrator boundary for credentials and control-plane mutations", () => {
    for (const file of administratorMutationRoutes) {
      expect(source(file), file).not.toContain("tenantHandler(");
      expect(source(file), file).toContain("administratorTenantHandler(");
    }
  });

  it("does not accept a caller-supplied approval actor", () => {
    const decisionRoute = source("src/app/api/jobs/[id]/actions/[actionId]/decision/route.ts");
    expect(decisionRoute).not.toMatch(/actor\s*:/);
    expect(decisionRoute).not.toContain("parsed.data.actor");
  });
});
