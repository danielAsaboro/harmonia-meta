# Instagram Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect eligible Instagram Professional accounts and publish verified image posts, carousels, and Reels.

**Architecture:** Meta OAuth discovers only Professional accounts backed by Pages the operator may use. The adapter exposes provider-accessible, short-lived artifact URLs, creates and polls media containers, publishes only ready containers, and verifies the resulting media through Graph API read-back.

**Tech Stack:** Next.js, TypeScript, Meta OAuth, Instagram Graph API, Cloud Storage signed URLs, Python, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-08-29-multiplatform-publishing-design.md`

## Global Constraints

- Complete the shared-core plan first.
- Personal Instagram consumer accounts are never shown as publishable.
- Container creation is pending state, not successful publication.
- Signed artifact URLs are tenant-bound, short-lived, and limited to approved media.

---

### Task 1: Discover eligible Instagram Professional destinations

**Files:**
- Create: `src/lib/publishing/instagramOAuth.ts`
- Modify: `src/lib/oauth.ts`
- Modify: `src/app/api/oauth/[platform]/callback/route.ts`
- Test: `tests/instagramOAuth.test.ts`

**Interfaces:**
- Produces: `discoverInstagramDestinations(accessToken): Promise<PublishDestination[]>`.

- [ ] Write failing tests for Page pagination, Professional-account filtering, permission denial, duplicate account removal, and sanitized provider errors.
- [ ] Run: `npx vitest run tests/instagramOAuth.test.ts`; expect missing-module failure.
- [ ] Implement `/me/accounts` traversal and `instagram_business_account` discovery.

```ts
return pages.flatMap((page) => page.instagram_business_account
  ? [{ kind: "instagram_professional" as const, id: page.instagram_business_account.id, pageId: page.id }]
  : []);
```

- [ ] Run: `npx vitest run tests/instagramOAuth.test.ts tests/oauthRevocation.test.ts`; expect PASS.
- [ ] Commit with `git commit -m "feat(instagram): discover professional accounts"`.

### Task 2: Issue command-bound provider media URLs

**Files:**
- Create: `src/lib/publishing/providerMedia.ts`
- Modify: `src/lib/artifactStore.ts`
- Test: `tests/providerMedia.test.ts`

**Interfaces:**
- Produces: `createProviderMediaUrl(commandId, artifactId, sha256, expiresInSeconds): Promise<string>`.

- [ ] Write failing tests proving cross-workspace artifacts fail, digest mismatches fail, expiry is at most 15 minutes, and the URL resolves only the approved artifact.
- [ ] Run: `npx vitest run tests/providerMedia.test.ts`; expect missing export.
- [ ] Implement signed Cloud Storage reads after `assertResourceWorkspace` and digest verification; store no public ACL.

```ts
if (expiresInSeconds < 60 || expiresInSeconds > 900) throw new Error("invalid provider media expiry");
```

- [ ] Run: `npx vitest run tests/providerMedia.test.ts tests/effectCommands.test.ts`; expect PASS.
- [ ] Commit with `git commit -m "feat(instagram): issue bounded media URLs"`.

### Task 3: Publish and verify images, carousels, and Reels

**Files:**
- Create: `agent/harmonia_agent/publishing/instagram.py`
- Test: `agent/tests/test_instagram_publishing.py`

**Interfaces:**
- Produces: `InstagramAdapter.publish(payload, checkpoint)` and `InstagramAdapter.verify(receipt)`.

- [ ] Write failing tests for single-image containers, ordered carousel children, Reel containers, `status_code` polling, container errors, publish calls, rate limiting, sanitized receipts, and read-back mismatch.
- [ ] Run: `npm run test:agent -- agent/tests/test_instagram_publishing.py`; expect import failure.
- [ ] Implement media creation and polling with a bounded state machine.

```python
READY = {"FINISHED"}
FAILED = {"ERROR", "EXPIRED"}
if status in READY: return checkpoint.ready(container_id)
if status in FAILED: raise PermanentProviderError("instagram container failed")
return checkpoint.processing(container_id)
```

For carousels, create all child containers, wait for every child, create the parent with ordered child IDs, then publish. Verification reads the media ID and compares owner, type, permalink presence, and command digest evidence.

- [ ] Run: `npm run test:agent -- agent/tests/test_instagram_publishing.py agent/tests/test_effect_executor.py`; expect PASS.
- [ ] Commit with `git commit -m "feat(instagram): publish posts carousels and reels"`.

### Task 4: Gate real Meta readiness

**Files:**
- Create: `docs/instagram-publishing.mdx`
- Create: `scripts/verify-instagram-connection.ts`
- Test: `tests/instagramEvidenceCli.test.ts`

**Interfaces:**
- Produces: value-free readiness failures and verified-mode evidence markers.

- [ ] Write failing tests for missing Professional account, Page loss, incomplete container, missing media read-back, and duplicate-effect detection.
- [ ] Implement the verifier without printing access tokens, provider bodies, captions, or media URLs.
- [ ] Run: `npx vitest run tests/instagramEvidenceCli.test.ts && npm run test:agent -- agent/tests/test_instagram_publishing.py`.
- [ ] After Meta approval exists, execute one approved image, carousel, and Reel; verify each media ID, replay each command, and retain sanitized evidence outside Git.
- [ ] Commit with `git commit -m "docs(instagram): add production verification gate"`.
