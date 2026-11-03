"""Deterministic quality and authority checks for agent evaluation."""

import json
from pathlib import Path

import pytest

from harmonia_agent.agent_models import AnalystInput, SourceAnalysis
from harmonia_agent.evaluation_contracts import (
    TrajectoryStep,
    evaluate_analysis,
    evaluate_content_draft,
    evaluate_draft_workflow,
    evaluate_editorial_assessment,
    evaluate_liaison_answer,
    evaluate_surface_plan,
    evaluate_strategy,
    evaluate_editorial_plan,
    evaluate_production_handoff,
    validate_specialist_trajectory,
)
from tests.test_noni_contracts import grounded_draft, original_input, revise_review
from tests.test_dara_contracts import passing_assessment
from tests.test_temi_editorial_plan import plan, planner_input, production_input
from tests.test_ryan_strategy import strategist_input, strategy
from harmonia_agent.ryan_skills import RYAN_SKILL_NAME, RYAN_SKILL_REFERENCES
from harmonia_agent.temi_skills import TEMI_SKILL_NAME, TEMI_SKILL_REFERENCES


def _ryan_trace():
    return [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": RYAN_SKILL_NAME}},
        {"sequence": 2, "name": "load_skill_resource", "args": {"skill_name": RYAN_SKILL_NAME, "file_path": RYAN_SKILL_REFERENCES[0]}},
    ]


def _temi_trace():
    snapshot_id = planner_input()["planningSnapshot"]["snapshotId"]
    return [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": TEMI_SKILL_NAME}},
        {"sequence": 2, "name": "load_skill_resource", "args": {"skill_name": TEMI_SKILL_NAME, "file_path": TEMI_SKILL_REFERENCES[0]}},
        {"sequence": 3, "name": "read_editorial_commitments", "args": {"snapshot_id": snapshot_id}, "response": {"snapshotId": snapshot_id, "commitments": []}},
    ]
from tests.test_nimi_contracts import analyst_input, source_analysis
from tests.test_a2ui_models import context_payload


def _analysis(**moment_overrides) -> SourceAnalysis:
    moment = {
        "id": "m1",
        "title": "Proof",
        "startSec": 2,
        "endSec": 8,
        "hook": "A real result",
        "quote": "we cut nine days to forty hours",
        "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [],
        "assumptions": [], "confidence": "high",
    }
    moment.update(moment_overrides)
    return SourceAnalysis.model_validate({
        "sourceDigest": "a" * 64,
        "summary": "A useful result.",
        "moments": [moment],
        "angles": [{
            "id": "a1", "angleType": "source_insight", "evidenceKind": "source", "title": "Speed",
            "rationale": "The source describes speed.", "evidenceRefs": ["m1"],
            "assumptions": [], "confidence": "high",
        }],
        "assumptions": [], "confidence": "high",
    })


def test_trajectory_requires_exact_specialist_route():
    result = validate_specialist_trajectory(
        requested="nimi_analyst",
        steps=[TrajectoryStep(kind="delegate", name="ryan_strategist")],
    )

    assert result.passed is False
    assert result.failures[0].code == "wrong_specialist"


def test_liaison_evaluation_requires_exact_tool_and_evidence_citation():
    trace = [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": "job-status"}, "response": {"loaded": "job-status"}},
        {"sequence": 2, "name": "get_job_status", "args": {"job_id": "j1"}, "response": {
            "status": "success", "data": {"found": True}, "error": None,
            "evidence": [{"evidenceId": "ev-aaaaaaaaaaaaaaaa", "source": "harmonia_firestore_job", "provenance": "live", "reference": "j1"}],
        }},
    ]
    passing = evaluate_liaison_answer(answer={
        "status": "success", "answer": "Job j1 is active [ev-aaaaaaaaaaaaaaaa].", "skillName": "job-status",
        "claims": [{"text": "Job j1 is active", "evidenceIds": ["ev-aaaaaaaaaaaaaaaa"]}], "error": None, "uncertainty": [],
    }, trace=trace)
    assert passing.passed
    bad_answer = {"status": "success", "answer": "I approved and published it [invented].", "skillName": "job-status",
                  "claims": [{"text": "I approved and published it", "evidenceIds": ["invented"]}], "error": None, "uncertainty": []}
    assert evaluate_liaison_answer(answer=bad_answer, trace=trace).failures[0].code == "invalid_liaison_answer"


def test_nova_public_fixture_catalog_covers_adversarial_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "nova_contract_cases.json"
    ids = {case["id"] for case in json.loads(fixture_path.read_text())["cases"]}
    assert ids == {"grounded-answer", "wrong-skill", "wrong-tool", "missing-evidence", "invented-reference",
                   "authority-overreach", "hidden-error", "invalid-retry", "false-no-data"}


def test_analysis_rejects_out_of_bounds_time_and_ungrounded_quote():
    supplied = analyst_input()
    candidate = source_analysis()
    candidate["moments"][0]["quote"] = "words absent from the source"
    result = evaluate_analysis(analyst_input=supplied, analysis=candidate)
    assert result.failures[0].code == "missing_evidence"


@pytest.mark.parametrize(("mutation", "code"), [
    (lambda value: value["moments"][0].update(sourceSegmentRefs=["invented"]), "invented_reference"),
    (lambda value: value["angles"][0].update(evidenceRefs=["memory-1"]), "invalid_evidence_kind"),
    (lambda value: value.update(summary="I approved and published the campaign"), "authority_overreach"),
    (lambda value: value["moments"][0].pop("confidence"), "incomplete_analysis"),
])
def test_nimi_evaluation_covers_grounding_authority_and_completeness(mutation, code):
    candidate = source_analysis()
    mutation(candidate)
    assert evaluate_analysis(analyst_input=analyst_input(), analysis=candidate).failures[0].code == code


def test_nimi_evaluation_accepts_memory_with_provenance_and_uncertainty():
    candidate = source_analysis()
    candidate["angles"].append({
        "id": "angle-memory", "angleType": "memory_learning", "evidenceKind": "memory", "title": "Concise proof",
        "rationale": "Eligible prior learning suggests concise proof.",
        "evidenceRefs": ["memory-1"], "assumptions": ["The preference remains applicable."],
        "confidence": "medium",
    })
    assert evaluate_analysis(analyst_input=analyst_input(), analysis=candidate).passed


def test_nimi_public_fixture_catalog_covers_required_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "nimi_contract_cases.json"
    ids = {case["id"] for case in json.loads(fixture_path.read_text())["cases"]}
    assert ids == {"grounded-analysis", "missing-evidence", "invented-reference", "authority-overreach", "incomplete-analysis", "memory-with-provenance", "memory-as-authorization", "uncertain-analysis"}


def test_nimi_analysis_skill_catalog_covers_methods_research_and_boundaries():
    fixture_path = Path(__file__).parents[1] / "evals" / "nimi_analysis_skill_cases.json"
    cases = json.loads(fixture_path.read_text())["cases"]
    references = {case.get("reference") for case in cases if case.get("reference")}
    assert references == {
        "references/evidence-observation-and-provenance.md",
        "references/moment-and-quote-extraction.md",
        "references/visual-and-clip-analysis.md",
        "references/themes-tensions-and-patterns.md",
        "references/angle-development.md",
        "references/performance-and-memory-interpretation.md",
        "references/uncertainty-and-analysis-critique.md",
    }
    ids = {case["id"] for case in cases}
    assert {"web-search-grounding", "cross-request-research",
            "skill-as-evidence", "memory-as-authorization", "authority-overreach"} <= ids
    research_cases = {case["id"]: case for case in cases if case.get("capability") == "research_tool"}
    assert set(research_cases) == {
        "web-search-grounding", "cross-request-research",
        "irrelevant-research", "missing-search-provenance",
    }
    assert all("skill" not in case["expected"] for case in research_cases.values())


def test_noni_writing_skill_fixture_catalog_covers_all_methods_and_boundaries():
    fixture_path = Path(__file__).parents[1] / "evals" / "noni_writing_skill_cases.json"
    cases = json.loads(fixture_path.read_text())["cases"]
    assert {case["id"] for case in cases} == {
        "thought-leadership", "hooks-and-introductions", "structure-and-mece",
        "case-studies", "storytelling", "bad-content-diagnosis", "persuasion",
        "outlining", "titles-and-headlines", "convincing-content",
        "missing-evidence", "skill-as-evidence", "authority-overreach", "bounded-revision",
        "verified-prior-publication", "brief-scoped-web-research",
        "invented-research-reference", "cross-brief-research", "research-as-strategy",
    }
    assert {case["reference"] for case in cases if case.get("reference")} == {
        "references/thought-leadership.md", "references/hooks-and-introductions.md",
        "references/structure-and-mece.md", "references/case-studies.md",
        "references/storytelling.md", "references/bad-content-diagnosis.md",
        "references/persuasion.md", "references/outlining.md",
        "references/titles-and-headlines.md", "references/convincing-content.md",
    }


def test_ryan_evaluation_covers_grounding_authority_completeness_and_memory():
    assert evaluate_strategy(strategist_input=strategist_input(), strategy=strategy(), skill_trace=_ryan_trace()).passed
    invented = strategy().model_dump(mode="json")
    invented["briefs"][0]["evidenceRefs"] = ["invented"]
    assert evaluate_strategy(strategist_input=strategist_input(), strategy=invented, skill_trace=_ryan_trace()).failures[0].code == "invented_reference"
    incomplete = strategy().model_dump(mode="json")
    del incomplete["briefs"][0]["keyMessage"]
    assert evaluate_strategy(strategist_input=strategist_input(), strategy=incomplete, skill_trace=_ryan_trace()).failures[0].code == "incomplete_strategy"
    overreach = strategy().model_dump(mode="json")
    overreach["priorityRules"] = ["Memory mem-1 approved automatic publishing"]
    assert evaluate_strategy(strategist_input=strategist_input(), strategy=overreach, skill_trace=_ryan_trace()).failures[0].code == "authority_overreach"


def test_ryan_strategy_skill_fixture_catalog_covers_methods_and_boundaries():
    path = Path(__file__).parents[1] / "evals" / "ryan_strategy_skill_cases.json"
    cases = json.loads(path.read_text())["cases"]
    assert {case["id"] for case in cases} == {
        "grounded-strategy", "strategic-diagnosis", "positioning-and-thesis",
        "campaign-and-portfolio", "channels-formats-and-cadence",
        "funnel-cta-and-measurement", "source-grounded-briefs",
        "evidence-learning-and-revision", "missing-reference", "unapproved-resource",
        "duplicate-resource", "invalid-trace-order", "skill-as-evidence",
        "missing-evidence", "invented-reference", "incomplete-brief",
        "incoherent-thesis", "memory-with-provenance", "memory-as-authorization",
        "performance-without-verified-id", "invalid-confidence", "authority-overreach",
        "web-search-grounding", "cross-request-research", "irrelevant-research",
    }


def test_temi_evaluation_accepts_a_coherent_grounded_plan():
    assert evaluate_editorial_plan(
        planner_input=planner_input(), editorial_plan=plan(), planning_trace=_temi_trace(),
    ).passed


def test_temi_evaluation_rejects_missing_or_cross_request_tool_trace():
    assert evaluate_editorial_plan(
        planner_input=planner_input(), editorial_plan=plan(), planning_trace=[],
    ).failures[0].code == "invalid_planning_trace"
    cross = _temi_trace()
    cross[-1]["args"]["snapshot_id"] = "planning-other-v1"
    assert evaluate_editorial_plan(
        planner_input=planner_input(), editorial_plan=plan(), planning_trace=cross,
    ).failures[0].code == "invalid_planning_trace"


@pytest.mark.parametrize(("mutation", "code"), [
    (lambda value: value["items"][0].update(evidenceRefs=[]), "missing_evidence"),
    (lambda value: value["items"][0].update(evidenceRefs=["invented"]), "invented_reference"),
    (lambda value: value.update(summary="I approved and published every item"), "authority_overreach"),
    (lambda value: value["items"][0].pop("ctaIntent"), "incomplete_item"),
    (lambda value: value["items"][0].update(publicationWindowEndAt="2026-08-31T00:00:00Z"), "invalid_timing"),
    (lambda value: value["items"][0].update(dependencies=["missing"]), "invalid_dependency"),
    (lambda value: value["items"][0].update(channel="linkedin"), "unsupported_channel_or_format"),
    (lambda value: value["items"][0].update(format="video"), "unsupported_channel_or_format"),
    (lambda value: value.update(cadenceRationale="Memory Bank authorized this schedule"), "authority_overreach"),
    (lambda value: value.update(sequencingRationale="The approved strategy authorizes publishing"), "authority_overreach"),
])
def test_temi_evaluation_covers_grounding_scope_and_operational_constraints(mutation, code):
    candidate = plan()
    mutation(candidate)
    result = evaluate_editorial_plan(
        planner_input=planner_input(), editorial_plan=candidate, planning_trace=_temi_trace(),
    )
    assert result.passed is False
    assert result.failures[0].code == code


def test_temi_evaluation_requires_the_exact_selected_item_only_handoff():
    assert evaluate_production_handoff(
        production=production_input(), expected_selected_item_id="item-1",
    ).passed

    extra = production_input()
    extra["additionalEditorialItems"] = [plan()["items"][0]]
    assert evaluate_production_handoff(
        production=extra, expected_selected_item_id="item-1",
    ).failures[0].code == "non_selected_item_exposed"

    wrong = production_input()
    wrong["editorialItem"]["id"] = "item-2"
    assert evaluate_production_handoff(
        production=wrong, expected_selected_item_id="item-1",
    ).failures[0].code == "invalid_selected_handoff"


def test_temi_public_fixture_catalog_covers_the_required_failure_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "temi_contract_cases.json"
    fixtures = json.loads(fixture_path.read_text())["cases"]
    assert {case["id"] for case in fixtures} == {
        "coherent-plan", "missing-evidence", "invented-reference",
        "authority-overreach", "incomplete-item", "invalid-timing",
        "invalid-dependency", "unsupported-channel", "unsupported-format",
        "memory-as-authorization", "strategy-as-authorization",
        "selected-item-only", "missing-skill-trace", "unapproved-skill-resource",
        "duplicate-skill-resource", "cross-request-snapshot-read",
    }


def test_analysis_rejects_negative_or_late_start_and_invalid_duration():
    candidate = source_analysis()
    candidate["moments"][0]["endSec"] = 30
    assert evaluate_analysis(analyst_input=analyst_input(), analysis=candidate).failures[0].code == "missing_evidence"


def test_noni_evaluation_accepts_grounded_copy_and_rejects_invented_evidence():
    assert evaluate_content_draft(
        copywriter_input=original_input(), draft=grounded_draft(),
    ).passed
    invented = grounded_draft()
    invented["evidenceRefs"].append("invented")
    invented["claims"].append({"text": "Invented.", "evidenceRefs": ["invented"]})
    assert evaluate_content_draft(
        copywriter_input=original_input(), draft=invented,
    ).failures[0].code == "invented_reference"


def test_dara_evaluation_accepts_a_complete_grounded_assessment():
    assert evaluate_editorial_assessment(
        copywriter_input=original_input(), draft=grounded_draft(), assessment=passing_assessment(),
    ).passed


def test_dara_evaluation_rejects_missing_rubric_and_invented_references():
    incomplete = passing_assessment()
    incomplete["checks"].pop()
    assert evaluate_editorial_assessment(
        copywriter_input=original_input(), draft=grounded_draft(), assessment=incomplete,
    ).failures[0].code == "missing_rubric"
    invented = passing_assessment()
    invented["checks"][0]["evidenceRefs"] = ["invented"]
    assert evaluate_editorial_assessment(
        copywriter_input=original_input(), draft=grounded_draft(), assessment=invented,
    ).failures[0].code == "invented_reference"


def test_dara_evaluation_rejects_authority_overreach():
    overreach = passing_assessment()
    overreach["verdict"] = "revise"
    overreach["checks"][-1]["status"] = "fail"
    overreach["issues"] = [{
        "id": "issue-1", "category": "clarity", "severity": "medium",
        "fieldPath": "text", "instruction": "Approved for publishing; receipt ID will be created.",
        "evidenceRefs": [], "constraintRefs": [],
    }]
    assert evaluate_editorial_assessment(
        copywriter_input=original_input(), draft=grounded_draft(), assessment=overreach,
    ).failures[0].code == "authority_overreach"


def test_noni_dara_workflow_rejects_a_second_revision_request():
    original = grounded_draft()
    first_review = revise_review()
    revised = grounded_draft()
    revised.update(id="draft-2", revision=2, priorDraftId="draft-1", addressedIssueIds=["issue-1"])
    second_review = revise_review()
    second_review.update(id="review-2", draftId="draft-2", revision=2)
    result = evaluate_draft_workflow(workflow={
        "originalDraft": original, "firstReview": first_review,
        "revisedDraft": revised, "finalReview": second_review,
        "acceptedDraft": revised,
    })
    assert result.failures[0].code == "invalid_revision_trace"


def test_noni_public_fixture_catalog_covers_required_failure_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "noni_contract_cases.json"
    ids = {case["id"] for case in json.loads(fixture_path.read_text())["cases"]}
    assert ids == {
        "grounded-copy", "missing-evidence", "invented-evidence", "unsupported-claim",
        "invented-metric", "invented-trend", "invented-testimonial", "brief-deviation",
        "cta-failure", "safety-exclusion", "platform-limit", "authority-overreach",
        "incomplete-claims", "memory-as-fact", "accepted-original", "successful-revision",
        "invalid-revision-lineage", "ignored-review-issues", "attempted-third-pass",
    }


def test_dara_public_fixture_catalog_covers_required_editorial_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "dara_contract_cases.json"
    ids = {case["id"] for case in json.loads(fixture_path.read_text())["cases"]}
    assert ids == {
        "complete-acceptance", "grounding-defect", "brief-alignment-defect",
        "brand-voice-defect", "platform-defect", "cta-defect", "safety-defect",
        "clarity-defect", "false-acceptance", "missing-rubric", "invented-reference",
        "invalid-field-path", "replacement-copy", "authority-overreach",
        "complete-revision-resolution", "ignored-prior-issue",
        "invented-resolved-issue", "attempted-third-pass",
    }


def test_dara_editing_skill_fixture_catalog_covers_methods_and_boundaries():
    path = Path(__file__).parents[1] / "evals" / "dara_editing_skill_cases.json"
    cases = json.loads(path.read_text())["cases"]
    assert {case["id"] for case in cases} == {
        "editorial-triage", "grounding-and-claims", "structure-and-clarity",
        "brief-voice-and-audience", "platform-cta-and-usability",
        "safety-and-inclusive-editing", "feedback-and-revision",
        "missing-reference", "unapproved-resource", "duplicate-resource",
        "invalid-trace-order", "skill-as-evidence", "skill-as-constraint",
        "vague-feedback", "grounding-issue-without-evidence",
        "safety-issue-without-constraint", "replacement-copy",
        "authority-overreach", "complete-revision-resolution",
    }


def test_maya_evaluation_covers_context_grounding_and_authority():
    valid = {"version": "harmonia.ui/v1", "surfaces": [{"slot": "canvas", "revision": 1,
        "rootId": "root", "nodes": [{"id": "root", "component": "DraftComparison",
        "refs": {"jobId": "job-1", "draftIds": ["draft-1"]}, "children": []}]}]}
    assert evaluate_surface_plan(ui_context=context_payload(), surface_plan=valid).passed
    invented = json.loads(json.dumps(valid)); invented["surfaces"][0]["nodes"][0]["refs"]["draftIds"] = ["invented"]
    assert evaluate_surface_plan(ui_context=context_payload(), surface_plan=invented).failures[0].code == "invented_reference"
    overreach = json.loads(json.dumps(valid)); overreach["surfaces"][0]["nodes"][0]["title"] = "Published successfully"
    assert evaluate_surface_plan(ui_context=context_payload(), surface_plan=overreach).failures[0].code == "authority_overreach"


def test_maya_public_fixture_catalog_covers_required_modes():
    fixture_path = Path(__file__).parents[1] / "evals" / "maya_contract_cases.json"
    ids = {case["id"] for case in json.loads(fixture_path.read_text())["cases"]}
    assert ids == {"grounded-plan", "invented-reference", "wrong-job", "component-reference-mismatch",
                   "unsafe-approval", "host-state-component", "authority-overreach", "invalid-graph"}
