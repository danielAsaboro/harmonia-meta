# GEAR Project A: Evaluation and Model Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit per-role generation/safety policy plus ADK-compatible evaluation, trajectory validation, and quality/cost comparison foundations for Harmonia.

**Architecture:** Extend the existing immutable `RoleModelCatalog` with provider-safe generation and safety policy, then pass that policy into every ADK `Agent`. Add a public, source-neutral evaluation contract and runner compatible with installed ADK 2.7.1; keep authorized demo inputs and real-model result files in the private parent workspace. Deterministic contract evaluators gate authority, grounding, and reference preservation before any rubric-based model comparison.

**Tech Stack:** Python 3.12+, Pydantic 2, Google ADK 2.7.1, Google Gen AI `GenerateContentConfig`, pytest, existing pricing/usage catalog.

**Spec:** `docs/superpowers/specs/2026-08-24-gear-prioritized-hardening-design.md`

## Global Constraints

- Gemini 3.5 or newer is mandatory for the required Gemini roles.
- Firestore remains operational truth; evaluation session state cannot authorize or execute external effects.
- Raw transcripts, private prompts, credentials, and real evaluation outputs stay outside the public repository.
- `HARMONIA_MOCK_AI=1` and scripted models never count as real-model evaluation evidence.
- Raw hidden chain-of-thought is never requested, stored, traced, or evaluated.
- Unknown pricing is not budget-authorized.
- Production code changes follow red-green-refactor.

---

### Task 1: Versioned per-role generation and safety policy

**Files:**
- Modify: `agent/harmonia_agent/role_models.py`
- Modify: `agent/tests/test_role_models.py`

**Interfaces:**
- Produces: `RoleGenerationPolicy`, `RoleModelConfig.generation`, and `RoleModelConfig.policy_version`.
- Consumes: existing `RoleModelConfig`, `RoleModelCatalog`, and environment-based model IDs.

- [ ] **Step 1: Write the failing validation tests**

Add tests proving policy is explicit, immutable, bounded, and role-specific:

```python
def test_every_role_has_versioned_generation_and_safety_policy(monkeypatch):
    monkeypatch.setenv("GEMMA_VERTEX_ENDPOINT", "projects/p/locations/us-central1/endpoints/123")
    catalog = load_role_model_catalog()
    assert all(role.policy_version == "gear-2026-08-24" for role in catalog.roles())
    assert catalog.planner.generation.temperature == 0.1
    assert catalog.analyst.generation.temperature == 0.2
    assert catalog.copywriter.generation.temperature == 0.8
    assert all(role.generation.safety_profile == "harmonia-standard" for role in catalog.roles())


def test_generation_policy_rejects_unbounded_values():
    with pytest.raises(ValidationError):
        RoleGenerationPolicy(
            temperature=2.1,
            top_p=0.9,
            top_k=40,
            safety_profile="harmonia-standard",
        )
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_role_models.py -q`

Expected: failure because `RoleGenerationPolicy`, `generation`, and `policy_version` do not exist.

- [ ] **Step 3: Implement the minimal immutable policy models**

Add:

```python
POLICY_VERSION = "gear-2026-08-24"


class RoleGenerationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    temperature: float
    top_p: float | None = None
    top_k: int | None = None
    safety_profile: Literal["harmonia-standard"] = "harmonia-standard"

    @model_validator(mode="after")
    def validate_bounds(self) -> "RoleGenerationPolicy":
        if not 0 <= self.temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        if self.top_p is not None and not 0 < self.top_p <= 1:
            raise ValueError("top_p must be greater than 0 and at most 1")
        if self.top_k is not None and self.top_k < 1:
            raise ValueError("top_k must be positive")
        return self
```

Add `generation: RoleGenerationPolicy` and `policy_version: str = POLICY_VERSION` to `RoleModelConfig`. Configure routing/planning at `0.1`, grounded analysis/editor/presenter/liaison at `0.2`, strategy at `0.4`, and copywriting at `0.8`; use `top_p=0.9` and omit `top_k` unless the provider supports it consistently.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_role_models.py -q`

Expected: all role-model tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/role_models.py agent/tests/test_role_models.py
git commit -m "feat: add versioned role generation policies"
```

### Task 2: Wire generation and safety configuration into ADK agents

**Files:**
- Create: `agent/harmonia_agent/generation_policy.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/tests/test_agent_team.py`

**Interfaces:**
- Consumes: `RoleModelConfig.generation` from Task 1.
- Produces: `generation_config(config: RoleModelConfig) -> google.genai.types.GenerateContentConfig` and `safety_settings(profile: str) -> list[SafetySetting]`.

- [ ] **Step 1: Write failing wiring and safety tests**

```python
def test_team_applies_role_generation_configurations(monkeypatch):
    monkeypatch.setenv("GEMMA_VERTEX_ENDPOINT", "projects/p/locations/us-central1/endpoints/123")
    root = build_agent_team()
    workflow = next(tool.agent for tool in root.tools if tool.name == "flo_draft_workflow")
    assert root.generate_content_config.temperature == 0.1
    assert workflow.sub_agents[0].generate_content_config.temperature == 0.8
    assert workflow.sub_agents[2].generate_content_config.temperature == 0.1
    assert root.generate_content_config.max_output_tokens == 1024


def test_generation_config_disables_content_capture_and_sets_safety():
    config = generation_config(load_role_model_catalog().analyst)
    assert config.temperature == 0.2
    assert config.max_output_tokens == 2048
    assert config.safety_settings
```

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_agent_team.py -q`

Expected: generation configurations are `None` and helper module is missing.

- [ ] **Step 3: Implement the provider-safe conversion helper**

Create `generation_policy.py` using `google.genai.types.GenerateContentConfig` and `SafetySetting`. The standard profile blocks `HARM_CATEGORY_HATE_SPEECH`, `HARM_CATEGORY_HARASSMENT`, `HARM_CATEGORY_SEXUALLY_EXPLICIT`, and `HARM_CATEGORY_DANGEROUS_CONTENT` at `BLOCK_MEDIUM_AND_ABOVE`. Do not enable thought summaries or content capture.

Set `generate_content_config=generation_config(resolved.config_for(role))` on every `Agent`. Preserve structured-output schemas and existing custom `VertexGemmaModel`; its adapter must consume only supported fields.

- [ ] **Step 4: Verify GREEN and regression coverage**

Run:

```bash
cd agent
./.venv/bin/python -m pytest tests/test_role_models.py tests/test_agent_team.py tests/test_gemma_model.py -q
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/generation_policy.py agent/harmonia_agent/agents.py agent/tests/test_agent_team.py
git commit -m "feat: enforce role generation and safety policy"
```

### Task 3: Deterministic evaluation contracts for outputs and trajectories

**Files:**
- Create: `agent/harmonia_agent/evaluation_contracts.py`
- Create: `agent/tests/test_evaluation_contracts.py`

**Interfaces:**
- Produces: `EvaluationFailure`, `TrajectoryStep`, `EvaluationCaseResult`, `validate_specialist_trajectory`, `evaluate_analysis`, `evaluate_drafts`, `evaluate_action_plan`.
- Consumes: existing `AnalysisResult`, `DraftSet`, `ActionPlan`, and source `MediaEvidence`/transcript bounds.

- [ ] **Step 1: Write failing authority, grounding, and preservation tests**

```python
def test_planner_evaluation_rejects_authority_and_rewritten_text():
    result = evaluate_action_plan(
        reviewed=DraftSet(drafts=[Draft(id="d1", platform="x", text="Reviewed")]),
        plan={"actions": [{"type": "publish_x_post", "text": "Changed", "approvalState": "approved"}]},
    )
    assert {failure.code for failure in result.failures} == {
        "planner_text_mismatch", "planner_claimed_authority",
    }


def test_trajectory_requires_exact_specialist_route():
    result = validate_specialist_trajectory(
        requested="sophia_analyst",
        steps=[TrajectoryStep(kind="delegate", name="ryan_strategist")],
    )
    assert result.passed is False
    assert result.failures[0].code == "wrong_specialist"
```

Add independent tests for out-of-bounds timestamps, quotes absent from normalized transcript text, unknown moment/angle IDs, X text over 280 characters, editor-created IDs, and missing planner actions.

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_evaluation_contracts.py -q`

Expected: import failure because the evaluation module does not exist.

- [ ] **Step 3: Implement pure evaluators**

Use frozen Pydantic models and stable codes. Evaluators must be deterministic, accept already-validated domain models where possible, never call a model, and return all failures rather than stopping at the first one.

- [ ] **Step 4: Verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_evaluation_contracts.py -q`

Expected: all evaluator tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/evaluation_contracts.py agent/tests/test_evaluation_contracts.py
git commit -m "feat: add Harmonia evaluation contracts"
```

### Task 4: ADK 2.7 evalset loader and private-result boundary

**Files:**
- Create: `agent/harmonia_agent/evaluation_runner.py`
- Create: `agent/evals/README.md`
- Create: `agent/evals/contracts.evalset.json`
- Create: `agent/tests/test_evaluation_runner.py`
- Modify: `agent/requirements.txt`

**Interfaces:**
- Produces: `load_eval_set(path: Path) -> google.adk.evaluation.eval_set.EvalSet`, `validate_eval_set_privacy(eval_set: EvalSet) -> None`, and CLI `python -m harmonia_agent.evaluation_runner --evalset PATH --output PATH`.
- Consumes: installed ADK 2.7.1 `EvalSet`, `EvalCase`, and `AgentEvaluator.evaluate_eval_set`.

- [ ] **Step 1: Write failing loader/privacy tests**

```python
def test_public_evalset_is_adk_pydantic_valid():
    eval_set = load_eval_set(Path("evals/contracts.evalset.json"))
    assert eval_set.eval_set_id == "harmonia-contracts-v1"
    assert {case.eval_id for case in eval_set.eval_cases} >= {
        "route-analyst", "planner-no-authority", "liaison-read-only",
    }


def test_public_evalset_rejects_private_source_material(tmp_path):
    path = tmp_path / "bad.evalset.json"
    path.write_text(json.dumps({
        "eval_set_id": "bad", "eval_cases": [{
            "eval_id": "leak",
            "conversation": [{"user_content": {"parts": [{"text": "raw transcript: secret"}]}}],
        }],
    }))
    with pytest.raises(EvaluationPrivacyError, match="private source marker"):
        load_eval_set(path)
```

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_evaluation_runner.py -q`

Expected: loader and public evalset do not exist.

- [ ] **Step 3: Implement the ADK-native loader and CLI**

Parse with `EvalSet.model_validate_json`. Enforce an allow-list of public fixture labels and reject transcript/media URI/credential markers. The CLI requires `HARMONIA_REAL_EVAL=1` for any live model run, refuses `HARMONIA_MOCK_AI=1`, accepts a private input path, and writes results only to the explicit output path. It calls `AgentEvaluator.evaluate_eval_set` with an explicit `EvalConfig`; it never embeds private results in the package.

Pin the supported range already used by the application (`google-adk>=2.7,<3`) and document that ADK conformance recording is conditional on the installed release exposing the command; evalset execution is mandatory.

- [ ] **Step 4: Verify GREEN and CLI refusal behavior**

Run:

```bash
cd agent
./.venv/bin/python -m pytest tests/test_evaluation_runner.py -q
HARMONIA_MOCK_AI=1 ./.venv/bin/python -m harmonia_agent.evaluation_runner --evalset evals/contracts.evalset.json --output /tmp/harmonia-eval.csv
```

Expected: tests pass; CLI exits non-zero with an explicit refusal to run real evaluation in mock mode.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/evaluation_runner.py agent/evals agent/tests/test_evaluation_runner.py agent/requirements.txt
git commit -m "feat: add ADK-native evaluation runner"
```

### Task 5: Evaluation-backed model and cost comparison report

**Files:**
- Create: `agent/harmonia_agent/evaluation_report.py`
- Create: `agent/tests/test_evaluation_report.py`
- Modify: `docs/configuration.mdx`

**Interfaces:**
- Produces: `RoleEvaluationRecord`, `RoleComparison`, `compare_role_candidates(records)`, and CLI JSON/Markdown output.
- Consumes: eval case pass/fail results, latency milliseconds, immutable usage records, pricing version, model-policy version.

- [ ] **Step 1: Write failing selection tests**

```python
def test_candidate_must_meet_quality_floor_before_cost_selection():
    comparison = compare_role_candidates([
        record("gemini-3.5-flash", pass_rate="1.0", cost="0.020000", latency_ms=900),
        record("gemini-3.5-flash-lite", pass_rate="0.7", cost="0.005000", latency_ms=400),
    ], minimum_pass_rate="0.95")
    assert comparison.selected_model == "gemini-3.5-flash"
    assert comparison.rejected[0].reason == "below_quality_floor"


def test_unknown_cost_cannot_be_selected():
    comparison = compare_role_candidates([
        record("unknown", pass_rate="1.0", cost=None, latency_ms=100),
    ], minimum_pass_rate="0.95")
    assert comparison.selected_model is None
    assert comparison.rejected[0].reason == "unknown_cost"
```

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_evaluation_report.py -q`

Expected: report module does not exist.

- [ ] **Step 3: Implement deterministic comparison**

Use `Decimal` for rates and cost. Filter candidates below the configured role quality floor or with unknown pricing. Rank remaining candidates by pass rate descending, then estimated cost ascending, then p95 latency ascending. Preserve every rejected reason and both configuration versions.

- [ ] **Step 4: Verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_evaluation_report.py tests/test_cost_reporting.py -q`

Expected: all report and existing cost tests pass.

- [ ] **Step 5: Document and commit**

Document the private real-evaluation command and explain that the catalog default changes only after a recorded comparison meets the threshold.

```bash
git add agent/harmonia_agent/evaluation_report.py agent/tests/test_evaluation_report.py docs/configuration.mdx
git commit -m "feat: compare role quality latency and cost"
```

### Task 6: Project A verification and public contract documentation

**Files:**
- Modify: `docs/architecture.mdx`
- Modify: `docs/configuration.mdx`
- Modify: `README.md`

**Interfaces:**
- Consumes: all Project A interfaces.
- Produces: public role-policy matrix and exact offline/live verification commands.

- [ ] **Step 1: Add the role-policy matrix**

Document role, model, temperature, safety profile, maximum output, pricing version, quality floor, evaluation cases, state access, tools, and prohibited authority. Label real evaluation evidence as pending until its private output exists.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run test:agent
npx eslint src tests
npm run build
git diff --check
```

Expected: 0 test failures, 0 scoped lint errors, successful production build, and no whitespace errors. Existing warnings must be reported exactly rather than described as clean.

- [ ] **Step 3: Verify the requirement slice**

Confirm from current files that every role has policy, every ADK agent receives it, deterministic contract evaluators cover all listed authority/grounding rules, the public evalset parses with ADK 2.7.1, mock mode cannot run the real-eval CLI, and model comparison refuses unknown pricing.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.mdx docs/configuration.mdx
git commit -m "docs: publish agent evaluation and policy contract"
```

- [ ] **Step 5: Record Project A status privately**

Update parent-level evidence with commit IDs, command outputs, remaining authenticated-evaluation requirements, and no production-success claim until the live run is captured. Do not add the private evidence file to the public repository.
