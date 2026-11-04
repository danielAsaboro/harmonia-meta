# Harmonia

**Harmonia is an asynchronous social media content agent for startups.** An operator can begin with ordinary language rather than internal product vocabulary. Harmonia reads the durable workspace context, identifies the intended outcome, checks connected platforms, asks only for genuinely blocking information, and creates the appropriate durable content job. Nimi extracts evidence, Ryan proposes a four-week strategy for human approval, Temi operationalizes approved briefs, Noni and Dara produce reviewed typed artifacts, and deterministic code authorizes and verifies exact effects.

The dashboard and authenticated web chat are active operator surfaces. Telegram’s official Bot API integration routes ordinary allow-listed messages through the canonical chat router, configures its webhook through `setWebhook`, and retains the nonce-bound inline-button approval boundary. Those paths are covered locally but are not live-evidenced against a real bot, so Telegram is not yet claimed as a production-verified equivalent surface.

The repository also implements governed resident autonomy: an hourly Heartbeat, post-outcome Micro-reflections, a budget-gated nightly Dream Cycle, a morning Wakeup Call with durable agendas, bounded experiments, conservative tuning, and rollback. Its schedules are disabled by default, not deployed, and not authenticated evidence. See [`docs/resident-autonomy.mdx`](./docs/resident-autonomy.mdx).

> **Evidence status:** every model call goes to Meta Model API. Authenticated Meta runs have not been captured yet.

To prove the calls with a key set, run one live request to every model Harmonia uses (Muse Spark, Muse Wonder, Muse Voice Transcribe, SAM 3.1, token counting, `/status`, plus Muse Spark Open when `BASETEN_API_KEY` is set). The report keeps only model ids, request ids, latency and usage:

```bash
cd agent && .venv/bin/python -m harmonia_agent.meta_probe --out ../evidence/meta-probe.json
```

The public, read-only [`/proof`](./src/app/proof/page.tsx) page (and `/api/proof` as JSON) shows Meta's live `/status`, that committed probe report, the running agent roster with a digest of each agent's definition, and every recorded run in `evidence/replays/` released as `approved_public_bundle`. Each request re-verifies each bundle's integrity and terminal-state digest, and anything missing is shown as missing.

## Why Harmonia is an agent—and where it deliberately is not

Harmonia is agentic where the problem is ambiguous: Muse Spark specialists, organized with Google ADK, interpret multimodal source material, identify grounded moments and angles, produce and review typed content artifacts, and propose bounded actions. It is deliberately deterministic where mistakes have consequences: Firestore/Pub/Sub progression, schema validation, cost reservation, policy, approval, idempotent execution, receipts, and independent verification. Humans retain final publishing authority. This is bounded agency inside a durable workflow, not an unrestricted model loop; the full stage/authority and KPI contract is in [`docs/operational-model.mdx`](./docs/operational-model.mdx).

## The pipeline

Harmonia runs as an asynchronous, event-driven workflow on Pub/Sub. A single job travels across two services with durable state in Firestore at every step:

```
collect_sources → extract_sources → understand → strategize → awaiting_strategy_approval → plan → draft → awaiting_approval → publish → verify
```

- **Collect sources**: resolve the sealed job manifest, including up to ten direct inputs and one immutable snapshot from a scheduled Google Drive or Cloud Storage brand library.
- **Extract sources**: normalize authorized video, audio, documents, web pages, and pasted text into digest-bound segments. Muse Voice Transcribe produces timed speech segments, and Muse Spark watches uploaded video to add timed visual observations, each anchored to a stored frame still, and reads uploaded images for their visible text and content; deterministic extractors handle written sources.
- **Understand**: Nimi receives the typed normalized source bundle and returns strict source analysis with exact segment/frame references, evidence-kind provenance, assumptions, and confidence. Deterministic code validates quotes, time bounds, references, and authority; then persists the complete analysis and canonical digest.
- **Strategize**: Ryan uses typed company, campaign, audience, performance, and eligible workspace memory to propose a provenance-linked four-week strategy and complete content briefs. A human must approve the exact strategy digest before Temi runs.
- **Plan**: deterministic code persists a tenant-scoped planning snapshot and activates `temi-editorial-planning-skills` with its approved references. Temi receives that immutable snapshot directly, without loader or read tools. Deterministic code validates snapshot and plan digests, persists the bounded plan, and selects exactly one supported, eligible item; Temi cannot search, write final copy, mutate calendars, or authorize effects.
- **Draft**: Noni receives the approved output plan and exact referenced evidence, then produces the requested typed artifact batch. Dara applies seven format-aware checks; deterministic code permits at most one issue-bound revision, seals immutable accepted artifacts, and derives effects from their exact digests.
- **Awaiting approval**: X and LinkedIn publishing, content-pack export, clip rendering, and paid Muse Image generation wait for exact operator approval. Constituent artifact exports are internal effects; neither export nor local ffmpeg rendering implies public publication.
- **Publish**: executable actions run idempotently. Official publishers currently cover X posts, resumable X threads, and LinkedIn posts. Every accepted written/spec artifact is exportable as canonical JSON plus deterministic Markdown; a content-pack command is dependency-bound and cannot run until every constituent export has independently completed.
- **Verify**: provider effects are confirmed by fresh independent API reads and internal artifacts by digest read-back — never because a model said so.

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        U[Operator browser]
        C[Chat drawer]
        T[Telegram bot]
    end

    subgraph "Cloud Run — harmonia-web (Next.js)"
        UI[Operator dashboard]
        CHAT["POST /api/chat<br/>Muse Spark structured-output intents"]
        A2UI["Trusted A2UI hydrator<br/>persisted state → native workspace"]
        API[Job / approval / retry API]
        INT[Internal stage API<br/>Bearer-token scoped]
    end

    subgraph "Cloud Run — harmonia-agent (Python ADK worker)"
        PUSH["Pub/Sub push receiver"]
        TG["Telegram webhook boundary<br/>not live-verified"]
        STAGES[collect sources · extract sources · understand · strategize ·<br/>strategy approval · plan · draft · publish · verify handlers]
        RUNTIME[ADK in-process runner]
        MAYA["Maya presentation specialist<br/>reference-only SurfacePlan"]
    end

    PS[[Pub/Sub topic]]
    OUTBOX[(Firestore stage outbox)]
    TICK[Cloud Scheduler<br/>OIDC durable tick]
    FS[(Firestore<br/>jobs · events · receipts)]
    MB[(Workspace memory in Firestore<br/>workspace + brand scope)]
    MUSE[Meta Model API<br/>Muse Spark · web_search]
    MEDIA[Muse Voice Transcribe · Muse Image · SAM 3.1]
    YT[YouTube]
    X[X API v2]

    U --> UI --> API
    C --> CHAT --> API
    CHAT --> A2UI
    A2UI -- bounded IDs + summaries --> MAYA
    MAYA --> RUNTIME
    MAYA -- component graph + references --> A2UI
    T -- secret-verified webhook<br/>not live-evidenced --> TG -- same intent contract --> CHAT
    T -- inline-button approvals --> API
    API -- transition + pending trigger<br/>one transaction --> OUTBOX
    OUTBOX -- claimed publication --> PS
    TICK -- recover outbox + due work --> PUSH
    API <--> FS
    PS -- push subscription --> PUSH --> STAGES
    STAGES --> RUNTIME <--> MUSE
    STAGES <--> MB
    STAGES -- transcription + approved images --> MEDIA
    STAGES -- authorized media extraction --> YT
    STAGES -- publish + verify --> X
    STAGES -- results --> INT --> FS
```

### Separation of concerns

| Concern | Where | Interface |
|---|---|---|
| Collection and extraction | source registry + `agent/harmonia_agent/extraction/` | immutable manifests, scheduled library snapshots, bounded normalization, and authorized media download |
| Understanding / artifact production | `agent/harmonia_agent/content.py`, `content_artifacts.py`, `agents.py` | Muse Voice Transcribe media extraction, multimodal Nimi, Ryan strategy, Temi planning, typed multi-format Noni production, and Dara review |
| Intent routing (chat + Telegram) | Harmonia ADK router + web `src/lib/chatIntent.ts` | typed outcome, sources, output concepts, platform recommendations, connection suggestions, assumptions, clarification state, and strategy context |
| Generative interface composition | ADK `maya_presenter` + web `src/lib/a2ui/` | exact-context, reference-only `SurfacePlan`; deterministic validation and server hydration from authenticated Firestore records |
| Approval gate | web `src/lib/policy.ts`, `src/lib/decisions.ts` | deterministic risk rules; single decision writer shared by REST, chat, and Telegram |
| Effects | `agent/harmonia_agent/effect_executor.py` | immutable export plus official X post/thread and LinkedIn publishers, all idempotent |
| Verification | `agent/harmonia_agent/stages.py`, `artifact_export.py` | fresh provider reads and exact dual-object byte verification |
| Operator surfaces | dashboard UI, `/api/chat`, `telegram_bot.py` | identical grammar; Google session or workspace-scoped Telegram identity; shared approval gate |

## Technology

- **Meta Model API for every model call**: Muse Wonder 1.0 for Ryan's month-long strategy, Muse Spark 1.3 for routing, planning, multimodal analysis, skill-backed copywriting, editing, and presentation, each role with its own reasoning effort, output limit, and timeout. Any role can move to open-weight Muse Spark Open on Baseten with `*_PROVIDER=baseten`. Research uses Meta Model API's built-in `web_search`; transcription uses Muse Voice Transcribe; image generation uses Muse Image; SAM 3.1 tracks the speaker so vertical and square clips pan to follow them instead of losing the frame. Meta has no video or music model, so Harmonia generates neither.
- **Bounded Noni writing skill**: Noni loads `noni-writing-skills` and approved local references covering thought leadership, introductions, MECE structure, case studies, storytelling, diagnosis, persuasion, outlines, titles, and convincing content. It may then read verified prior publications or use Meta Model API web search through a brief-bound research tool. Guidance never counts as evidence, and every web-derived claim must match Meta's returned search results or URL citations.
- **Google ADK** (Python, open source) organizes the specialist team in-process inside the worker; it calls Muse models through LiteLLM's OpenAI-compatible adapter.
- **Google A2UI v0.9 wire protocol**, rendered with pinned `@a2ui/react` 0.10.2 and `@a2ui/web_core` 0.10.6 packages. Maya chooses a graph from Harmonia’s fixed campaign vocabulary; the web server resolves every draft, moment, action, asset, and receipt reference from authenticated persisted state before the official renderer sees it.
- **Workspace memory** in Firestore carries exact-scope facts across jobs; Firestore/Pub/Sub remain the durable workflow engine.
- **Cloud Run** hosts both services (web: Next.js standalone build; agent: Python container).
- **Firestore** persists job state, stage events, approvals, receipts, verifications, and packets.
- **Pub/Sub** drives every stage transition; transient failures nack for redelivery, permanent failures stay visible.
- **Google ADK observability + OpenTelemetry** export metadata-only structured logs, standard agent/tool/token metrics, and W3C-correlated traces to Cloud Logging, Cloud Monitoring, and Cloud Trace. A tenant-scoped Firestore projection powers the paginated, filterable **Monitoring → Agent activity** view. The product does not collect prompts, responses, drafts, transcripts, or private chain-of-thought in telemetry.

## Local spin-up

Prerequisites: Node 20+, Python 3.12+, [`gcloud` CLI](https://cloud.google.com/sdk/docs/install), a registered Identity Platform web application with Google sign-in enabled, and a Meta Model API key from [dev.meta.ai](https://dev.meta.ai/) for real judgment calls. Firestore and Pub/Sub use local emulators; identity remains real.

```bash
git clone https://github.com/danielAsaboro/harmonia-meta.git
cd harmonia-meta
npm install
cp .env.example .env.local   # set Identity Platform, internal service, and MODEL_API_KEY
./scripts/dev.sh             # Firestore + Pub/Sub emulators, web :3000, ADK worker
```

Open http://localhost:3000, continue with Google, then start a content run from an authorized URL, uploaded file, pasted source material, or content brief. The primary authenticated demo path uses a licensed video attachment through the production malware scanner; YouTube is an optional network-dependent route. A real cognitive job also requires the managed resources listed in [Configuration](./docs/configuration.mdx) and may incur provider charges. For a no-spend inspection, use the clearly labeled local fixtures; they prove UI and data contracts, not authenticated Meta Model API execution. Approve or reject proposed actions with the trusted action control when the job reaches the approval gate.

For a video-plus-pack run, request a supported written output (such as a LinkedIn draft), a short clip, and a content pack explicitly. A pack packages child content; it does not implicitly authorize every output format. If intake omitted an output and the job failed before strategy, use **Correct requested outputs** in the canvas, save the exact selection, then retry after the underlying failure is fixed. Corrections are tenant-scoped, epoch-checked, and audited; they do not approve or execute effects. Clip rendering requires its own approval. Every rendered clip then passes a measured gate: ffmpeg checks the file for dead air at either edge, black frames, lost audio, long pauses and words clipped at the cut. Edge dead air is trimmed and the clip rendered once more, and the version with fewer faults is delivered, so a fix can never make the delivered clip worse. The receipt and the job's Actions tab show each version's measurements. Independent asset verification rereads stored bytes and recomputes SHA-256; missing bytes cannot pass verification.

### Google Calendar synchronization

Harmonia can put scheduled content on a dedicated **Harmonia Content Calendar** in the operator’s Google Calendar account. Enable the Google Calendar API, configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register this redirect URI for each deployed origin:

```text
https://YOUR_ORIGIN/api/oauth/google-calendar/callback
```

Connect **Google Calendar** under Settings, then open a scheduled item and explicitly choose **Add**, **Update**, or **Remove**. Harmonia requests only `calendar.app.created`; it cannot read unrelated calendars or events. It records success only after Google API read-back verifies the event or its removal.

See [How to sync content with Google Calendar](./docs/google-calendar.mdx) for setup and recovery, and the [Google Calendar sync reference](./docs/google-calendar-reference.mdx) for endpoint, state, idempotency, and verification contracts. Local tests do not prove a live Google account.

For generated campaign workspaces, `AGENT_SERVICE_URL` must point to the FastAPI worker (normally `http://localhost:8080` locally), `INTERNAL_API_TOKEN` must match across both services, and `MODEL_API_KEY` must be configured. There is deliberately no local-model or deterministic production fallback for presentation planning.

> Full documentation lives in [`docs/`](./docs) — a Mintlify site covering the [architecture](./docs/architecture.mdx), [pipeline](./docs/pipeline.mdx), the [proactive agent](./docs/proactive-agent.mdx), offline mock modes, configuration, and deployment.

### Operator chat

Click the chat bubble on the dashboard (or `POST /api/chat` with `{message}`):

```
"create a job from https://youtu.be/<id>"
"status of job <id>"          # or just "status"
"show artifacts for <id>"
"approve job <id>"            # opens deterministic confirmation; text is not authority
```

All chat reads and mutations use the verified Google session and active workspace. Intent parsing never selects tenant identity.

The full Console additionally uses a durable `POST /api/chat/stream` NDJSON transport and a strict Harmonia catalog rendered by Google’s official A2UI React packages. The managed Maya specialist can compose three independent revisions—conversation, working canvas, and approval—from `CampaignBrief`, `JobProgress`, `MomentExplorer`, `DraftComparison`, `PlatformPreview`, `SourceEvidence`, `ApprovalReview`, and `VerificationReceipt`. Its output contains references and layout only. Matching Python and TypeScript validators bind every node to the exact supplied job/entity catalog and permit approval presentation only for one supplied pending action in the approval slot. Full draft copy, transcript excerpts, action risk, approval state, asset routes, and receipts are hydrated server-side from the active persisted job. Loading, empty, unresolved, and failure components are host-owned. If optional A2UI presentation fails after a durable chat mutation, the mutation remains successful and the stream returns a truthful presentation warning.

Generated approval detail never owns authorization controls. The existing server-protected approval dock remains authoritative and validates the persisted `jobId + actionId` before making a decision request. Raw hidden chain-of-thought is never requested or displayed.

### Telegram integration status

The repository contains an allow-listed, secret-verified webhook path with one-time approval nonces. Settings calls Telegram’s official `setWebhook`; ordinary messages use the same intent router as web chat; replies use the official `sendMessage` endpoint; and approval still requires an inline-button callback. The older long-poll path is not a production surface. Live bot setup, message submission, and approval evidence remain intentionally unverified.

Run tests:

```bash
npm test                     # TypeScript: policy gate, idempotency, state machine, packet assembly
npm run test:integration     # required Firestore transaction suite; starts its own emulator
npm run lint                 # Next.js / React / TypeScript lint
npx tsc --noEmit             # complete TypeScript check
npm run build                # production Next.js build
npm run test:agent           # Python: source extraction, Telegram callbacks, failure classification
```

Re-anchor persisted Firestore history while preserving event order and elapsed gaps:

```bash
npm run history:reanchor -- --dry-run
npm run history:reanchor
```

The default origin is `2026-08-27T00:00:00.000Z`. Pass `--target <ISO timestamp>` to select another origin. The command traverses root collections and every nested subcollection, preserves native Firestore `Timestamp` and JavaScript `Date` values, and closes non-terminal worker-facing records before they can be reclaimed. It does not change the host clock.

Agent evaluation foundations live under `agent/evals/`: ADK-native public contract fixtures,
deterministic grounding/authority checks, and a quality-cost-latency comparison report. Live model
evaluation requires `HARMONIA_REAL_EVAL=1`, refuses mock mode, and must write authorized source
inputs and results to the private parent evidence workspace. See
[`docs/configuration.mdx`](./docs/configuration.mdx) for the exact commands. Passing offline tests
is not presented as authenticated Meta Model API or deployment proof.

Authenticated demo claims follow the fail-closed
[`docs/evidence-runbook.mdx`](./docs/evidence-runbook.mdx): read-only preflight, a capture at the
human approval gate, a post-effect capture, independent verification, and idempotent replay proof.
Raw evidence stays in the private parent workspace; `npm run verify:evidence` validates only the
redacted consistency bundle.

## Deploy to Google Cloud

One-time bootstrap, then repeatable deploys:

```bash
gcloud auth login
export PROJECT_ID=your-project-id
export REGION=us-central1
export FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
export FIREBASE_APP_ID=your-web-app-id

export MODEL_API_KEY=...      # stored as the model-api-key secret
./infra/setup.sh             # enables APIs, Firestore, topics, SAs, IAM, secrets
./infra/deploy.sh            # builds both services via Cloud Build, deploys to Cloud Run,
                             # wires the Pub/Sub push subscription
```

Google sign-in creates an isolated owner workspace. Customer jobs, memory, connections, Telegram configuration, budgets, logs, and artifacts remain workspace-scoped. The agent accepts only Pub/Sub push invocations authenticated through Cloud Run IAM and runs the ADK team in-process, calling Meta Model API for every judgment step. Deployment rejects Firestore, storage, or Pub/Sub persistence outside the selected region.

## Security and reliability model

- **Minimum permissions**: two dedicated service accounts; web gets datastore + pubsub publisher, agent gets datastore + secretAccessor. Platform tokens are scoped to what they publish.
- **Untrusted-source screen**: transcripts, web pages, documents and image text can contain instructions aimed at the agents. Before Nimi reads anything, deterministic rules strip invisible characters and quarantine injection patterns. With `GLIMMER_BASE_URL` set, Meta's open-weight Muse Glimmer then screens the rest on hardware the operator controls. It can only add a quarantine; it can't clear a rule's verdict or approve anything. Quarantined segments are withheld from every specialist and reported by id and rule in the job timeline. If every segment is quarantined, the job refuses to continue.
- **Human approval gate**: publishing requires an explicit approval per action. Chat can propose; only token-holding operators decide. On Telegram, decisions require an inline-button tap scoped to the allow-listed chat.
- **Idempotency**: every action carries a stable key derived from `(jobId, actionId, contentHash)` and atomically claims it before any external effect; duplicate deliveries return `already_applied` with the original receipt identity instead of creating duplicate posts. Only explicit operator replay persists a replay observation.
- **Audit receipts**: each actual effect attempt records its applied or failed outcome, artifact URL, and platform response in Firestore. Duplicate suppression references that immutable receipt rather than creating another one.
- **Resumable state**: jobs survive worker crashes; Pub/Sub redelivery plus server-side stage guards (`assertTransition`) prevent duplicated side effects. Failed jobs retry from their failure point.
- **Operational control plane**: Monitoring → Jobs combines a durable needs-you inbox with compact lifecycle/progress shells and version-fenced Pause, Resume, and Cancel commands. Sequence cursors survive browser reconnects.
- **Large-batch foundation**: immutable GCS manifests fan out deterministic work IDs through a bounded Pub/Sub dispatcher; Firestore leases, epochs, retry budgets, dead letters, and fan-in outcomes keep workers horizontally scalable without granting them effect authority.
- **Cognition without split-brain state**: each specialist call runs in a fresh in-memory ADK session that never authorizes workflow changes; workspace memory accepts only eligible durable facts under exact workspace/brand scope.
- **Long-horizon context**: Firestore preserves the resumable workflow and audit ledger across worker restarts. Workspace memory is designed to carry only approved decisions, verified outcomes, learn-stage counts, and explicit preferences into later jobs; authenticated cross-job retrieval remains an evidence gate, not a completed public claim.
- **Production-data boundary**: tenant identity is derived server-side, traces contain metadata rather than prompts or customer content, and deployment enforces one selected Google Cloud region across stateful services.
- **Failure honesty**: permanent failures are preserved as visible unresolved gaps; errors never become simulated success.

## Project structure

```
harmonia/
├── src/
│   ├── app/api/                  # REST + internal APIs + POST /api/chat (NL ops surface)
│   ├── components/               # dashboard, job console, chat drawer
│   └── lib/                      # types, config, Firestore/Pub/Sub adapters,
│                                 # policy engine, decision writer, intent parser
├── agent/
│   ├── harmonia_agent/          # FastAPI worker, ADK agents, Meta Model API, YouTube/X,
│   │                             # Telegram webhook and nonce approval boundary
│   └── tests/                    # pytest units
├── infra/                        # setup.sh (one-time) and deploy.sh (revisions)
├── scripts/dev.sh                # emulator-based local loop
└── tests/                        # vitest units
```
