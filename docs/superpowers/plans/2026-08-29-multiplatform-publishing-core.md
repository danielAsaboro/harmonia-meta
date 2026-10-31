# Multiplatform Publishing Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Harmonia's deterministic effect boundary with workspace-scoped provider connections, explicit destinations, typed publish commands, durable uploads, and verified receipts.

**Architecture:** Google/Firebase remains the tenant root while each social authorization is an independent encrypted workspace connection. A provider-neutral command and adapter protocol centralizes approval binding, claims, receipts, token lifecycle, and verification; provider plans implement only provider-specific OAuth discovery and API behavior.

**Tech Stack:** Next.js 16, TypeScript, Zod, Firestore, Firebase Auth/Identity Platform, Python 3.12, FastAPI worker, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-08-29-multiplatform-publishing-design.md`

## Global Constraints

- Official provider APIs only; no scraping or browser-driven publishing.
- Google sign-in never grants implicit social or YouTube authorization.
- Every connection, destination, command, upload session, receipt, and verification is workspace-scoped.
- Every external publish requires an approval bound to the exact provider, destination, text, metadata, media digests, mode, privacy, and credential revision.
- Provider acceptance is not verification; only a fresh official API read-back may mark an effect verified.
- Tokens stay encrypted server-side and never enter model context, client state, logs, or receipts.
- Providers remain disabled until a real authenticated effect, read-back, and duplicate-suppression replay are evidenced.

---

### Task 1: Define typed providers, destinations, media, and publish payloads

**Files:**
- Create: `src/lib/publishing/contracts.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Test: `tests/publishingContracts.test.ts`

**Interfaces:**
- Produces: `SocialProvider`, `PublishDestination`, `PublishMedia`, `PublishPayload`, `publishPayloadSchema`, and new action types `publish_linkedin_post`, `publish_instagram_post`, `publish_youtube_video`.

- [ ] **Step 1: Write failing schema tests**

```ts
expect(() => publishPayloadSchema.parse({
  provider: "instagram", connectionId: "conn-1", credentialRevision: 4,
  destination: { id: "ig-1", kind: "instagram_professional" },
  mode: "carousel", text: "Launch", media: [], privacy: "public",
})).toThrow();

expect(publishPayloadSchema.parse({
  provider: "youtube", connectionId: "conn-1", credentialRevision: 2,
  destination: { id: "channel-1", kind: "youtube_channel" },
  mode: "short", text: "Launch", title: "Launch", media: [
    { artifactId: "asset-1", sha256: "a".repeat(64), mimeType: "video/mp4", sizeBytes: 1024 },
  ], privacy: "unlisted",
}).mode).toBe("short");
```

- [ ] **Step 2: Run the focused test and confirm missing exports fail**

Run: `npx vitest run tests/publishingContracts.test.ts`

Expected: FAIL because `src/lib/publishing/contracts.ts` does not exist.

- [ ] **Step 3: Implement strict discriminated contracts**

```ts
export type SocialProvider = "x" | "linkedin" | "instagram" | "youtube";
export type PublishDestination =
  | { kind: "linkedin_member" | "linkedin_organization"; id: string }
  | { kind: "instagram_professional"; id: string; pageId: string }
  | { kind: "youtube_channel"; id: string };

export const publishMediaSchema = z.object({
  artifactId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(["image/jpeg", "image/png", "video/mp4"]),
  sizeBytes: z.number().int().positive(), durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
}).strict();
```

Use a discriminated union so LinkedIn modes are `text|image|video`, Instagram modes are `image|carousel|reel`, and YouTube modes are `video|short`. Require exactly one media item except LinkedIn text and Instagram carousel; require a title and one video for YouTube.

- [ ] **Step 4: Extend action and receipt schemas with the new action types**

Add the three action literals to `ActionType`, effect claim, receipt, pending-operation, and proposal schemas. Replace provider-specific loose records with `publishPayloadSchema` for new commands.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/publishingContracts.test.ts tests/effectCommands.test.ts tests/effectClaimContracts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/publishing/contracts.ts src/lib/types.ts src/lib/contracts.ts tests/publishingContracts.test.ts
git commit -m "feat(publishing): define multiplatform effect contracts"
```

### Task 2: Persist workspace-scoped connections and destinations

**Files:**
- Create: `src/lib/publishing/connections.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/app/api/settings/connections/route.ts`
- Modify: `src/app/api/settings/connections/[platform]/route.ts`
- Test: `tests/publishingConnections.test.ts`
- Test: `tests/tenantIsolation.test.ts`

**Interfaces:**
- Consumes: `SocialProvider`, `PublishDestination`.
- Produces: `SocialConnection`, `getSocialConnection(platform)`, `saveSocialConnection(connection)`, `listPublishDestinations(platform)`, `selectDefaultDestination(platform, destinationId)`.

- [ ] **Step 1: Write failing tenant and sanitization tests**

```ts
expect(sanitizeConnection(connection)).toEqual(expect.objectContaining({
  id: "conn-1", platform: "linkedin", credentialRevision: 1,
}));
expect(sanitizeConnection(connection)).not.toHaveProperty("accessToken");
expect(() => assertResourceWorkspace(scopeA, connectionFromWorkspaceB)).toThrow("workspace access denied");
```

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run tests/publishingConnections.test.ts tests/tenantIsolation.test.ts`

Expected: FAIL because the connection repository is missing.

- [ ] **Step 3: Implement the connection record**

```ts
export interface SocialConnection {
  id: string; workspaceId: string; platform: SocialProvider; providerAccountId: string;
  encryptedAccessToken: string; encryptedRefreshToken?: string; grantedScopes: string[];
  expiresAt?: string; credentialRevision: number; health: "active" | "reconnect_required" | "revocation_pending";
  destinations: PublishDestination[]; defaultDestinationId?: string; connectedAt: string; updatedAt: string;
}
```

Store records only under `workspaces/{workspaceId}/connections/{platform}`. All settings handlers continue deriving the workspace from `currentTenant()` and return sanitized projections.

- [ ] **Step 4: Run focused and route tests**

Run: `npx vitest run tests/publishingConnections.test.ts tests/tenantIsolation.test.ts tests/contextProjectionRoutes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/publishing/connections.ts src/lib/firestore.ts src/app/api/settings/connections tests/publishingConnections.test.ts tests/tenantIsolation.test.ts
git commit -m "feat(publishing): persist tenant-scoped destinations"
```

### Task 3: Bind approval to provider, destination, media, and credential revision

**Files:**
- Create: `src/lib/publishing/approval.ts`
- Modify: `src/lib/effectCommands.ts`
- Modify: `src/lib/policy.ts`
- Test: `tests/publishingApproval.test.ts`
- Test: `tests/effectCommands.test.ts`

**Interfaces:**
- Consumes: `PublishPayload`, `EffectCommandAuthorization`.
- Produces: `publishApprovalDigest(payload): string` and `assertPublishAuthorization(payload, approvedDigest): void`.

- [ ] **Step 1: Write failing invalidation tests**

```ts
const approved = publishApprovalDigest(payload);
expect(() => assertPublishAuthorization({ ...payload, credentialRevision: 3 }, approved)).toThrow("approval payload digest mismatch");
expect(() => assertPublishAuthorization({ ...payload, destination: otherDestination }, approved)).toThrow("approval payload digest mismatch");
expect(() => assertPublishAuthorization({ ...payload, media: [...payload.media].reverse() }, approved)).toThrow("approval payload digest mismatch");
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/publishingApproval.test.ts tests/effectCommands.test.ts`

Expected: FAIL because publishing approval helpers are missing.

- [ ] **Step 3: Implement canonical approval binding**

Compute the digest from the strict parsed payload, preserving media order and including provider, destination, mode, privacy, schedule, connection ID, and credential revision. Reuse `effectCommandDigest` as the command-level authority check rather than creating a second external-effect bypass.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/publishingApproval.test.ts tests/effectCommands.test.ts tests/effectDispatchRoutes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/publishing/approval.ts src/lib/effectCommands.ts src/lib/policy.ts tests/publishingApproval.test.ts tests/effectCommands.test.ts
git commit -m "feat(publishing): bind approval to exact destination"
```

### Task 4: Add provider adapter and durable upload protocols

**Files:**
- Create: `agent/harmonia_agent/publishing/contracts.py`
- Create: `agent/harmonia_agent/publishing/registry.py`
- Create: `agent/harmonia_agent/publishing/uploads.py`
- Modify: `agent/harmonia_agent/effect_executor.py`
- Test: `agent/tests/test_publishing_registry.py`
- Test: `agent/tests/test_durable_uploads.py`

**Interfaces:**
- Produces: `PublishAdapter.publish(payload, checkpoint) -> AdapterResult`, `PublishAdapter.verify(receipt) -> VerificationResult`, and `UploadCheckpoint(session_uri, acknowledged_bytes, state)`.

- [ ] **Step 1: Write failing protocol tests**

```python
def test_registry_rejects_unregistered_provider():
    with pytest.raises(RuntimeError, match="no adapter"):
        PublishingRegistry({}).adapter_for("instagram")

def test_upload_checkpoint_never_moves_backwards():
    checkpoint = UploadCheckpoint("https://upload.example/session", 100, "uploading")
    with pytest.raises(ValueError, match="move backwards"):
        checkpoint.advance(99)
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:agent -- agent/tests/test_publishing_registry.py agent/tests/test_durable_uploads.py`

Expected: FAIL because the publishing package is missing.

- [ ] **Step 3: Implement focused protocols and registry**

```python
class PublishAdapter(Protocol):
    def publish(self, payload: dict[str, Any], checkpoint: UploadCheckpoint | None) -> AdapterResult: ...
    def verify(self, receipt: dict[str, Any]) -> VerificationResult: ...

@dataclass(frozen=True)
class UploadCheckpoint:
    session_uri: str
    acknowledged_bytes: int
    state: Literal["uploading", "processing", "complete"]
```

Update `effect_executor.py` to resolve the adapter by action type and persist adapter checkpoints through an injected callback. Existing X behavior must pass through the registry unchanged.

- [ ] **Step 4: Run agent tests**

Run: `npm run test:agent -- agent/tests/test_publishing_registry.py agent/tests/test_durable_uploads.py agent/tests/test_effect_executor.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/publishing agent/harmonia_agent/effect_executor.py agent/tests/test_publishing_registry.py agent/tests/test_durable_uploads.py
git commit -m "refactor(publishing): add provider adapter boundary"
```

### Task 5: Add product availability and full-core verification

**Files:**
- Modify: `src/lib/platforms.ts`
- Modify: `src/components/SettingsView.tsx`
- Modify: `docs/reference/environment.mdx`
- Test: `tests/platformAvailability.test.ts`

**Interfaces:**
- Produces: truthful states `credential_groundwork`, `connectable`, `connected`, `effect_verified` with explicit blockers.

- [ ] **Step 1: Write a failing availability test**

```ts
expect(providerAvailability(linkedinWithoutEvidence)).toEqual({
  state: "connected", blockers: ["authenticated publish and read-back evidence required"],
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/platformAvailability.test.ts`

Expected: FAIL because availability does not model evidence separately.

- [ ] **Step 3: Implement truthful availability projections and UI copy**

Keep registry definitions static, derive runtime readiness from deployment credentials, sanitized connection health, and an evidence marker written only by the real verification workflow. Do not promote a provider from tests or fixtures.

- [ ] **Step 4: Run full core verification**

Run: `npm test && npm run test:agent && npm run lint && npx tsc --noEmit && npm run build && git diff --check`

Expected: all commands exit 0; skipped real-provider tests remain clearly identified.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms.ts src/components/SettingsView.tsx docs/reference/environment.mdx tests/platformAvailability.test.ts
git commit -m "feat(publishing): expose verified connector readiness"
```
