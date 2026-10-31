# Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize scheduled Harmonia content items into an app-created Google Calendar through explicit, verified, idempotent operator actions.

**Architecture:** Extend the existing workspace OAuth connection boundary with a narrow Google Calendar adapter. Keep event planning and state transitions pure; place network I/O behind an injected gateway; expose one tenant-authenticated route and explicit calendar UI controls.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Zod, Firestore, Google OAuth 2.0, Google Calendar API v3, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-google-calendar-sync-design.md`

## Global Constraints

- Request only `https://www.googleapis.com/auth/calendar.app.created`.
- Use only the official Google Calendar API; tokens remain server-side and workspace-scoped.
- Every Google event mutation requires an explicit operator request.
- Persist success only after independent API read-back verification.
- Retry transient failures only; never manufacture success.
- Do not claim live integration until a real authenticated sequence is captured privately.

---

### Task 1: Pure calendar contracts

**Files:**
- Create: `src/lib/calendarSyncState.ts`
- Create: `src/lib/googleCalendarContracts.ts`
- Test: `tests/googleCalendarContracts.test.ts`

**Interfaces:**
- Produces: `googleCalendarEventId(scopeKey, itemId)`, `buildGoogleCalendarEvent(item)`, `markCalendarSyncStale(item, patch)`, and shared sync schemas/types.

- [ ] Write failing tests with hand-derived assertions for valid deterministic IDs, 30-minute event projection, private identifiers, and stale transitions.
- [ ] Run `npm test -- --run tests/googleCalendarContracts.test.ts` and confirm failures are caused by missing modules.
- [ ] Implement the minimal pure functions and types.
- [ ] Re-run the test and confirm it passes.
- [ ] Commit with `git commit -m "feat: define Google Calendar sync contracts"`.

### Task 2: OAuth registration and token lifecycle

**Files:**
- Modify: `src/lib/platforms.ts`
- Modify: `src/lib/oauth.ts`
- Modify: `src/lib/firestore.ts`
- Test: `tests/googleCalendarOAuth.test.ts`

**Interfaces:**
- Consumes: existing `PlatformDef`, `ConnectionDoc`, `refreshAccessToken`.
- Produces: `google-calendar` registry entry and `getValidConnectionToken(platform, now, fetcher)` that persists rotated/refreshed tokens.

- [ ] Write failing tests proving the narrow scope, offline consent params, refresh-before-expiry behavior, and preservation of the original refresh token.
- [ ] Run `npm test -- --run tests/googleCalendarOAuth.test.ts` and observe the expected failures.
- [ ] Add the registry entry and minimal refresh/persistence helper without exposing credentials.
- [ ] Re-run the focused test and the existing OAuth/connection tests.
- [ ] Commit with `git commit -m "feat: connect Google Calendar with narrow OAuth"`.

### Task 3: Official Calendar gateway and verified orchestration

**Files:**
- Create: `src/lib/googleCalendar.ts`
- Test: `tests/googleCalendarSync.test.ts`

**Interfaces:**
- Consumes: `GoogleCalendarEventInput`, `GoogleCalendarSync`, valid access token.
- Produces: `GoogleCalendarGateway`, `ensureHarmoniaCalendar`, and `executeCalendarMutation(input, dependencies)` returning a verified sync projection.

- [ ] Write failing tests for first create, retry after ambiguous create, update of an existing deterministic event, idempotent removal, verification mismatch, `412` conflict, and transient retry limits.
- [ ] Run `npm test -- --run tests/googleCalendarSync.test.ts` and confirm the module is missing.
- [ ] Implement the fetch-based v3 gateway, app-calendar provisioning, retry classifier, and strict read-back verifier.
- [ ] Re-run the focused test until all cases pass, then refactor while green.
- [ ] Commit with `git commit -m "feat: verify idempotent Google Calendar effects"`.

### Task 4: Persistence and tenant-authenticated route

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/app/api/content-items/route.ts`
- Create: `src/app/api/calendar/google/route.ts`
- Test: `tests/googleCalendarRoute.test.ts`

**Interfaces:**
- Consumes: `executeCalendarMutation`, tenant-scoped content and connection stores.
- Produces: `GET /api/calendar/google` status and `POST /api/calendar/google` with `{ itemId, operation: "sync" | "remove" }`.

- [ ] Write failing route/service tests for disconnected, unscheduled, sync, remove, failure persistence, and stale marking after a content edit or reschedule.
- [ ] Run `npm test -- --run tests/googleCalendarRoute.test.ts` and observe expected failures.
- [ ] Implement schemas, storage fields, route orchestration, and stale transitions.
- [ ] Re-run focused tests plus content-item regression tests.
- [ ] Commit with `git commit -m "feat: approval-gate calendar synchronization"`.

### Task 5: Operator controls

**Files:**
- Modify: `src/components/CalendarView.tsx`
- Modify: `src/components/calendar/ItemDrawer.tsx`
- Modify: `src/components/SettingsView.tsx`
- Test: `tests/googleCalendarUi.test.ts`

**Interfaces:**
- Consumes: route status and `ContentItem.googleCalendarSync`.
- Produces: connection banner, explicit sync/update/remove controls, verified link, and visible failure state.

- [ ] Write failing rendering-contract tests for disconnected, synced, stale, and failed states.
- [ ] Run `npm test -- --run tests/googleCalendarUi.test.ts` and confirm the UI lacks these states.
- [ ] Add the minimal accessible controls and refresh behavior.
- [ ] Re-run the UI test and existing calendar/studio rendering tests.
- [ ] Commit with `git commit -m "feat: add Google Calendar sync controls"`.

### Task 6: Documentation and verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture.md` or the repository’s canonical architecture document discovered during implementation.
- Modify privately after merge: `../resources/gear-completion-audit-2026-08-25.md`

**Interfaces:**
- Produces: exact OAuth redirect/scopes/setup instructions and an honest live-verification boundary.

- [ ] Document Google Cloud OAuth/Calendar API setup, redirect URI, scope, disconnect behavior, and live verification commands.
- [ ] Run focused tests, full `npm test`, `npm run lint`, and `npm run build`.
- [ ] Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`; fix every material finding with a failing regression test first.
- [ ] Commit with `git commit -m "docs: explain verified Google Calendar sync"`.
- [ ] Fast-forward the reviewed branch into `main`, re-run verification on integrated state, and update the private audit without claiming live proof.
