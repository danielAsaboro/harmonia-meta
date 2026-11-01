# Harmonia Long-Conversation Studio Design

## Goal

Turn the dashboard console into a cross-media creative workspace where an operator can hold a long conversation with Harmonia while written posts, images, memes, clips, generated-video concepts, audio, sources, approvals, and verification state accumulate in an organized working set.

The interface must preserve chat as a first-class interaction without allowing a long transcript to become the product's information architecture.

## Primary Layout

At desktop widths of 1280 pixels and above, the navigation rail sits outside a two-pane workspace:

- Conversation occupies exactly two fifths of the available workspace width.
- The living canvas occupies exactly three fifths.
- The implementation uses `minmax(360px, 2fr) minmax(540px, 3fr)` so neither pane becomes unusable.
- The split may be temporarily resized by the operator, but the reset/default action always returns it to 2:3.

The conversation pane owns its header, scroll region, search, chapter navigation, and sticky composer. The canvas owns its toolbar, artifact views, and sticky approval dock. Neither pane scrolls the other.

Between 1024 and 1279 pixels, the panes retain the same conceptual relationship with minimum widths and a compact navigation rail. Below 1024 pixels, the interface becomes a single-pane Chat/Canvas switcher rather than compressing both panes side by side. Approval remains reachable as a sticky bottom action in either view.

## Long-Conversation Model

Messages remain the complete historical record, but the default view organizes them into deterministic chapters:

- Discovery: requests, sources, context questions, status checks, and research.
- Narrative: strategy, angles, positioning, voice, and draft direction.
- Production: creation and revision of written or media artifacts.
- Approval: pending decisions, approvals, rejections, publishing, and verification.

Chapter assignment derives from persisted chat intent, job stage, job updates, confirmations, and action outcomes. It does not require a model call and does not invent missing metadata. A chapter navigator shows counts and moves the scroll position to the corresponding turn.

Older runs within the active chapter collapse into deterministic summaries showing the user request, result count, affected jobs, and decisions. Expanding a summary reveals the original messages unchanged. Search runs locally over the loaded transcript, artifact titles, job IDs, and source labels.

The conversation renders five distinct turn types:

1. Operator messages.
2. Concise Harmonia responses.
3. Collapsible agent-run summaries containing sanitized activity and tool status, never hidden chain-of-thought.
4. Artifact references linking a message to the working canvas.
5. Decision checkpoints derived only from real confirmations, action decisions, or persisted outcomes.

Completed activity defaults to collapsed. Active work, failures, and unresolved decisions default to expanded. A “return to latest” control appears when the operator scrolls away from the newest turn.

## Living Canvas

The canvas represents the current truth produced by the conversation. It is not another copy of the message transcript.

The latest job referenced by the active conversation becomes the active working set. Operators can switch among other referenced jobs without leaving the thread. The canvas fetches the existing job detail, assets, receipts, events, and verification records and presents them in six views:

- Board: campaign direction, current artifacts, real stage, readiness, and unresolved work.
- Written: X drafts and variants, character validation, policy state, and source traceability.
- Visual: generated images and memes with aspect-ratio metadata.
- Motion: source video, timestamped moments, clips, reels, caption state, and crop-safe previews.
- Audio: uploaded or generated audio assets with real playback and transcript linkage.
- Sources: transcript segments, citations, moment references, and external source links.

No empty media type is simulated. If a job has no audio, generated video, or image artifact, the corresponding view shows a designed empty state describing the exact creation path available. Gemini, Veo, or other model labels appear only when the persisted artifact or receipt identifies that real execution.

Selecting an artifact from chat activates it in the canvas. Selecting a draft, moment, source, or asset in the canvas highlights the linked conversation turn and evidence. Source-to-draft and source-to-media traceability uses existing IDs and references; missing references produce a visible protocol error rather than an inferred link.

## Cross-Media Creation

The composer exposes one prompt field plus real attachment upload. Creation-mode shortcuts are filters and prompt affordances, not independent fake generators:

- Auto compose
- Written
- Image
- Meme
- Clip
- Generated-video concept
- Audio
- Remix

Submitting any mode still uses the existing chat stream, coordinator, typed workflow, durable job pipeline, and approval boundary. The frontend does not call a model or publishing API directly.

## A2UI Placement

A2UI remains the structured rendering protocol, but components are placed according to their product role instead of stacked beneath an assistant bubble:

- `MessageContent`, active `ActivityTrace`, and compact `ToolActivity` remain in conversation.
- `AttachmentCard`, `TaskView`, `PlanView`, `QueueView`, `InlineCitation`, and `ContextUsage` feed the appropriate canvas regions.
- `ReasoningSummary` appears as a collapsed safe summary attached to the relevant agent run.
- `Confirmation` feeds the sticky approval dock and links back to the originating turn.

Unknown components, malformed events, invalid references, and unsafe URLs continue to fail closed visibly.

## Approval Dock

The canvas has a persistent bottom dock when at least one real action awaits a decision. It shows:

- The exact number and types of pending actions.
- Source, policy, caption, verification, and cost state when available.
- The estimated and observed cost values from current budget records.
- Review, approve, and reject controls bound to existing tenant-scoped action IDs.

The dock never implies that approval has occurred. Approving or rejecting uses the existing decision endpoint and refreshes the job, action, conversation checkpoint, and canvas state.

## Visual Direction

The interface uses an editorial creative-studio system rather than a conventional SaaS dashboard:

- Warm paper background with ink-black structural surfaces.
- Electric chartreuse for readiness and creation energy.
- Cobalt, coral, and violet assigned to media types and agent state.
- Large editorial headings paired with compact monospaced operational metadata.
- Asymmetric media compositions and strong art direction, while dense operational detail remains quiet until needed.
- Borders communicate grouping sparingly; the interface must not become a vertical pile of bordered cards.

Dark mode preserves the hierarchy and media colors without reverting to undifferentiated black panels.

## Existing Data and Compatibility

The first implementation uses current APIs and durable records:

- `/api/chat/history`
- `/api/chat/stream`
- `/api/chat/runs/{id}/events`
- `/api/jobs/{id}`
- Existing asset, action-decision, receipt, notification, and upload routes

Chapter labels, collapsed summaries, working-set selection, and trace links derive from current persisted data. The implementation adds no synthetic success state and requires no Firestore migration. Optional presentation preferences such as pane width and selected canvas view may persist locally because they have no workflow or audit meaning.

The Telegram interface, floating chat drawer, public API payloads, Firestore job shapes, Pub/Sub messages, action IDs, receipts, publishing, and approval semantics remain unchanged.

## Loading, Empty, Failure, and Accessibility States

- Each pane has an independent skeleton so slow job hydration does not block conversation history.
- A missing working set leaves chat usable and presents a clear canvas invitation.
- Failed event replay remains visible on its originating turn.
- Failed media displays metadata, retry guidance, and the real error without pretending an asset exists.
- Keyboard navigation covers chapters, messages, canvas tabs, artifacts, and approval actions.
- Focus moves predictably between a conversation artifact reference and its canvas target.
- Status is communicated with text and icons, never color alone.
- Media includes accessible labels, captions where available, and native controls.
- Motion respects reduced-motion preferences.

## Component Boundaries

`ChatConsole` becomes an orchestration shell rather than retaining all rendering logic. The implementation separates:

- `StudioShell`: responsive 2:3 layout and pane state.
- `ConversationPane`: header, chapters, search, virtualized message stream, and composer.
- `ConversationTurn`: operator, assistant, activity, artifact, checkpoint, and error variants.
- `WorkingCanvas`: active job hydration and cross-media view routing.
- `ArtifactBoard`: current campaign direction and artifact overview.
- `WrittenWorkspace`, `VisualWorkspace`, `MotionWorkspace`, `AudioWorkspace`, and `SourcesWorkspace`.
- `ApprovalDock`: trusted pending-action decisions and cost/policy state.
- Pure selectors for chapter assignment, deterministic summaries, active job selection, artifact grouping, and trace-link validation.

The existing trusted A2UI catalog and shared attachment/confirmation elements remain reusable; visual styling changes do not weaken their protocol validation.

## Testing and Acceptance

Automated tests must prove:

- Desktop workspace ratio is 2:3 outside the navigation rail.
- Tablet and mobile use a single-pane switcher at the defined breakpoint.
- Long histories group into the correct deterministic chapters without losing messages.
- Collapsed summaries are derived from persisted values.
- Active and failed activity remain expanded while completed activity collapses.
- Artifact references activate the correct canvas item and reject invalid links.
- Canvas media views render only persisted artifacts.
- The approval dock uses only real pending action IDs and refreshes after decisions.
- Malformed replay data remains a visible failure.
- Keyboard focus can travel from a referenced turn to its canvas artifact and back.
- Existing attachment upload, A2UI protocol, chat stream, decision, and tenancy tests remain green.

Browser acceptance covers a long seeded conversation at desktop, tablet, and mobile widths; written, image, clip, and audio working sets; approval and rejection; loading, empty, failed, and replay-error states; and reduced-motion behavior.
