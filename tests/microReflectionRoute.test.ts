import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/internal/autonomy/observe/route";

describe("internal micro-reflection route", () => {
  it("rejects callers without internal service authentication before parsing evidence", async () => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    const response = await POST(new Request("http://localhost/api/internal/autonomy/observe", { method: "POST", body: JSON.stringify({ rawPrompt: "must not parse" }) }));
    expect(response.status).toBe(401);
  });
});
