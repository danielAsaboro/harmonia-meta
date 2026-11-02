import { describe, expect, it } from "vitest";
import { CalendarApiError, executeCalendarMutation, GoogleCalendarApi, type GoogleCalendarGateway, type GoogleEvent } from "@/lib/googleCalendar";
import type { ContentItem } from "@/lib/types";

const item: ContentItem = { id: "i1", jobId: "j1", text: "Launch", platforms: ["x"], status: "scheduled", publishMode: "approval", scheduledFor: "2026-08-26T10:00:00.000Z", createdAt: "2026-08-25T09:00:00.000Z", updatedAt: "2026-08-25T09:30:00.000Z" };

function memoryGateway(existing?: GoogleEvent): { gateway: GoogleCalendarGateway; calls: string[] } {
  let event = existing;
  const calls: string[] = [];
  return { calls, gateway: {
    async getCalendar(id) { calls.push(`calendar:get:${id}`); return { id, summary: "Harmonia Content Calendar" }; },
    async createCalendar(summary) { calls.push("calendar:create"); return { id: "cal1", summary }; },
    async getEvent(_calendarId, id) { calls.push(`event:get:${id}`); return event?.id === id ? event : null; },
    async insertEvent(_calendarId, input) { calls.push("event:insert"); event = { ...input, etag: "v1", htmlLink: "https://calendar.google/e/i1", status: "confirmed" }; return event; },
    async updateEvent(_calendarId, input, etag) { calls.push(`event:update:${etag}`); event = { ...input, etag: "v2", htmlLink: "https://calendar.google/e/i1", status: "confirmed" }; return event; },
    async deleteEvent() { calls.push("event:delete"); event = undefined; },
  } };
}

describe("verified Google Calendar effects", () => {
  it("creates and reads back a deterministic event", async () => {
    const { gateway, calls } = memoryGateway();
    const result = await executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, gateway);
    expect(result.status).toBe("synced");
    expect(result.calendarId).toBe("cal1");
    expect(result.etag).toBe("v1");
    expect(calls.filter((call) => call.startsWith("event:get"))).toHaveLength(2);
    expect(calls).toContain("event:insert");
  });

  it("updates an existing event with its current etag", async () => {
    const seed = memoryGateway();
    const first = await executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, seed.gateway);
    const second = await executeCalendarMutation({ operation: "sync", item: { ...item, text: "Updated" }, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:05:00.000Z" }, seed.gateway);
    expect(first.eventId).toBe(second.eventId);
    expect(second.etag).toBe("v2");
    expect(seed.calls).toContain("event:update:v1");
  });

  it("removes idempotently and verifies absence", async () => {
    const seed = memoryGateway();
    await executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, seed.gateway);
    const removed = await executeCalendarMutation({ operation: "remove", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:05:00.000Z" }, seed.gateway);
    const again = await executeCalendarMutation({ operation: "remove", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:06:00.000Z" }, seed.gateway);
    expect(removed.status).toBe("removed");
    expect(again.status).toBe("removed");
    expect(seed.calls.filter((call) => call === "event:delete")).toHaveLength(1);
  });

  it("rejects a read-back that does not match the intended event", async () => {
    const { gateway } = memoryGateway();
    const originalGet = gateway.getEvent;
    let reads = 0;
    gateway.getEvent = async (...args) => {
      const found = await originalGet(...args); reads += 1;
      return reads > 1 && found ? { ...found, summary: "Tampered" } : found;
    };
    await expect(executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, gateway)).rejects.toThrow("verification mismatch");
  });

  it("retries a transient Calendar API response", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls === 1
        ? new Response("busy", { status: 503 })
        : Response.json({ id: "event1", etag: "v1", summary: "ok" });
    };
    const api = new GoogleCalendarApi("token", fetcher as typeof fetch, async () => {});
    expect((await api.getEvent("cal", "event1"))?.id).toBe("event1");
    expect(calls).toBe(2);
  });

  it("converges after an ambiguous insert reports that the deterministic id exists", async () => {
    const { gateway } = memoryGateway();
    const realInsert = gateway.insertEvent;
    gateway.insertEvent = async (...args) => {
      await realInsert(...args);
      throw new CalendarApiError(409, "already exists");
    };
    const result = await executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, gateway);
    expect(result.status).toBe("synced");
    expect(result.etag).toBe("v1");
  });

  it("converges an ambiguous etag conflict only when read-back matches", async () => {
    const seed = memoryGateway();
    await executeCalendarMutation({ operation: "sync", item, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:00:00.000Z" }, seed.gateway);
    const realUpdate = seed.gateway.updateEvent;
    seed.gateway.updateEvent = async (...args) => {
      await realUpdate(...args);
      throw new CalendarApiError(412, "precondition failed");
    };
    const result = await executeCalendarMutation({ operation: "sync", item: { ...item, text: "new" }, workspaceId: "w", brandId: "b", calendarId: "cal1", now: "2026-08-25T10:01:00.000Z" }, seed.gateway);
    expect(result.status).toBe("synced");
    expect(result.etag).toBe("v2");
  });
});
