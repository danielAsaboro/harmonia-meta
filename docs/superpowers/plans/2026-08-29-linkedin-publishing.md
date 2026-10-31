# LinkedIn Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect LinkedIn accounts and publish verified member or organization text, image, and video posts.

**Architecture:** Extend the shared publishing core with LinkedIn OAuth identity/destination discovery and a provider adapter. Member and organization targets are explicit, approval-bound destinations; upload registration, post creation, and read-back remain separate durable phases.

**Tech Stack:** Next.js, TypeScript, LinkedIn OAuth 2.0, LinkedIn REST APIs, Python, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-08-29-multiplatform-publishing-design.md`

## Global Constraints

- Complete `2026-08-29-multiplatform-publishing-core.md` first.
- Use only official LinkedIn OAuth and REST APIs.
- Never expose or infer organizations without verified member authority.
- Do not mark LinkedIn active until real member and organization modes that are enabled have publish/read-back evidence.

---

### Task 1: Discover LinkedIn identity and authorized destinations

**Files:**
- Create: `src/lib/publishing/linkedinOAuth.ts`
- Modify: `src/lib/oauth.ts`
- Modify: `src/app/api/oauth/[platform]/callback/route.ts`
- Test: `tests/linkedinOAuth.test.ts`

**Interfaces:**
- Produces: `discoverLinkedInDestinations(accessToken): Promise<PublishDestination[]>`.

- [ ] Write failing tests proving the member destination is retained, unauthorized organizations are excluded, missing posting scopes reject connection, and provider bodies never appear in errors.
- [ ] Run: `npx vitest run tests/linkedinOAuth.test.ts`; expect missing-module failure.
- [ ] Implement discovery using the official user-info endpoint plus organization ACL/role APIs, returning only `linkedin_member` and authorized `linkedin_organization` records.

```ts
export async function discoverLinkedInDestinations(accessToken: string): Promise<PublishDestination[]> {
  const member = await linkedInJson("/v2/userinfo", accessToken);
  const organizations = await authorizedOrganizations(accessToken);
  return [{ kind: "linkedin_member", id: member.sub }, ...organizations.map(({ id }) => ({ kind: "linkedin_organization" as const, id }))];
}
```

- [ ] Run: `npx vitest run tests/linkedinOAuth.test.ts tests/oauthRevocation.test.ts`; expect PASS.
- [ ] Commit: `git commit -am "feat(linkedin): discover authorized destinations"` after staging the new files.

### Task 2: Publish text, image, and video posts

**Files:**
- Create: `agent/harmonia_agent/publishing/linkedin.py`
- Test: `agent/tests/test_linkedin_publishing.py`

**Interfaces:**
- Produces: `LinkedInAdapter.publish(payload, checkpoint)` and `LinkedInAdapter.verify(receipt)`.

- [ ] Write failing tests for actor URNs, text publishing, image upload registration, video upload checkpointing, sanitized receipts, retryable 429/5xx, permanent 4xx, and ambiguous timeouts.
- [ ] Run: `npm run test:agent -- agent/tests/test_linkedin_publishing.py`; expect import failure.
- [ ] Implement strict actor construction and API calls.

```python
def actor_urn(destination: dict[str, str]) -> str:
    prefix = "person" if destination["kind"] == "linkedin_member" else "organization"
    return f"urn:li:{prefix}:{destination['id']}"
```

Register media, persist upload checkpoints, create the post only after upload completion, and return only post URN, actor URN, content digest, and timestamps.

- [ ] Run: `npm run test:agent -- agent/tests/test_linkedin_publishing.py agent/tests/test_effect_executor.py`; expect PASS.
- [ ] Commit the adapter and tests with `git commit -m "feat(linkedin): publish member and company content"`.

### Task 3: Verify real LinkedIn effects and document setup

**Files:**
- Modify: `src/lib/platforms.ts`
- Create: `docs/linkedin-publishing.mdx`
- Create: `scripts/verify-linkedin-connection.ts`
- Test: `tests/linkedinEvidenceCli.test.ts`

**Interfaces:**
- Produces: a value-free readiness report; never writes `effect_verified` without official read-back.

- [ ] Write a failing CLI test that rejects missing connection, missing destination authority, absent post URN, and mismatched actor/content digest.
- [ ] Run: `npx vitest run tests/linkedinEvidenceCli.test.ts`; expect failure.
- [ ] Implement the CLI to call the authenticated readiness endpoint and emit only codes and opaque identifiers.
- [ ] Run automated verification: `npx vitest run tests/linkedinEvidenceCli.test.ts && npm run test:agent -- agent/tests/test_linkedin_publishing.py`.
- [ ] After developer approval and credentials exist, publish approved member and organization fixtures through Harmonia, verify each via official read-back, replay each idempotency key, and store sanitized evidence outside the repository.
- [ ] Commit docs and verifier with `git commit -m "docs(linkedin): add production verification gate"`.
