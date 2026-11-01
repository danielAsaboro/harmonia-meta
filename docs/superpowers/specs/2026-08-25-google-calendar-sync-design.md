# Google Calendar Sync Design

## Outcome

Harmonia’s internal content calendar synchronizes scheduled content items into a dedicated Google Calendar owned by the connected operator. The feature uses the official Google Calendar API, server-side OAuth tokens, explicit operator actions for every external mutation, deterministic event identity, and API read-back before Harmonia calls a sync successful.

## Permission model

Harmonia requests only `https://www.googleapis.com/auth/calendar.app.created`. On first sync after OAuth, Harmonia creates a secondary calendar named `Harmonia Content Calendar`. This scope limits the app to calendars it created; it does not expose the operator’s unrelated calendars or events.

The existing Google OAuth application credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are deployment-wide. Access and refresh tokens remain in the workspace-scoped Firestore connection document. The browser never receives either token.

## Operator experience

The calendar page shows whether Google Calendar is connected and links to the existing OAuth flow when it is not. A scheduled item drawer shows its Google sync state and provides one explicit action:

- `Add to Google Calendar` when no verified event exists.
- `Update Google Calendar` when the Harmonia item changed after its last verified sync.
- `Remove from Google Calendar` when a verified event exists.

Scheduling or editing a Harmonia item never silently mutates Google Calendar. It marks a previously synced item as needing an update. Removing an event never cancels or deletes the Harmonia content item.

## Calendar and event representation

The connection document records the app-created `calendarId`, calendar title, and provisioning timestamp. Provisioning is idempotent: after the ID is saved, Harmonia reads that calendar rather than creating another one.

Each content item stores a `googleCalendarSync` projection containing:

- `calendarId` and deterministic `eventId`
- Google `etag` and `htmlLink`
- `sourceUpdatedAt`, the Harmonia revision that was synced
- `status`: `synced`, `update_required`, `removed`, or `failed`
- `verifiedAt`, `lastAttemptAt`, and a sanitized `failureReason` when applicable

The event ID is a stable base32hex-compatible digest of the workspace, brand, and content-item ID. The event is a 30-minute transparent event starting at `scheduledFor`, titled with the target platforms, and described with the draft text plus Harmonia item/job identifiers in private extended properties. Stable identity makes a retry converge on the same Google resource.

## Mutation protocol

The sync route accepts `sync` or `remove` plus the content-item ID. It authenticates the tenant and requires the item to be scheduled for `sync`. The route loads a valid Google Calendar token, refreshing it when needed, and provisions the app-created calendar if necessary.

For `sync`, Harmonia first performs `events.get` using the deterministic event ID. A missing event is inserted; an existing event is replaced with `events.update`, guarded by its latest ETag. Harmonia then performs another `events.get` and compares the event ID, start, end, summary, description, and private extended properties with the intended representation. Only that verified result is persisted as `synced`.

For `remove`, Harmonia deletes the deterministic event if it exists, then verifies that `events.get` returns `404` or `410`. Only then is the item persisted as `removed`. Repeated removal is a successful no-op with a fresh verification timestamp.

The route retries only transient network, `429`, and `5xx` failures with bounded backoff. Authorization, validation, conflict, and permission failures are terminal and visible. No error is converted into success.

## State changes inside Harmonia

When text, schedule, platforms, status, or cancellation changes after a verified sync, the content-item update path changes `googleCalendarSync.status` to `update_required` while preserving the external identifiers and last verification evidence. Published items retain the link and last verified state; their immutability remains unchanged.

Disconnecting Google Calendar deletes only Harmonia’s stored connection credentials. It does not delete the app-created calendar or its events, avoiding a destructive side effect during credential revocation.

## Components

- `src/lib/googleCalendar.ts`: event projection, deterministic ID, official API client, refresh, provisioning, retries, and read-back verification.
- `src/lib/calendarSyncState.ts`: pure sync-state transitions used by content-item updates and UI responses.
- `src/app/api/calendar/google/route.ts`: tenant-authenticated status and mutation endpoint.
- Existing OAuth/platform registry: adds `google-calendar` with the narrow app-created scope.
- Existing Firestore types and connection/content-item documents: persist calendar metadata and verification state.
- Calendar page and item drawer: connection banner, explicit mutation buttons, status, link, and errors.

## Test strategy

Unit tests cover deterministic valid IDs, event projection, stale-state transitions, retry classification, create/update/remove idempotency, token refresh, and strict read-back comparisons. Route tests exercise authorization-independent handler logic through injected stores and an injected Calendar gateway; only the external HTTP boundary is replaced. UI behavior is covered through server-rendered contract tests consistent with the existing suite.

Offline tests prove the implementation contract, not a live account connection. Production readiness remains unverified until an operator completes OAuth and a real event create/update/remove sequence is captured outside the public repository.

## Deliberate exclusions

Harmonia does not read the operator’s primary calendar, inspect personal event titles, invite attendees, add conferencing, create recurring events, or automatically delete external events. Free/busy conflict detection is excluded because it requires an additional permission unrelated to reliable content-calendar synchronization.
