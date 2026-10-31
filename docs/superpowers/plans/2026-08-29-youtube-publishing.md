# YouTube Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a YouTube channel and upload verified regular videos and Shorts with durable resumable state.

**Architecture:** YouTube consent is independent from Google login and discovers one explicit authorized channel. The adapter creates resumable upload sessions, persists acknowledged offsets, separates byte upload from video processing, and verifies channel, metadata, privacy, and processing through YouTube Data API reads.

**Tech Stack:** Next.js, TypeScript, Google OAuth 2.0, YouTube Data API v3, Python, pytest, Vitest

**Spec:** `docs/superpowers/specs/2026-08-29-multiplatform-publishing-design.md`

## Global Constraints

- Complete the shared-core plan first.
- Request YouTube scopes through a separate explicit connection flow.
- Use resumable uploads and durable offsets; never restart blindly after an ambiguous response.
- A completed upload is not verified until processing and metadata read-back succeed.

---

### Task 1: Discover and persist the authorized YouTube channel

**Files:**
- Create: `src/lib/publishing/youtubeOAuth.ts`
- Modify: `src/lib/oauth.ts`
- Modify: `src/app/api/oauth/[platform]/callback/route.ts`
- Test: `tests/youtubeOAuth.test.ts`

**Interfaces:**
- Produces: `discoverYouTubeDestinations(accessToken): Promise<PublishDestination[]>`.

- [ ] Write failing tests for `channels.list(mine=true)`, missing channels, insufficient scopes, stable channel identity, and sanitized errors.
- [ ] Run: `npx vitest run tests/youtubeOAuth.test.ts`; expect missing-module failure.
- [ ] Implement official channel discovery.

```ts
if (channels.length !== 1) throw new Error("connected Google identity must resolve one YouTube channel");
return [{ kind: "youtube_channel", id: channels[0].id }];
```

- [ ] Run: `npx vitest run tests/youtubeOAuth.test.ts tests/oauthRevocation.test.ts`; expect PASS.
- [ ] Commit with `git commit -m "feat(youtube): connect an explicit channel"`.

### Task 2: Validate regular-video and Short commands

**Files:**
- Create: `src/lib/publishing/youtubeValidation.ts`
- Test: `tests/youtubeValidation.test.ts`

**Interfaces:**
- Produces: `validateYouTubeUpload(payload, currentRules): YouTubeUploadSpec`.

- [ ] Write failing tests for one MP4 requirement, title/description/tag limits, privacy values, duration/aspect eligibility for Shorts, and rejection of metadata-only Short inference.
- [ ] Run: `npx vitest run tests/youtubeValidation.test.ts`; expect missing-module failure.
- [ ] Implement validation from an explicit versioned rule object so current provider constraints are configuration evidence rather than scattered constants.

```ts
export interface YouTubeRuleSet {
  version: string; shortMaxDurationMs: number; shortAspectRatios: readonly string[];
  maxTitleChars: number; maxDescriptionBytes: number;
}
```

- [ ] Run: `npx vitest run tests/youtubeValidation.test.ts tests/publishingContracts.test.ts`; expect PASS.
- [ ] Commit with `git commit -m "feat(youtube): validate videos and shorts"`.

### Task 3: Implement resumable upload and processing verification

**Files:**
- Create: `agent/harmonia_agent/publishing/youtube.py`
- Test: `agent/tests/test_youtube_publishing.py`

**Interfaces:**
- Produces: `YouTubeAdapter.publish(payload, checkpoint)` and `YouTubeAdapter.verify(receipt)`.

- [ ] Write failing tests for session creation, chunk `Content-Range`, HTTP 308 offset recovery, final video ID, timeout reconciliation, processing polling, channel mismatch, privacy mismatch, and sanitized receipts.
- [ ] Run: `npm run test:agent -- agent/tests/test_youtube_publishing.py`; expect import failure.
- [ ] Implement resumable progression without storing bearer tokens in checkpoints.

```python
if response.status_code == 308:
    acknowledged = parse_range(response.headers.get("Range"))
    return checkpoint.advance(acknowledged + 1)
if response.status_code in {200, 201}:
    return AdapterResult.applied(video_id=response.json()["id"])
```

Verification calls `videos.list` for `snippet,status,processingDetails`, requires the approved channel and privacy state, and remains pending until processing terminates successfully.

- [ ] Run: `npm run test:agent -- agent/tests/test_youtube_publishing.py agent/tests/test_durable_uploads.py agent/tests/test_effect_executor.py`; expect PASS.
- [ ] Commit with `git commit -m "feat(youtube): upload and verify video effects"`.

### Task 4: Gate real YouTube readiness

**Files:**
- Create: `docs/youtube-publishing.mdx`
- Create: `scripts/verify-youtube-connection.ts`
- Test: `tests/youtubeEvidenceCli.test.ts`

**Interfaces:**
- Produces: value-free readiness results for video and Short modes.

- [ ] Write failing tests for missing consent, quota rejection, incomplete processing, wrong channel, wrong privacy, missing read-back, and duplicate-effect detection.
- [ ] Implement the verifier with no tokens, upload session URIs, titles, descriptions, or provider bodies in output.
- [ ] Run: `npx vitest run tests/youtubeEvidenceCli.test.ts && npm run test:agent -- agent/tests/test_youtube_publishing.py`.
- [ ] After Google OAuth production readiness exists, upload one approved regular video and one approved Short, wait for processing, verify both, replay both commands, and store sanitized evidence outside Git.
- [ ] Commit with `git commit -m "docs(youtube): add production verification gate"`.
