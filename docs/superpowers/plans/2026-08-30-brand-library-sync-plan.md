# Brand Library Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not permitted for this side-conversation execution.

**Goal:** Let each brand connect one or more Google Drive folders or GCS prefixes, synchronize them on a configurable schedule, and expose immutable healthy snapshots for job manifests.

**Architecture:** Provider connections remain workspace/brand scoped and credential references stay server-side. A common library repository stores connections, sync operations, file versions, immutable snapshots, and last-healthy pointers. Scheduler-triggered sync performs incremental enumeration, extraction through Plan 1's registry, and atomic snapshot promotion.

**Tech Stack:** Next.js, Firestore, Cloud Scheduler, Google Drive REST API, Google Picker, `@google-cloud/storage`, Secret Manager/encrypted connection boundary, Vitest, Firestore emulator.

**Spec:** `docs/superpowers/specs/2026-08-30-multisource-content-operations-design.md`

## Global Constraints

- Users select Drive folders and GCS prefixes through authenticated UI controls; they do not paste storage paths.
- Supported cadences are hourly, every six hours, daily, and paused; default is every six hours.
- A failed sync never replaces the last healthy snapshot.
- Jobs pin exactly one snapshot and never switch snapshots mid-run.
- Provider credentials never appear in browser-readable job or source records.

---

### Task 1: Library connection, sync, and snapshot contracts

**Files:**
- Create: `src/lib/brandLibraries/contracts.ts`
- Create: `src/lib/brandLibraries/repository.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `firestore.indexes.json`
- Test: `tests/brandLibraryContracts.test.ts`
- Test: `tests/brandLibraryFirestore.integration.test.ts`

**Interfaces:**
- Produces: `BrandLibraryConnection`, `LibrarySyncOperation`, `BrandLibrarySnapshot`, `LibraryFileVersion`, `SyncCadence`.
- Produces: `createLibraryConnection`, `beginLibrarySync`, `recordLibraryFileVersion`, `promoteHealthySnapshot`, `failLibrarySync`, `latestHealthySnapshot`.

- [ ] **Step 1: Write failing contract tests**

```ts
it.each(["hourly", "six_hours", "daily", "paused"])("accepts cadence %s", (cadence) => {
  expect(brandLibraryConnectionSchema.parse(validConnection({ cadence })).cadence).toBe(cadence);
});

it("defaults new connections to six-hour sync", () => {
  expect(brandLibraryConnectionSchema.parse(validConnection({ cadence: undefined })).cadence).toBe("six_hours");
});
```

- [ ] **Step 2: Run contract tests and verify RED**

Run: `npm test -- tests/brandLibraryContracts.test.ts`  
Expected: FAIL because contracts do not exist.

- [ ] **Step 3: Implement strict contracts**

Use provider-specific selectors: `{provider:"google_drive", driveId, folderId}` and `{provider:"gcs", projectId, bucket, prefix}`. Store only credential reference IDs.

- [ ] **Step 4: Write failing Firestore tests**

Cover cross-tenant denial, concurrent sync claims, immutable snapshots, failed-sync preservation, healthy promotion, and revoked connection behavior.

- [ ] **Step 5: Implement repository transactions and indexes**

Promote `currentHealthySnapshotId` only in the transaction that finalizes a healthy sync. Never overwrite previous snapshot documents.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `npm test -- tests/brandLibraryContracts.test.ts && npm run test:integration`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brandLibraries src/lib/types.ts src/lib/contracts.ts firestore.indexes.json tests/brandLibraryContracts.test.ts tests/brandLibraryFirestore.integration.test.ts
git commit -m "feat: add brand library persistence"
```

### Task 2: Google Drive authorization, folder selection, and incremental enumeration

**Files:**
- Create: `src/lib/brandLibraries/googleDrive.ts`
- Create: `src/app/api/settings/libraries/google-drive/authorize/route.ts`
- Create: `src/app/api/settings/libraries/google-drive/callback/route.ts`
- Create: `src/app/api/settings/libraries/google-drive/folders/route.ts`
- Create: `src/app/api/internal/libraries/google-drive/changes/route.ts`
- Modify: `src/lib/oauth.ts`
- Modify: `src/lib/platforms.ts`
- Test: `tests/googleDriveLibrary.test.ts`
- Test: `tests/googleDriveLibraryRoutes.test.ts`

**Interfaces:**
- Produces: OAuth connection with the minimum scope that permits selected folder reads.
- Produces: `listDriveFolders(parentId?)`, `listDriveFolderFiles(folderId, pageToken?)`, `listDriveChanges(changeToken)`.

- [ ] **Step 1: Write failing OAuth and folder authority tests**

Assert state binding, workspace/brand scope, redirect-origin checks, token encryption, folder-only selection, Shared Drive flags, revoked-token failure, and no token values in responses.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/googleDriveLibrary.test.ts tests/googleDriveLibraryRoutes.test.ts`  
Expected: FAIL because Drive library routes do not exist.

- [ ] **Step 3: Implement Drive REST client and OAuth routes**

Use the existing encrypted connection boundary. Request only the scope required for selected existing files. Call Drive with `supportsAllDrives=true` and `includeItemsFromAllDrives=true` where relevant. Return bounded folder/file metadata.

- [ ] **Step 4: Implement incremental change enumeration**

Persist the provider change token only after a successful sync finalization. Pin each file by Drive file ID plus revision/version metadata and content digest.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run: `npm test -- tests/googleDriveLibrary.test.ts tests/googleDriveLibraryRoutes.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/brandLibraries/googleDrive.ts src/app/api/settings/libraries/google-drive src/app/api/internal/libraries/google-drive src/lib/oauth.ts src/lib/platforms.ts tests/googleDriveLibrary.test.ts tests/googleDriveLibraryRoutes.test.ts
git commit -m "feat: connect Google Drive brand folders"
```

### Task 3: GCS project, bucket, and prefix selection

**Files:**
- Create: `src/lib/brandLibraries/gcs.ts`
- Create: `src/app/api/settings/libraries/gcs/projects/route.ts`
- Create: `src/app/api/settings/libraries/gcs/buckets/route.ts`
- Create: `src/app/api/settings/libraries/gcs/prefixes/route.ts`
- Create: `src/app/api/internal/libraries/gcs/objects/route.ts`
- Test: `tests/gcsLibrary.test.ts`
- Test: `tests/gcsLibraryRoutes.test.ts`

**Interfaces:**
- Produces: `listAuthorizedProjects()`, `listAuthorizedBuckets(projectId)`, `listPrefixes(bucket, prefix)`, `listPinnedObjects(bucket, prefix, pageToken?)`.
- Consumes: explicit service-account or workload-identity permissions; never arbitrary public bucket scraping.

- [ ] **Step 1: Write failing GCS selection tests**

Assert project allow-listing, exact bucket authorization, prefix normalization, path traversal rejection, generation pinning, pagination, unsupported-object exclusion, and no object bytes in selector responses.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/gcsLibrary.test.ts tests/gcsLibraryRoutes.test.ts`  
Expected: FAIL because GCS library selectors do not exist.

- [ ] **Step 3: Implement GCS selector and enumeration service**

Use `@google-cloud/storage`. Present delimiter-separated prefixes as folders. Every selected object version includes bucket, name, generation, size, MIME, checksum, and updated time.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- tests/gcsLibrary.test.ts tests/gcsLibraryRoutes.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brandLibraries/gcs.ts src/app/api/settings/libraries/gcs src/app/api/internal/libraries/gcs tests/gcsLibrary.test.ts tests/gcsLibraryRoutes.test.ts
git commit -m "feat: select GCS brand folders"
```

### Task 4: Scheduled incremental sync and immutable snapshot promotion

**Files:**
- Create: `src/lib/brandLibraries/sync.ts`
- Create: `src/app/api/internal/libraries/sync/route.ts`
- Modify: `agent/harmonia_agent/durable_tick.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `infra/setup.sh`
- Modify: `infra/deploy.sh`
- Test: `tests/brandLibrarySync.test.ts`
- Test: `tests/brandLibrarySyncFirestore.integration.test.ts`
- Test: `agent/tests/test_library_sync_tick.py`
- Test: `tests/brandLibraryInfra.test.ts`

**Interfaces:**
- Produces: `runLibrarySync(connectionId, expectedRevision)` and Scheduler-driven due-sync dispatch.
- Consumes: source registry/extractors from Plan 1 and provider enumeration from Tasks 2–3.

- [ ] **Step 1: Write failing sync state tests**

Assert unchanged files reuse source versions; changed provider versions re-extract; deletions disappear from the next snapshot; failures retain prior healthy snapshot; cost/policy breach fails closed; successful sync promotes exactly one immutable snapshot.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/brandLibrarySync.test.ts`  
Expected: FAIL because sync orchestration does not exist.

- [ ] **Step 3: Implement sync orchestration**

Enumerate incrementally, create or reuse source records, dispatch extraction in bounded batches, finalize only after all permitted files reach terminal states, and write a sync receipt.

- [ ] **Step 4: Write failing Scheduler and durable-tick tests**

Assert cadence calculation, paused exclusion, one active sync per connection, OIDC-protected endpoint, retry behavior, regional Scheduler configuration, and telemetry correlation.

- [ ] **Step 5: Implement Scheduler and durable tick integration**

Use one regional Scheduler wakeup that asks the durable tick to claim due connections; do not create one Scheduler job per brand.

- [ ] **Step 6: Run sync, integration, tick, and infra tests**

Run: `npm test -- tests/brandLibrarySync.test.ts tests/brandLibraryInfra.test.ts && npm run test:integration && cd agent && ./.venv/bin/python -m pytest tests/test_library_sync_tick.py -q`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brandLibraries/sync.ts src/app/api/internal/libraries/sync agent/harmonia_agent/durable_tick.py agent/harmonia_agent/web_client.py infra/setup.sh infra/deploy.sh tests/brandLibrarySync.test.ts tests/brandLibrarySyncFirestore.integration.test.ts agent/tests/test_library_sync_tick.py tests/brandLibraryInfra.test.ts
git commit -m "feat: synchronize brand libraries"
```

### Task 5: Settings connection and snapshot UI

**Files:**
- Create: `src/components/settings/BrandLibrariesSettings.tsx`
- Create: `src/components/settings/DriveFolderPicker.tsx`
- Create: `src/components/settings/GcsPrefixPicker.tsx`
- Create: `src/app/api/settings/libraries/route.ts`
- Create: `src/app/api/settings/libraries/[id]/route.ts`
- Create: `src/app/api/settings/libraries/[id]/sync/route.ts`
- Modify: `src/components/SettingsView.tsx`
- Test: `tests/brandLibrariesSettings.test.tsx`
- Test: `tests/brandLibrarySettingsRoutes.test.ts`

**Interfaces:**
- Produces: connect, browse, select, cadence, Sync now, pause, reconnect, revoke, snapshot history, exclusion, and failure controls.

- [ ] **Step 1: Write failing UI and route tests**

Assert actual folder/prefix hierarchy, loading/empty/error states, six-hour default, accessible selectors, no pasted GCS path field, snapshot status, failed-file detail, and protected revoke confirmation.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/brandLibrariesSettings.test.tsx tests/brandLibrarySettingsRoutes.test.ts`  
Expected: FAIL because the UI and routes do not exist.

- [ ] **Step 3: Implement Settings integration using existing dashboard design tokens**

Keep connection establishment and folder browsing web-only. Never expose credentials or provider tokens to client state.

- [ ] **Step 4: Run targeted and full Plan 2 verification**

Run: `npm test -- tests/brandLibrariesSettings.test.tsx tests/brandLibrarySettingsRoutes.test.ts && npm test && npm run test:integration && npx tsc --noEmit && npm run lint && npm run build && npm run test:agent`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings src/components/SettingsView.tsx src/app/api/settings/libraries tests/brandLibrariesSettings.test.tsx tests/brandLibrarySettingsRoutes.test.ts
git commit -m "feat: manage synchronized brand libraries"
```
