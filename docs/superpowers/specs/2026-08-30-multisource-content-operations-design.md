# Multisource Content Operations Design

**Status:** Approved design awaiting implementation planning  
**Date:** 2026-08-30  
**Scope:** Mixed source ingestion, synchronized brand libraries, multimodal outputs, and durable operator steering

## Objective

Harmonia becomes a multisource, multimodal content-operations agent. A job combines a pinned brand-library snapshot with up to ten campaign-specific direct inputs, converts every input into provenance-preserving evidence, proposes a multimodal output plan, produces approved artifacts, and records execution and verification receipts.

YouTube and uploaded video remain first-class inputs. This design generalizes the workflow without reducing media-specific transcription, frame analysis, clip selection, or ffmpeg rendering.

## Compatibility Policy

This change replaces the existing single-source contracts. It does not preserve backward compatibility.

- Remove `youtubeUrl`, `mediaAttachmentId`, `mediaFilename`, `mediaMime`, `mediaStorageUri`, and the brief-only job shortcut from `JobConfig`.
- Remove legacy readers, adapters, aliases, dual-write behavior, stage fallbacks, and migration shims.
- Replace development fixtures and stored development data rather than migrating them.
- Update all callers, tests, documentation, evaluation fixtures, architecture records, and evidence contracts in the same change.

## Product Boundaries

### Supported direct inputs

A job accepts zero to ten direct inputs when a brand library is selected, or one to ten direct inputs when no brand library is selected.

| Input | Accepted form | Extraction result |
|---|---|---|
| YouTube | Authorized YouTube URL | Metadata, audio transcript, timestamp segments, sampled frames, media digest |
| Public web | Public HTTP or HTTPS article, documentation, product, or landing-page URL | Canonical URL, headings, clean text, quoted ranges |
| Uploaded video | MP4, MOV, WebM | Metadata, transcript, timestamps, frames, media artifact |
| Uploaded audio | MP3, WAV, M4A | Metadata, transcript, timestamps, audio artifact |
| Uploaded document | PDF, DOCX, TXT, Markdown | Page, section, paragraph, table, list, or line-aware content |
| Pasted text | Title and operator-provided text | Paragraph and line-aware content |

The initial release does not support authenticated arbitrary webpages, spreadsheets, presentations, scanned-document OCR, or Google Docs links that have not been authorized through the Drive connection.

### Supported brand-library providers

- Google Drive folder or Shared Drive folder selected through an authorized folder picker.
- Google Cloud Storage bucket prefix selected through project, bucket, and folder-style prefix selectors.

Users do not paste `gs://` paths. Harmonia presents Cloud Storage prefixes as folders even though the provider stores object-name prefixes.

### Supported outputs

The output plan may include:

- X posts and threads;
- LinkedIn posts;
- blog and newsletter drafts;
- captions and platform descriptions;
- carousel copy and slide specifications;
- social images, quote cards, and diagrams;
- short clips sourced from supplied video;
- reels assembled from supplied clips;
- explicitly approved generated b-roll or audio;
- editorial calendars; and
- downloadable content packs.

Text and image outputs do not require a video input. Clip actions require real time-range evidence from a supplied video. Generative video is a separate, costed, approval-gated action and must not be presented as a clip from source media.

## Canonical Workflow

The job stage sequence is:

```text
collect_sources
  → extract_sources
  → awaiting_source_resolution (only when one or more selected sources fail)
  → understand
  → strategize
  → awaiting_strategy_approval
  → plan
  → draft
  → awaiting_approval
  → publish
  → verify
  → learn
  → complete
```

The existing `ingest` and `transcribe` stages are removed. Media transcription is an extraction operation within `extract_sources`.

Every transition remains Firestore-authoritative and Pub/Sub-triggered. A transition and its outbox record are committed atomically. Workers acquire a stage lease before processing. Duplicate delivery must not duplicate extraction, rendering, publication, or verification.

## Source Registry

### `SourceInput`

`SourceInput` is a strict discriminated union:

```ts
type SourceInput =
  | { kind: "youtube"; url: string; rightsAuthorizationId: string }
  | { kind: "web"; url: string; rightsAuthorizationId: string }
  | { kind: "upload"; attachmentId: string; rightsAuthorizationId: string }
  | { kind: "pasted_text"; title: string; text: string; rightsAuthorizationId: string };
```

Provider credentials, unrestricted folder handles, and raw access tokens are never embedded in `SourceInput`.

### `JobSourceManifest`

Each job owns one immutable manifest revision at a time:

```ts
interface JobSourceManifest {
  id: string;
  jobId: string;
  revision: number;
  librarySnapshotId?: string;
  directSourceIds: string[];
  excludedSourceIds: string[];
  exclusionRecords: SourceExclusionRecord[];
  digest: string;
  sealedAt: string;
  sealedBySubjectId: string;
}
```

A job may reference zero or one synchronized brand-library snapshot. Direct inputs remain capped at ten in total. A manifest must contain at least one ready source across its library snapshot and direct inputs before `understand` begins.

### `SourceRecord`

Every direct input and every file represented in a library snapshot has an independent source record:

```ts
type SourceState =
  | "discovered"
  | "validating"
  | "queued"
  | "extracting"
  | "ready"
  | "failed"
  | "excluded";

interface SourceRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  provider: "youtube" | "web" | "upload" | "pasted_text" | "google_drive" | "gcs";
  providerResourceId: string;
  providerVersion: string;
  title: string;
  mimeType: string;
  state: SourceState;
  rightsAuthorizationId: string;
  trust: "operator_supplied" | "authorized_private" | "public_untrusted";
  contentDigest?: string;
  normalizedArtifactId?: string;
  extractionReceiptId?: string;
  failure?: SourceFailure;
  createdAt: string;
  updatedAt: string;
}
```

State changes use optimistic revision checks or Firestore transactions. A completed extraction with the same source version and extractor version is reused by digest rather than repeated.

## Normalized Evidence

Every extractor returns `NormalizedSource`. Provider-specific richness remains available through typed segments and locators.

```ts
interface NormalizedSource {
  sourceId: string;
  sourceKind: "video" | "audio" | "document" | "web" | "text";
  title: string;
  mimeType: string;
  contentDigest: string;
  extractorVersion: string;
  extractedAt: string;
  segments: ContentSegment[];
  metadata: Record<string, string | number | boolean>;
  extractionReceiptId: string;
}

type EvidenceLocator =
  | { kind: "time_range"; startMs: number; endMs: number }
  | { kind: "frame"; timestampMs: number; frameArtifactId: string }
  | { kind: "page_range"; startPage: number; endPage: number }
  | { kind: "paragraph_range"; startParagraph: number; endParagraph: number }
  | { kind: "line_range"; startLine: number; endLine: number }
  | { kind: "section"; heading: string; occurrence: number }
  | { kind: "url_fragment"; canonicalUrl: string; fragment: string };

interface ContentSegment {
  id: string;
  text: string;
  locator: EvidenceLocator;
  digest: string;
}
```

Every moment, angle, strategy claim, content claim, and review finding references `sourceId`, `segmentId`, and the segment locator. Timestamp-only assumptions and transcript-only source packages are removed.

Large normalized payloads and media bytes live in the artifact store. Firestore retains bounded metadata, digests, locators, and artifact references.

## Extraction Adapters

Each adapter implements one interface and has no workflow authority:

```ts
interface SourceExtractor {
  supports(source: SourceRecord): boolean;
  estimate(source: SourceRecord): Promise<ExtractionEstimate>;
  extract(source: SourceRecord, context: ExtractionContext): Promise<ExtractionResult>;
}
```

- YouTube and uploaded media retain transcription, timestamps, frames, duration, and clip-source materialization.
- Public web extraction blocks loopback, link-local, private, metadata-service, and reserved-network targets before every request and redirect. It limits redirects, response bytes, MIME types, and extraction time.
- PDF extraction preserves page numbers.
- DOCX extraction preserves headings, paragraphs, tables, and lists.
- TXT, Markdown, and pasted text preserve headings, paragraphs, and line ranges.
- Drive extraction receives a single authorized file revision selected from a connected folder snapshot.
- GCS extraction receives a single bucket, object name, and pinned generation from a connected prefix snapshot.

An adapter failure records a typed `SourceFailure`; it never fabricates normalized content or converts a failure into an empty successful source.

## Brand Libraries

### Connection

`BrandLibraryConnection` records:

- provider;
- workspace and brand scope;
- authorized provider identity reference;
- selected Drive folder or GCS bucket prefix;
- sync cadence;
- file, byte, extracted-text, duration, and cost policies;
- current healthy snapshot ID;
- last sync status; and
- created, updated, paused, and revoked timestamps.

Credentials are stored in Secret Manager or the existing encrypted connection boundary. Agents and job records never receive credentials.

### Sync cadence

Supported cadences are hourly, every six hours, daily, and paused. Every six hours is the default. `Sync now` remains available.

Cloud Scheduler triggers a workspace-scoped sync operation. The sync enumerates authorized files incrementally using Drive change tokens or GCS generations, validates policy, extracts changed files, and constructs a new immutable manifest. A new snapshot becomes current only after the sync reaches a healthy terminal state.

A failed sync preserves the previous healthy snapshot. Deleted, moved, or access-revoked provider files disappear from future snapshots but remain referenced by historical manifests according to retention policy.

### Snapshot

`BrandLibrarySnapshot` includes the connection ID, snapshot revision, source-record versions, manifest digest, sync receipt, status, and creation time. Jobs pin snapshot IDs at manifest seal time. Running jobs never switch to a newer snapshot.

## Source Failure Resolution

After extraction settles, any failed selected source moves the job to `awaiting_source_resolution`. The system displays each failure and permits:

- **Retry:** retry the same source version;
- **Replace:** substitute a new direct input and create a new source record;
- **Remove:** exclude the source from the next manifest revision;
- **Reconnect:** restore provider access and retry;
- **Continue:** seal a revised manifest using only ready sources.

Continue records immutable exclusions and their reasons. Harmonia does not infer that a failed source is unimportant. The `understand` stage cannot begin until the resolution is durable and the revised manifest contains at least one ready source.

## Output Planning and Production

Job creation records desired and allowed output types. Harmonia proposes a content mix based on the evidence and configured channel capabilities. The strategy approval surface shows the proposed output types, quantities, destinations, estimated cost, and required approvals.

The operator may edit or reject the proposed mix before expensive generation or publication. Artifact production is source-aware:

- text and images may derive from any sufficiently grounded evidence;
- clip and reel actions require source video segments;
- generative image, video, and audio actions remain separately costed and policy-gated;
- external publication remains bound to exact payload approval; and
- each executed action produces an idempotency claim, receipt, and independent verification.

## Durable Steering

### Controls

Every active job exposes:

- **Nudge:** add a scoped creative or factual constraint;
- **Pause:** block new work after the current durable checkpoint;
- **Redo:** invalidate a selected stage and its dependent lineage;
- **Cancel:** terminate future work and block unexecuted effects.

Nudge scopes are `current_stage`, `remaining_job`, and `content_item`. Job nudges never become cross-job memory automatically.

### Nudge record

```ts
interface JobNudge {
  id: string;
  jobId: string;
  scope: "current_stage" | "remaining_job" | "content_item";
  targetId?: string;
  instruction: string;
  revision: number;
  actorSubjectId: string;
  createdAt: string;
  impact: NudgeImpact;
  state: "proposed" | "applied" | "discarded";
}
```

Before application, Harmonia calculates and displays the affected artifacts, stage outputs, approvals, and pending effects. Applying the nudge commits the instruction and all stale-lineage markers transactionally.

Nudges cannot override security policy, source rights, provenance, budgets, tenancy, approval requirements, or effect authorization.

### Pause, redo, and cancel

- Pause changes the job control state immediately. A worker already inside an operation completes or records uncertainty, but no next operation begins.
- Redo identifies the earliest selected stage, invalidates all dependent outputs, revokes affected pending approvals, increments the relevant lineage revision, and requeues that stage.
- Cancel prevents new stage claims and unclaimed effects. Claimed or uncertain effects enter reconciliation rather than being reported as cancelled success.
- Executed effects remain immutable historical facts.

### Brand preferences

`Save as brand preference` is a separate explicit action. It presents the proposed preference, scope, and future effect for confirmation. Brand preferences support inspect, edit, and delete. They never authorize publication or override job policy.

## Application Integration

### Studio

- Extend the existing `StudioComposer`; do not create a separate job-creation application shell.
- Add a brand-library selector, direct-source attachments, URL recognition, pasted text, and a direct-source count capped at ten.
- Preserve the existing conversation/canvas split, chapter navigation, approval dock, mobile pane switcher, palette, typography, and compact metadata treatment.
- Replace the transcript-centric `SourcesWorkspace` with manifest, snapshot, source-state, extraction, failure-resolution, normalized-source, and provenance views.
- Present nudge impact in the canvas. Keep Nudge, Pause, Redo, and Cancel available from the active-job controls.
- Route invalidated approvals through the existing protected approval boundary. Generated A2UI surfaces cannot own these controls.

### Settings

Add brand-library connection management:

- Drive/GCS connection;
- Drive folder or GCS project/bucket/prefix selection;
- sync cadence;
- current and historical snapshot status;
- file exclusions and extraction failures;
- `Sync now`, pause, reconnect, and revoke; and
- brand-preference inspect, edit, and delete.

### Chat and Telegram

Chat may create jobs with mixed direct inputs, choose an existing library, inspect source failures, propose steering actions, and display status. Telegram may select an existing connected library by name and submit supported public URLs or pasted text. Credential establishment and folder browsing remain web-only.

Neither chat nor Telegram text directly authorizes destructive steering or publication. Protected controls and exact confirmation records remain authoritative.

### Monitoring and evidence

Monitoring includes library syncs, snapshot IDs, source states, extractor operations, manifest revisions, nudges, invalidations, approval revocations, and recovery operations. Telemetry remains metadata-only.

The evidence collector must correlate the demonstrated job with its source manifest, library snapshot, extraction receipts, Gemini/ADK calls, output plan, approvals, effects, verifications, and trace ID.

## Security and Policy

- Derive workspace and brand identity at authenticated boundaries.
- Check provider resources against the connected workspace and brand before reading.
- Use minimum Drive, GCS, and service-account permissions.
- Never expose provider credentials to agents, browser payloads, logs, or job records.
- Malware-scan uploaded and provider-fetched files before extraction.
- Treat public web content as untrusted and retain its trust classification through agent inputs.
- Enforce MIME, per-file bytes, total library bytes, extracted characters, media duration, URL response bytes, processing concurrency, and cost budgets.
- Require operator confirmation when estimated cost crosses the configured threshold.
- Reject duplicate and near-duplicate direct sources before manifest seal or present them for explicit exclusion.

## Testing and Verification

Implementation follows test-driven development. Required automated coverage includes:

1. strict source unions and the ten-direct-source cap;
2. manifest sealing, digesting, and minimum-ready-source rules;
3. provider-version pinning and extraction idempotency;
4. media, PDF, DOCX, text, Markdown, and webpage locators;
5. web SSRF, redirect, MIME, byte, timeout, and executable-content rejection;
6. Drive and GCS connection scope and snapshot behavior;
7. scheduled incremental sync and last-healthy-snapshot preservation;
8. independent source-state transitions and concurrent retries;
9. failure resolution and immutable exclusion records;
10. generalized agent source packages and evidence validation;
11. hybrid output planning and modality eligibility;
12. nudge precedence, impact calculation, and immutable-policy boundaries;
13. pause, redo, cancel, stale lineage, approval revocation, and uncertain-effect reconciliation;
14. Studio, Settings, chat, Telegram, A2UI, monitoring, and evidence contracts; and
15. one full mixed-source local integration workflow.

Offline and emulator tests prove contracts only. Production claims require authenticated evidence for Drive, GCS, public web, documents, media, Gemini, Agent Engine, Firestore, Pub/Sub, Cloud Scheduler, rendering, external effects, and verification.

## Acceptance Criteria

The implementation is complete when:

- the old single-source contract and stages no longer exist;
- a job can combine a pinned Drive or GCS brand-library snapshot with up to ten mixed direct inputs;
- YouTube and uploaded video retain transcription, timestamp, frame, and clip behavior;
- document, webpage, and pasted-text evidence uses exact non-time locators;
- partial extraction failure pauses and requires an explicit durable resolution;
- the approved output plan can produce grounded text, image, calendar, pack, clip, and approved generative-media actions as eligible;
- operators can nudge, pause, redo, and cancel from the existing Studio;
- nudges invalidate dependent output and approvals without overriding policy;
- scheduled library sync preserves immutable job snapshots and the last healthy library state;
- all affected TypeScript and Python tests pass; and
- documentation and evidence claims distinguish implemented contracts from authenticated live proof.
