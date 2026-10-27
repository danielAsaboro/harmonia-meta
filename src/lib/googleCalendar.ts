import type { ContentItem, GoogleCalendarSync } from "./types";
import { buildGoogleCalendarEvent, googleCalendarEventId, type GoogleCalendarEventInput } from "./googleCalendarContracts";

export interface GoogleEvent extends GoogleCalendarEventInput {
  etag: string;
  htmlLink?: string;
  status?: string;
}

export interface GoogleCalendarGateway {
  getCalendar(id: string): Promise<{ id: string; summary: string } | null>;
  createCalendar(summary: string): Promise<{ id: string; summary: string }>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent | null>;
  insertEvent(calendarId: string, event: GoogleCalendarEventInput): Promise<GoogleEvent>;
  updateEvent(calendarId: string, event: GoogleCalendarEventInput, etag: string): Promise<GoogleEvent>;
  deleteEvent(calendarId: string, eventId: string, etag?: string): Promise<void>;
}

export class CalendarApiError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Google Calendar API ${status}: ${detail}`);
    this.name = "CalendarApiError";
  }
}

export async function ensureHarmoniaCalendar(gateway: GoogleCalendarGateway, calendarId?: string) {
  if (calendarId) {
    const existing = await gateway.getCalendar(calendarId);
    if (existing) return existing;
    throw new Error("The Harmonia calendar was removed in Google Calendar; reconnect to provision a replacement safely");
  }
  return gateway.createCalendar("Harmonia Content Calendar");
}

function assertVerified(actual: GoogleEvent | null, expected: GoogleCalendarEventInput): asserts actual is GoogleEvent {
  const matches = actual && actual.id === expected.id && actual.summary === expected.summary &&
    actual.description === expected.description && actual.start?.dateTime === expected.start.dateTime &&
    actual.end?.dateTime === expected.end.dateTime && actual.transparency === expected.transparency &&
    JSON.stringify(actual.extendedProperties?.private) === JSON.stringify(expected.extendedProperties.private);
  if (!matches) throw new Error("Google Calendar read-back verification mismatch");
}

export async function executeCalendarMutation(
  input: { operation: "sync" | "remove"; item: ContentItem; workspaceId: string; brandId: string; calendarId: string; now: string },
  gateway: GoogleCalendarGateway,
): Promise<GoogleCalendarSync> {
  const eventId = googleCalendarEventId(`${input.workspaceId}:${input.brandId}`, input.item.id);
  const existing = await gateway.getEvent(input.calendarId, eventId);
  if (input.operation === "remove") {
    if (existing) await gateway.deleteEvent(input.calendarId, eventId, existing.etag);
    const after = await gateway.getEvent(input.calendarId, eventId);
    if (after) throw new Error("Google Calendar removal verification mismatch");
    return { status: "removed", calendarId: input.calendarId, eventId, sourceUpdatedAt: input.item.updatedAt, verifiedAt: input.now, lastAttemptAt: input.now };
  }

  const intended = buildGoogleCalendarEvent(input.item, eventId, input.workspaceId, input.brandId);
  if (existing) {
    try {
      await gateway.updateEvent(input.calendarId, intended, existing.etag);
    } catch (error) {
      if (!(error instanceof CalendarApiError) || error.status !== 412) throw error;
      // The first PUT may have committed while its response was lost. Strict
      // read-back below distinguishes convergence from a real conflict.
    }
  }
  else {
    try {
      await gateway.insertEvent(input.calendarId, intended);
    } catch (error) {
      if (!(error instanceof CalendarApiError) || error.status !== 409) throw error;
      // A deterministic insert may have succeeded even if its response was
      // lost. A 409 converges through the mandatory read-back below.
    }
  }
  const verified = await gateway.getEvent(input.calendarId, eventId);
  assertVerified(verified, intended);
  return { status: "synced", calendarId: input.calendarId, eventId, etag: verified.etag, htmlLink: verified.htmlLink, sourceUpdatedAt: input.item.updatedAt, verifiedAt: input.now, lastAttemptAt: input.now };
}

export class GoogleCalendarApi implements GoogleCalendarGateway {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleeper: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async request(path: string, init: RequestInit = {}, missingIsNull = false, retryable = true): Promise<Record<string, unknown> | null> {
    let res: Response | undefined;
    let networkError: unknown;
    const attempts = retryable ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        res = await this.fetcher(`https://www.googleapis.com/calendar/v3${path}`, {
          ...init,
          headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
          signal: init.signal ?? AbortSignal.timeout(20_000),
        });
        if (res.status !== 429 && res.status < 500) break;
      } catch (error) {
        networkError = error;
      }
      if (attempt < attempts - 1) await this.sleeper(200 * 2 ** attempt);
    }
    if (!res) throw networkError instanceof Error ? networkError : new Error("Google Calendar network request failed");
    if (missingIsNull && (res.status === 404 || res.status === 410)) return null;
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new CalendarApiError(res.status, detail);
    }
    if (res.status === 204) return {};
    return await res.json() as Record<string, unknown>;
  }

  async getCalendar(id: string) { return await this.request(`/calendars/${encodeURIComponent(id)}`, {}, true) as { id: string; summary: string } | null; }
  async createCalendar(summary: string) { return await this.request("/calendars", { method: "POST", body: JSON.stringify({ summary, description: "Content schedule synchronized by Harmonia." }) }, false, false) as { id: string; summary: string }; }
  async getEvent(calendarId: string, eventId: string) { return await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {}, true) as unknown as GoogleEvent | null; }
  async insertEvent(calendarId: string, event: GoogleCalendarEventInput) { return await this.request(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(event) }) as unknown as GoogleEvent; }
  async updateEvent(calendarId: string, event: GoogleCalendarEventInput, etag: string) { return await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${event.id}`, { method: "PUT", headers: { "if-match": etag }, body: JSON.stringify(event) }) as unknown as GoogleEvent; }
  async deleteEvent(calendarId: string, eventId: string, etag?: string) { await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: "DELETE", headers: etag ? { "if-match": etag } : {} }, true); }
}
