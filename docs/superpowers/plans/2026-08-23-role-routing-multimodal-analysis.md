# Role-Aware Model Routing and Multimodal Analysis Implementation Plan

> **Historical implementation plan — superseded 2026-08-28.** Its unchecked tasks and earlier model/role assignments do not describe current implementation status. Use [`docs/reference/agent-runtime-inventory.mdx`](../../reference/agent-runtime-inventory.mdx) and [`docs/agents/overview.mdx`](../../agents/overview.mdx).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Harmonia's global-model team with explicit per-role models, run Nimi through a configured Gemma 3 endpoint, and give Sophia direct video evidence while preserving every public and durable pipeline contract.

**Architecture:** A strict `RoleModelCatalog` resolves one model per cognitive role and is injected into the existing ADK hierarchy. Gemini roles remain native ADK models; Nimi uses a `BaseLlm` adapter for a Vertex-hosted Gemma endpoint. The analyst contract gains additive `MediaEvidence`; an ADK before-model callback attaches the authorized public YouTube URI as a real video part, while the transcript remains typed grounding evidence.

**Tech Stack:** Python 3.12, Google ADK 2.7.x, Google Gen AI SDK, Vertex AI endpoints, Gemma 3 12B IT, Gemini 3.5 Flash/Flash-Lite, Pydantic 2, OpenTelemetry, pytest

**Spec:** `docs/superpowers/specs/2026-08-23-managed-multimodel-agent-platform-design.md`

## Global Constraints

- Keep Firestore and Pub/Sub as the durable workflow engine; role routing changes judgment only.
- Preserve `analyze_with_team`, `strategize_with_team`, and `draft_with_team` result contracts.
- No silent model fallback. Missing role configuration, endpoint failure, invalid JSON, and schema violations fail visibly.
- Every configured model must have an explicit budget strategy before dispatch.
- The coordinator, analyst, strategist, editor, and planner use the exact model IDs configured for their roles.
- Nimi uses Gemma only when a concrete Vertex endpoint resource is configured; mock mode remains explicit and offline.
- Multimodal inputs are authorized source references, never trace attributes or Firestore media bytes.
- The planner still sees reviewed drafts only; no approval or publishing tools enter the agent hierarchy.
- Authenticated model behavior remains unverified until separate live evidence is captured.

---

### Task 1: Strict Per-Role Model Catalog

**Files:**
- Create: `agent/harmonia_agent/role_models.py`
- Create: `agent/tests/test_role_models.py`
- Modify: `agent/harmonia_agent/config.py`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `COORDINATOR_MODEL_ID`, `STRATEGIST_MODEL_ID`, `ANALYST_MODEL_ID`, `COPYWRITER_MODEL_ID`, `EDITOR_MODEL_ID`, `PLANNER_MODEL_ID`, and `GEMMA_VERTEX_ENDPOINT`.
- Produces: `RoleModelConfig`, `RoleModelCatalog`, `load_role_model_catalog()`, and `model_for(role)`.

- [ ] **Step 1: Write the failing routing test**

```python
def test_roles_do_not_collapse_to_one_global_model(monkeypatch):
    monkeypatch.setenv("COORDINATOR_MODEL_ID", "gemini-3.5-flash-lite")
    monkeypatch.setenv("STRATEGIST_MODEL_ID", "gemini-3.5-flash")
    monkeypatch.setenv("ANALYST_MODEL_ID", "gemini-3.5-flash")
    monkeypatch.setenv("COPYWRITER_MODEL_ID", "gemma-3-12b-it")
    monkeypatch.setenv("EDITOR_MODEL_ID", "gemini-3.5-flash")
    monkeypatch.setenv("PLANNER_MODEL_ID", "gemini-3.5-flash-lite")
    monkeypatch.setenv(
        "GEMMA_VERTEX_ENDPOINT",
        "projects/p/locations/us-central1/endpoints/123",
    )
    catalog = load_role_model_catalog()
    assert catalog.coordinator.model_id == "gemini-3.5-flash-lite"
    assert catalog.copywriter.provider == "vertex_endpoint"
    assert len({item.model_id for item in catalog.roles()}) >= 3
```

- [ ] **Step 2: Run the test and verify import failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_role_models.py -q`

Expected: FAIL because `harmonia_agent.role_models` does not exist.

- [ ] **Step 3: Implement strict role configuration**

Use frozen Pydantic models with `provider: Literal["gemini", "vertex_endpoint"]`, `model_id`, `max_output_tokens`, `reservation_usd`, and optional `endpoint`. Reject a `vertex_endpoint` role without an endpoint and reject any unknown provider. Defaults are coordinator/planner Flash-Lite, strategist/analyst/editor Flash, and copywriter Gemma 3 12B IT.

- [ ] **Step 4: Run the catalog and configuration tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_role_models.py tests/test_model_catalog.py -q`

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/role_models.py agent/harmonia_agent/config.py agent/tests/test_role_models.py .env.example
git commit -m "feat(agent): configure models by specialist role"
```

---

### Task 2: Vertex Gemma ADK Adapter

**Files:**
- Create: `agent/harmonia_agent/gemma_model.py`
- Create: `agent/tests/test_gemma_model.py`
- Modify: `agent/requirements.txt`
- Modify: `agent/harmonia_agent/usage.py`

**Interfaces:**
- Consumes: an ADK `LlmRequest`, a Vertex endpoint resource, and an injectable async prediction transport.
- Produces: `VertexGemmaModel(BaseLlm)` yielding one normalized `LlmResponse`; endpoint-second usage and a maximum-cost reservation strategy.

- [ ] **Step 1: Write the failing adapter tests**

```python
def test_gemma_adapter_converts_adk_request_and_yields_text():
    calls = []
    async def predict(endpoint, instances, parameters):
        calls.append((endpoint, instances, parameters))
        return {"predictions": [{"content": "{\"drafts\":[]}"}]}
    model = VertexGemmaModel(
        model="gemma-3-12b-it", endpoint="projects/p/locations/r/endpoints/1",
        predict=predict,
    )
    responses = collect(model.generate_content_async(request_with_text("write")))
    assert responses[0].content.parts[0].text == '{"drafts":[]}'
    assert calls[0][0].endswith("/endpoints/1")

def test_gemma_adapter_does_not_fallback_on_transport_failure():
    async def fail(*_args):
        raise TimeoutError("endpoint timeout")
    with pytest.raises(GemmaEndpointError, match="endpoint timeout"):
        collect(VertexGemmaModel(
            model="gemma-3-12b-it",
            endpoint="projects/p/locations/r/endpoints/1",
            predict=fail,
        ).generate_content_async(request_with_text("x")))
```

- [ ] **Step 2: Run and verify import failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_gemma_model.py -q`

- [ ] **Step 3: Implement the adapter**

Flatten system instruction and text parts into the endpoint's chat template, include the JSON schema text when present, call `projects.locations.endpoints.predict`, and normalize only documented `predictions[].content`/`generated_text` shapes. Set `LlmCapabilities(output_schema_and_tools=False)`. Raise `GemmaEndpointError` for transport, missing prediction, and malformed response; never instantiate a Gemini fallback.

- [ ] **Step 4: Add endpoint allocation usage**

Extend `UsageRecord` normalization with `unit_type="endpoint_seconds"`. The reservation uses the configured maximum request allocation; finalized records store measured elapsed seconds and keep `observed_cost_usd` unset until infrastructure allocation evidence exists.

- [ ] **Step 5: Run focused tests and commit**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_gemma_model.py tests/test_usage.py -q`

```bash
git add agent/harmonia_agent/gemma_model.py agent/harmonia_agent/usage.py agent/requirements.txt agent/tests/test_gemma_model.py
git commit -m "feat(agent): add Vertex Gemma model adapter"
```

---

### Task 3: Wire Distinct Models into the ADK Hierarchy

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/tests/test_agent_team.py`
- Modify: `agent/tests/test_cost_reporting.py`

**Interfaces:**
- Consumes: `RoleModelCatalog` and optional fake `RoleModelInstances`.
- Produces: `build_agent_team(models: RoleModelInstances | None = None)` with exact role assignments and usage records labeled by the event author's actual model.

- [ ] **Step 1: Write the failing topology test**

```python
def test_team_assigns_the_configured_model_to_each_role():
    models = scripted_role_models()
    root = build_agent_team(models=models)
    assert root.model.model == "coordinator-fake"
    assert root.find_agent("ryan_strategist").model.model == "strategist-fake"
    assert root.find_agent("sophia_analyst").model.model == "analyst-fake"
    workflow = next(t.agent for t in root.tools if t.name == "flo_draft_workflow")
    assert [a.model.model for a in workflow.sub_agents] == [
        "gemma-fake", "editor-fake", "planner-fake",
    ]
```

- [ ] **Step 2: Run and verify the global-model implementation fails**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_agent_team.py::test_team_assigns_the_configured_model_to_each_role -q`

- [ ] **Step 3: Implement role-aware construction and metering**

Replace the single `_model()` result with explicit coordinator, strategist, analyst, copywriter, editor, and planner instances. Reservation payloads use each role's configured model and strategy. Event accumulation keys on `event.author` and finalizes one immutable record per role operation ID.

- [ ] **Step 4: Run delegation, workflow, and cost tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_agent_team.py tests/test_cost_reporting.py -q`

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/agents.py agent/tests/test_agent_team.py agent/tests/test_cost_reporting.py
git commit -m "feat(agent): route specialists to distinct models"
```

---

### Task 4: Typed Multimodal Evidence and Direct Video Attachment

**Files:**
- Modify: `agent/harmonia_agent/agent_models.py`
- Create: `agent/harmonia_agent/multimodal.py`
- Create: `agent/tests/test_multimodal.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/tests/test_agent_stages.py`

**Interfaces:**
- Consumes: the authorized source URL, source digest, duration, and transcript segments.
- Produces: `MediaEvidence`, `FrameEvidence`, `attach_media_evidence(callback_context, llm_request)`, and visually grounded optional moment fields.

- [ ] **Step 1: Write failing evidence validation tests**

```python
def test_media_evidence_rejects_frames_outside_duration():
    with pytest.raises(ValidationError):
        MediaEvidence(
            video_uri="https://www.youtube.com/watch?v=abc12345678",
            duration_sec=30,
            source_digest="a" * 64,
            frames=[FrameEvidence(id="f1", uri="gs://b/f.jpg", timestamp_sec=31, digest="b" * 64)],
        )

def test_callback_attaches_real_video_part_without_persisting_bytes():
    request = LlmRequest(contents=[types.Content(role="user", parts=[types.Part(text="analyze")])])
    context = callback_context_with_state({"media_evidence": {
        "video_uri": "https://www.youtube.com/watch?v=abc12345678",
        "duration_sec": 60, "source_digest": "a" * 64, "frames": [],
    }})
    attach_media_evidence(context, request)
    assert request.contents[-1].parts[0].file_data.file_uri.startswith("https://www.youtube.com/")
    assert request.contents[-1].parts[0].inline_data is None
```

- [ ] **Step 2: Run and verify missing contracts**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_multimodal.py -q`

- [ ] **Step 3: Implement strict evidence contracts**

Add `media_evidence: MediaEvidence | None` to `AnalystInput`. Add optional `visual_hook`, `crop_suitability`, `caption_safe_region`, and `visual_evidence_ids` to `Moment`. Validate source digests, HTTPS/`gs://` schemes, frame timestamps within duration, and unique frame IDs.

- [ ] **Step 4: Attach media only to Sophia's model request**

Register `attach_media_evidence` as Sophia's `before_model_callback`. Append `types.Part(file_data=types.FileData(file_uri=evidence.video_uri, mime_type="video/mp4"))`; do not add media to coordinator, strategist, drafting, traces, or Firestore request bodies.

- [ ] **Step 5: Seed evidence from the current job**

For YouTube jobs, `run_understand` builds `MediaEvidence(video_uri=job.config.youtubeUrl, duration_sec=job.ingestedDurationSec, source_digest=job.mediaDigest, frames=[])`. Brief-only jobs omit evidence. Persist only the existing `moments`, `angles`, and `summary` fields plus additive optional moment fields.

- [ ] **Step 6: Run focused suites and commit**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_multimodal.py tests/test_agent_stages.py tests/test_agent_team.py -q`

```bash
git add agent/harmonia_agent/agent_models.py agent/harmonia_agent/multimodal.py agent/harmonia_agent/agents.py agent/harmonia_agent/stages.py agent/tests/test_multimodal.py agent/tests/test_agent_stages.py agent/tests/test_agent_team.py
git commit -m "feat(agent): analyze source video as multimodal evidence"
```

---

### Task 5: Documentation, Deployment, and Verification

**Files:**
- Modify: `infra/deploy.sh`
- Modify: `docs/configuration.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/deployment.mdx`
- Modify: `README.md`

**Interfaces:**
- Consumes: role model catalog, Gemma endpoint, multimodal evidence contracts, and existing cost metrics.
- Produces: reproducible configuration and an honest per-role model/cost architecture map.

- [ ] **Step 1: Configure deployment variables**

Deploy the six role model IDs explicitly and pass `GEMMA_VERTEX_ENDPOINT` plus `GEMMA_MAX_COST_USD`. Grant the worker service identity only `aiplatform.endpoints.predict` through the narrowest available Vertex role. Do not configure a fallback model.

- [ ] **Step 2: Update architecture and cost documentation**

Show coordinator Flash-Lite, Ryan/Sophia/Dara Flash, Nimi Gemma endpoint, Temi Flash-Lite, direct video input to Sophia, and per-role cost records. State that the Gemma endpoint cost is a configured allocation estimate until observed endpoint infrastructure evidence is captured.

- [ ] **Step 3: Run the complete offline suite**

```bash
npm run lint
npx tsc --noEmit
npm test
cd agent && ./.venv/bin/python -m pytest tests -q
git diff --check
```

- [ ] **Step 4: Commit documentation**

```bash
git add infra/deploy.sh docs/configuration.mdx docs/architecture.mdx docs/deployment.mdx README.md
git commit -m "docs: map heterogeneous multimodal model routing"
```

## Phase Acceptance Criteria

1. At least three distinct configured model targets are visible in the ADK hierarchy.
2. Nimi is backed by the configured Gemma endpoint and never silently falls back.
3. Sophia receives a genuine video part plus the grounded transcript for YouTube jobs.
4. Brief-only jobs and mock E2E behavior remain deterministic and contract-compatible.
5. Usage and reservations carry the actual role model identifier and pricing strategy.
6. Raw media and content remain absent from traces.
7. All offline suites pass.
8. Live Gemma and multimodal claims remain unverified until captured separately.
