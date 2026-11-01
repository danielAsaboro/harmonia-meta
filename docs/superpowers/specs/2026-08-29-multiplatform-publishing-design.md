# Workspace-scoped multiplatform publishing

**Status:** Approved design

**Date:** 2026-08-29

**Scope:** LinkedIn, Instagram, and YouTube publishing through official provider APIs

## Purpose

Harmonia currently uses a Google/Firebase identity to create an isolated owner workspace and supports an active X publishing path. LinkedIn, Instagram, and YouTube have OAuth registry groundwork but no complete external-effect adapters. This design extends the existing tenant, approval, idempotency, receipt, and verification boundaries to those providers without treating Google sign-in as social-account authorization.

The result is a multi-tenant SaaS in which an operator signs in with Google, connects independent social accounts to that Harmonia workspace, approves an exact provider-specific action, and allows Harmonia to publish and verify that action on the connected account's behalf.

## Goals

- Connect LinkedIn, Instagram, and YouTube accounts through official OAuth flows.
- Discover and persist only destinations the connected identity may use.
- Publish to LinkedIn member profiles or authorized company pages.
- Publish Instagram single-image feed posts, carousels, and Reels.
- Upload regular YouTube videos and Shorts.
- Preserve exact human approval, tenant isolation, idempotency, audit receipts, and independent read-back verification.
- Refresh and revoke credentials safely without exposing tokens to browser state, logs, Firestore plaintext, or model context.
- Keep each connector disabled until its application credentials and provider readiness requirements are satisfied.

## Non-goals

- Posting without an explicit action approval.
- Scraping, browser automation as a publishing transport, or unofficial APIs.
- Treating Google login as implicit YouTube consent.
- Automatic selection of a company, page, channel, or Instagram account by a model.
- Claiming production readiness from mocks, fixtures, request-shape tests, or unreviewed provider applications.
- Supporting TikTok or Facebook Pages in this delivery. Their registry entries remain credential groundwork.

## Core architecture

Google/Firebase identity remains the tenant root. Every provider authorization is a separate encrypted connection owned by one workspace. Tenant identity is resolved from the verified server session and is never accepted from OAuth parameters, model output, publish payloads, or Pub/Sub message content without server-side reconciliation.

A shared publishing core introduces a provider-neutral `PublishCommand`. It contains:

- workspace and brand identity;
- connection and destination identity;
- provider and publishing mode;
- normalized text, metadata, and immutable media references;
- content and media digests;
- exact approval receipt identity;
- stable idempotency key; and
- scheduling and policy metadata when applicable.

Provider adapters translate this command into official API calls. They do not choose credentials, destinations, approval state, or retry policy. Deterministic application code owns those decisions.

## Connection model

The existing workspace-scoped connection record expands to store encrypted access and refresh tokens, granted scopes, expiry, provider account identity, available destinations, selected defaults, connection health, and the credential revision. Public reads expose only sanitized metadata.

OAuth authorization uses state bound to the authenticated workspace, initiating operator, provider, return path, expiry, and a one-time nonce. PKCE is mandatory where the provider supports it. The callback consumes state once, exchanges the authorization code server-side, validates the granted scopes, encrypts credentials, discovers authorized destinations, and persists the connection transactionally.

Destinations are explicit records:

- **LinkedIn:** the connected member and each organization for which the member has the required publishing authority.
- **Instagram:** eligible Instagram Professional accounts connected through Meta, including their backing Page identity where required.
- **YouTube:** the authorized channel returned by the YouTube Data API.

Changing or removing a destination cannot retarget an already approved command. Disconnect revokes provider authorization before encrypted local credentials are erased. A failed revocation leaves the connection quarantined and retryable.

## Provider capabilities

### LinkedIn

LinkedIn supports text, image, and video publishing for either the connected member or an organization the member is authorized to administer. The destination is selected before approval and becomes part of the content digest.

The adapter registers/uploads media when required, waits for provider readiness when the API exposes asynchronous processing, creates the post through the official LinkedIn API, stores the provider post URN, and verifies it with a fresh authorized read. Organization publishing is unavailable unless destination discovery proves the necessary organization role and granted product scopes.

### Instagram

Instagram supports single-image feed posts, carousels, and Reels for eligible Professional accounts. Personal consumer accounts are not presented as publishable destinations.

The adapter creates Graph API media containers, polls their processing state, assembles carousel children when applicable, publishes the final container, and stores both container and media identifiers. Provider-accessible media URLs are short-lived, command-bound artifact URLs; they do not expose unrelated tenant assets. A successful container request is pending, not published. Verification requires a fresh lookup of the resulting media object and comparison with the approved destination and media identity.

### YouTube

YouTube supports resumable uploads for regular videos and Shorts. A Short is represented as an explicit publishing mode with validated duration, aspect ratio, metadata, and current provider eligibility rules; Harmonia does not infer success from a title or hashtag convention.

The adapter creates and durably tracks a resumable upload session, persists acknowledged byte offsets, resumes safely after transient interruption, and stores the returned video ID. Upload completion and YouTube processing are separate states. Verification reads the video resource and checks channel, metadata, privacy state, and processing status against the approved command.

## Approval and execution

Draft generation and media rendering remain non-authoritative. Before approval, Harmonia validates the selected provider, destination, format, text, media constraints, connection health, and estimated cost or quota implications.

Approval binds the exact:

- provider and destination;
- text and metadata;
- ordered media digests;
- format or upload mode;
- privacy and scheduling choices; and
- credential revision or an equivalent safe connection binding.

Any material change invalidates approval. At execution, the worker revalidates tenant ownership, destination eligibility, connection health, approval digest, and policy. It claims the stable idempotency key before contacting the provider. Finalized claims return the original receipt; uncertain claims enter reconciliation rather than blind replay.

## Durable states

External execution uses explicit states rather than collapsing every accepted request into success:

`proposed -> approved -> claimed -> uploading|processing|publishing -> applied -> verifying -> verified`

Terminal or attention states include `rejected`, `failed_permanent`, `reconnect_required`, `review_required`, and `outcome_uncertain`. Transient failures retain safe resume data and a bounded retry schedule. Provider quota exhaustion and application-review restrictions remain visible operator issues.

## Receipts and verification

Receipts contain sanitized provider identifiers, destination identity, action and content digests, timestamps, attempt number, provider response classification, and trace correlation. They never contain access tokens, refresh tokens, raw provider bodies, unpublished content beyond already authorized projections, or private account data unnecessary for audit.

Verification is adapter-specific and uses official read endpoints. It must establish that the observed artifact belongs to the approved destination and corresponds to the approved content or media. A publish response without read-back evidence is `applied` but not `verified`. When a provider cannot immediately return a processing artifact, verification remains pending and resumes durably.

## Token lifecycle

Refresh uses a durable per-connection claim so concurrent workers cannot rotate the same credential independently. Successful refresh atomically stores the new encrypted token set and increments the credential revision. `invalid_grant`, revoked scopes, or an unverifiable refresh result quarantines the connection and requires reconnection. Logs report classifications and opaque connection IDs only.

## Security boundaries

- Provider credentials are server-side, encrypted, workspace-scoped, and excluded from model tools.
- OAuth callbacks derive workspace identity from signed, single-use state plus the current authenticated session.
- Media delivery URLs are least-privilege, short-lived, artifact-specific, and revocable.
- Models may propose content but cannot connect accounts, choose authority, approve, publish, refresh credentials, or mark verification successful.
- Service accounts receive only the secret and storage permissions required by their execution role.
- Provider webhooks, if later introduced, require signature validation and replay protection before they can affect durable state.

## Product availability

Each registry entry exposes separate states for application credentials, OAuth connectability, connected account health, publishing capability, and verified deployment evidence. A provider becomes `active` only after:

1. its developer application is approved for the required products and scopes;
2. production configuration contains the required secrets and callback URLs;
3. a real account connects successfully;
4. each supported publishing mode completes an authenticated provider effect;
5. read-back verification succeeds; and
6. duplicate-suppression replay returns the original receipt without a second effect.

Until then, the UI states the exact blocker and does not imply that credential groundwork is an operational integration.

## Testing and evidence

Automated tests cover schemas, tenant isolation, OAuth state consumption, scope validation, encryption boundaries, refresh claims, revocation failure, destination selection, approval invalidation, media validation, request construction, resumable state, idempotent claims, response parsing, failure classification, receipts, and verification comparisons.

Sanitized provider response shapes may be used for deterministic parser and contract tests, but never as integration evidence. Real evidence is captured outside the public repository and includes OAuth connection metadata, one approved publish for every supported mode, provider-visible state, fresh read-back output, duplicate suppression, and relevant Cloud Run/Firestore trace correlation with secrets removed.

## Developer-application setup

Provider applications are registered under the owner's personal developer identity. Browser-assisted setup may populate known technical fields and submit applications, but the owner personally handles identity details, MFA, legal attestations, business or Page verification, billing, and any provider consent that cannot be delegated. Provider review timing is external and cannot be guaranteed.

Required provider work includes:

- LinkedIn developer application products and permissions for member and organization publishing.
- Meta application configuration, Instagram Graph API access, an eligible Professional account, backing Page ownership, data-use declarations, and review for required permissions.
- Google Cloud OAuth consent, YouTube Data API enablement, verified redirect URIs, appropriate test/production publishing status, and quota readiness.

Secrets are written only to the approved deployment secret store, never committed to Git or pasted into documentation.

## Delivery sequence

Implementation follows the shared core first, then LinkedIn, Instagram, and YouTube adapters. Each provider passes its automated contract gates before browser-assisted application setup and real validation. This order minimizes duplicated authority logic while allowing provider-specific failures to remain isolated.

The existing X path migrates to the shared command interface without changing its approval or verification guarantees. TikTok and Facebook remain disabled groundwork and are outside this design.
