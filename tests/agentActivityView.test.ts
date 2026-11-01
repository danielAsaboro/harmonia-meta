import { describe, expect, it } from "vitest";
import {
  buildActivityQuery,
  emptyActivityFilters,
  parseActivityFilters,
  resetPagination,
  type ActivityPagination,
} from "@/components/monitoring/AgentActivityView";

describe("agent activity view state", () => {
  it("serializes filters and current cursor into the API query", () => {
    const query = buildActivityQuery({
      ...emptyActivityFilters(), agent: "nova_liaison", types: ["trace"], q: "job-1",
    }, "cursor-2");
    expect(query.getAll("type")).toEqual(["trace"]);
    expect(query.get("agent")).toBe("nova_liaison");
    expect(query.get("cursor")).toBe("cursor-2");
  });

  it("resets cursor history when any filter changes", () => {
    const pagination: ActivityPagination = { cursor: "cursor-2", history: [null, "cursor-1"] };
    expect(resetPagination(pagination)).toEqual({ cursor: null, history: [] });
  });

  it("restores shareable filters from URL search parameters", () => {
    const filters = parseActivityFilters(new URLSearchParams("activity=1&type=trace&agent=ryan_strategist&q=job-1"));
    expect(filters).toMatchObject({ types: ["trace"], agent: "ryan_strategist", q: "job-1" });
  });
});
