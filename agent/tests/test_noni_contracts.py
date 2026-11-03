"""Closed-world contracts for Noni copywriting and Dara editorial review."""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import (
    Angle,
    ContentBrief,
    ContentDraft,
    CopywriterInput,
    EditorialPlanItem,
    EditorialReview,
    Moment,
)
from harmonia_agent.agents import AgentProtocolError, validate_content_draft


def _brief() -> dict:
    return {
        "id": "brief-1", "title": "Operational proof", "objective": "Show verified operating proof",
        "audienceId": "founders", "funnelStage": "consideration", "keyMessage": "Harmonia keeps content execution governed.",
        "channelCandidates": ["x"], "formatCandidates": ["text_post"], "ctaIntent": "request a demo",
        "intendedConversion": "qualified demo request", "kpi": "qualified demos", "priority": 1,
        "dependencies": [], "constraints": ["Use an evidence-led voice"], "evidenceRefs": ["moment-1", "angle-1"],
    }


def _editorial_item() -> dict:
    return {
        "id": "item-1", "briefId": "brief-1", "campaignTheme": "Evidence before execution", "contentPillar": "operational proof",
        "objective": "Show verified operating proof", "audienceId": "founders", "funnelStage": "consideration",
        "intendedConversion": "qualified demo request", "ctaIntent": "request a demo", "kpi": "qualified demos",
        "channel": "x", "format": "text_post", "evidenceRefs": ["moment-1", "angle-1"],
        "publicationWindowStartAt": "2026-09-01T16:00:00Z", "publicationWindowEndAt": "2026-09-01T18:00:00Z",
        "productionDeadlineAt": "2026-08-31T18:00:00Z", "priority": 1, "selectionScore": 0.9,
        "dependencies": [], "productionStatus": "planned", "constraints": ["Use an evidence-led voice"], "requiredAssets": [],
        "planningRationale": "The first proof post opens the campaign.", "selectionRationale": "It is the selected item.", "confidence": "high",
    }


def _evidence() -> tuple[list[dict], list[dict]]:
    return ([{
        "id": "moment-1", "title": "Activation lesson", "startSec": 1, "endSec": 8,
        "hook": "Cut the delay", "quote": "We cut nine days to forty hours.",
        "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [],
        "assumptions": [], "confidence": "high",
    }], [{
        "id": "angle-1", "angleType": "source_insight", "evidenceKind": "source", "title": "Evidence-led execution",
        "rationale": "Founders need verifiable operating proof.",
        "evidenceRefs": ["moment-1"], "assumptions": [], "confidence": "high",
    }])


def original_draft() -> dict:
    return {
        "id": "draft-1", "planId": "plan-1", "planDigest": "a" * 64, "strategyDigest": "b" * 64,
        "editorialItemId": "item-1", "briefId": "brief-1", "revision": 1, "platform": "x", "format": "text_post",
        "audienceId": "founders", "objective": "Show verified operating proof", "funnelStage": "consideration",
        "ctaIntent": "request a demo",
        "text": "Evidence-led teams cut the gap between a content decision and its governed execution. Request a demo.",
        "ctaTreatment": "Invite founders to request a demo.", "intendedConversion": "qualified demo request",
        "evidenceRefs": ["moment-1", "angle-1"],
        "claims": [{"text": "The source describes reducing a nine-day delay to forty hours.", "evidenceRefs": ["moment-1"]}],
        "assumptions": ["A direct founder-focused hook suits the selected X item."], "confidence": "high",
        "appliedConstraints": ["Use an evidence-led voice"], "priorDraftId": None, "addressedIssueIds": [],
    }


def editorial_checks(*, failed: set[str] | None = None) -> list[dict]:
    failed = failed or set()
    return [{
        "dimension": dimension, "status": "fail" if dimension in failed else "pass",
        "rationale": f"Checked {dimension} against the exact draft input.",
        "evidenceRefs": ["moment-1"] if dimension in {"grounding", "brief_alignment"} else [],
        "constraintRefs": ["Use an evidence-led voice"] if dimension in {"brand_voice", "safety"} else [],
    } for dimension in (
        "grounding", "brief_alignment", "brand_voice", "platform_constraints",
        "cta", "safety", "clarity",
    )]


def revise_review() -> dict:
    return {
        "id": "review-1", "planId": "plan-1", "planDigest": "a" * 64, "strategyDigest": "b" * 64,
        "editorialItemId": "item-1", "briefId": "brief-1", "draftId": "draft-1", "revision": 1,
        "verdict": "revise", "reviewedAt": "2026-08-27T10:00:00Z",
        "checks": editorial_checks(failed={"clarity"}),
        "issues": [{
            "id": "issue-1", "category": "clarity", "severity": "medium", "fieldPath": "text",
            "instruction": "Name the source qualification before the call to action.", "evidenceRefs": ["moment-1"], "constraintRefs": [],
        }], "resolvedIssueIds": [],
    }


def original_input() -> dict:
    moments, angles = _evidence()
    return {
        "planId": "plan-1", "planDigest": "a" * 64, "strategyDigest": "b" * 64,
        "editorialItemId": "item-1", "briefId": "brief-1", "editorialItem": _editorial_item(), "brief": _brief(),
        "referencedMoments": moments, "referencedAngles": angles, "brandContext": "Direct, evidence-led, and concise.",
        "constraints": ["Use an evidence-led voice"], "platform": "x", "format": "text_post", "passType": "original",
        "priorDraft": None, "priorReview": None,
    }


def grounded_draft() -> dict:
    value = original_draft()
    value.update({
        "text": (
            "We cut nine days to forty hours. Founders need verifiable operating proof. "
            "Request a demo."
        ),
        "ctaTreatment": "Request a demo.",
        "claims": [
            {"text": "We cut nine days to forty hours.", "evidenceRefs": ["moment-1"]},
            {
                "text": "Founders need verifiable operating proof.",
                "evidenceRefs": ["angle-1"],
            },
        ],
    })
    return value


def test_grounding_validator_accepts_one_grounded_brief_aligned_draft():
    supplied = CopywriterInput.model_validate(original_input())
    draft = ContentDraft.model_validate(grounded_draft())

    assert validate_content_draft(supplied, draft) is draft


def test_grounding_validator_accepts_provenance_bound_research_claim_and_url():
    supplied = CopywriterInput.model_validate(original_input())
    payload = grounded_draft()
    payload["text"] = (
        "We cut nine days to forty hours. Founders need verifiable operating proof. "
        "Google documents structured search results. "
        "https://developers.google.com/custom-search/v1/overview Request a demo."
    )
    payload["evidenceRefs"].append("ev-1111111111111111")
    payload["claims"].append({
        "text": "Google documents structured search results.",
        "evidenceRefs": ["ev-1111111111111111"],
    })
    draft = ContentDraft.model_validate(payload)

    assert validate_content_draft(
        supplied,
        draft,
        research_evidence={
            "ev-1111111111111111": (
                "Google documents structured search results.",
                "https://developers.google.com/custom-search/v1/overview",
            ),
        },
    ) is draft


def test_grounding_validator_rejects_research_reference_not_returned_by_tool():
    payload = grounded_draft()
    payload["evidenceRefs"].append("ev-1111111111111111")
    payload["claims"].append({"text": "An invented research claim.", "evidenceRefs": ["ev-1111111111111111"]})

    with pytest.raises(AgentProtocolError, match="unknown evidence"):
        validate_content_draft(
            CopywriterInput.model_validate(original_input()),
            ContentDraft.model_validate(payload),
            research_evidence={},
        )


@pytest.mark.parametrize("copy", [
    "𝐋𝐚𝐮𝐧𝐜𝐡 𝐧𝐨𝐰, Request a demo.",
    "开发者, Request a demo.",
    "Request a demo, 开发者.",
    "Request a demo 立即发布.",
])
def test_grounding_validator_explicitly_rejects_non_ascii_copy(copy):
    draft = grounded_draft()
    draft["text"] = copy

    with pytest.raises(AgentProtocolError, match="ASCII-only"):
        _validate(draft)


@pytest.mark.parametrize("copy", [
    "Launch now, Request a demo.",
    "Developers, Request a demo.",
    "Request a demo, Developers.",
    "Request a demo Publish now.",
])
def test_grounding_validator_keeps_ascii_equivalents_fail_closed(copy):
    draft = grounded_draft()
    draft["text"] = copy

    with pytest.raises(AgentProtocolError):
        _validate(draft)


def _validate(
    draft_payload: dict | None = None,
    input_payload: dict | None = None,
) -> ContentDraft:
    return validate_content_draft(
        CopywriterInput.model_validate(input_payload or original_input()),
        ContentDraft.model_validate(draft_payload or grounded_draft()),
    )


def test_grounding_validator_rejects_unknown_evidence_ids():
    draft = grounded_draft()
    draft["evidenceRefs"].append("unknown-1")
    draft["claims"].append({"text": "Unknown claim.", "evidenceRefs": ["unknown-1"]})

    with pytest.raises(AgentProtocolError, match="unknown evidence"):
        _validate(draft)


def test_grounding_validator_rejects_missing_selected_evidence_ids():
    draft = grounded_draft()
    draft["evidenceRefs"] = ["moment-1"]
    draft["claims"] = [draft["claims"][0]]

    with pytest.raises(AgentProtocolError, match="missing selected evidence"):
        _validate(draft)


def test_grounding_validator_rejects_declared_but_unused_evidence():
    draft = grounded_draft()
    draft["claims"] = [draft["claims"][0]]

    with pytest.raises(AgentProtocolError, match="unused evidence"):
        _validate(draft)


def test_grounding_validator_rejects_factual_text_absent_from_claim_ledger():
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} Revenue rose 40%.'

    with pytest.raises(AgentProtocolError, match="uncited factual statement"):
        _validate(draft)


def test_grounding_validator_rejects_claim_terms_absent_from_cited_source_text():
    draft = grounded_draft()
    draft["claims"][0]["text"] = "We cut nine days to twelve hours."
    draft["text"] = draft["text"].replace("forty hours", "twelve hours")

    with pytest.raises(AgentProtocolError, match="textually support"):
        _validate(draft)


@pytest.mark.parametrize(("claim", "message"), [
    ("Harmonia increased revenue by 50%.", "invented metric"),
    ("Harmonia is the fastest-growing content trend.", "invented trend"),
    ("Customers say Harmonia changed their lives.", "invented testimonial"),
    ("Harmonia generates audited tax filings.", "invented product capability"),
])
def test_grounding_validator_rejects_invented_factual_categories(claim, message):
    draft = grounded_draft()
    draft["claims"][0]["text"] = claim
    draft["text"] = f"{claim} Founders need verifiable operating proof. Request a demo."

    with pytest.raises(AgentProtocolError, match=message):
        _validate(draft)


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda draft: draft.update(text="Founders, enjoy a funny office meme. Request a demo."), "audience"),
    (lambda draft: draft.update(text="Developers need verifiable operating proof. Request a demo."), "phantom|factual"),
    (lambda draft: draft.update(text="Founders, buy Harmonia now for verifiable operating proof."), "audience|CTA"),
    (lambda draft: draft.update(
        text=draft["text"].replace("Request a demo.", "Read the blog."),
        ctaTreatment="Read the blog.",
    ), "CTA"),
])
def test_grounding_validator_rejects_objective_audience_funnel_and_cta_drift(mutation, message):
    draft = grounded_draft()
    mutation(draft)

    with pytest.raises(AgentProtocolError, match=message):
        _validate(draft)


def test_grounding_validator_rejects_platform_or_format_divergence_after_parsing():
    draft = ContentDraft.model_validate(grounded_draft()).model_copy(update={"format": "thread"})

    with pytest.raises(AgentProtocolError, match="platform or format"):
        validate_content_draft(CopywriterInput.model_validate(original_input()), draft)


def test_grounding_validator_rejects_missing_applicable_constraints():
    supplied = original_input()
    for owner in (supplied, supplied["brief"], supplied["editorialItem"]):
        owner["constraints"].append("Never promise guaranteed outcomes")

    with pytest.raises(AgentProtocolError, match="missing applicable constraints"):
        _validate(input_payload=supplied)


def test_grounding_validator_rejects_exclusion_and_safety_language():
    supplied = original_input()
    for owner in (supplied, supplied["brief"], supplied["editorialItem"]):
        owner["constraints"].append("Never say guaranteed outcomes")
    draft = grounded_draft()
    draft["appliedConstraints"].append("Never say guaranteed outcomes")
    draft["text"] = f'{draft["text"]} Guaranteed outcomes.'

    with pytest.raises(AgentProtocolError, match="prohibited constraint language"):
        _validate(draft, supplied)


def test_grounding_validator_rejects_urls_absent_from_supplied_context():
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} https://invented.example/demo'

    with pytest.raises(AgentProtocolError, match="URL was not supplied"):
        _validate(draft)


def test_grounding_validator_rejects_multiple_final_copy_alternatives():
    draft = grounded_draft()
    draft["text"] = "Option 1: Request a demo. Option 2: Read the guide."

    with pytest.raises(AgentProtocolError, match="multiple final alternatives"):
        _validate(draft)


@pytest.mark.parametrize("overreach", [
    "This draft is approved.",
    "Approved for publication.",
    "Schedule this post.",
    "Scheduled for 5 PM.",
    "Publish this now.",
    "Published successfully.",
    "Execute the effect payload now.",
    "Receipt created.",
    "Receipt ID: receipt-123.",
    "Access the API key.",
    "Use the API credentials.",
])
def test_grounding_validator_rejects_approval_schedule_publish_effect_receipt_and_credential_overreach(overreach):
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} {overreach}'

    with pytest.raises(AgentProtocolError, match="authority overreach"):
        _validate(draft)


@pytest.mark.parametrize("mutation", [
    lambda supplied, draft: (
        draft.update(text=f'Stop guessing. {draft["text"]}'),
        draft["assumptions"].append("Stop guessing."),
    ),
    lambda supplied, draft: draft.update(
        assumptions=["A concise founder-focused hook suits this X post."],
    ),
    lambda supplied, draft: (
        draft["claims"][0].update(text="The source says we cut nine days to forty hours."),
        draft.update(text=draft["text"].replace(
            "We cut nine days to forty hours.",
            "The source says we cut nine days to forty hours.",
        )),
    ),
    lambda supplied, draft: (
        supplied.update(brandContext=f'{supplied["brandContext"]} Use https://harmonia.example/demo'),
        draft.update(text=f'{draft["text"]} https://harmonia.example/demo'),
    ),
    lambda supplied, draft: draft.update(
        assumptions=["A cautious hook is a creative choice for limited evidence."],
        confidence="low",
    ),
])
def test_grounding_validator_accepts_allowed_language_boundaries(mutation):
    supplied = original_input()
    draft = grounded_draft()
    mutation(supplied, draft)

    assert _validate(draft, supplied).id == "draft-1"


def test_grounding_validator_rejects_reversed_evidence_relation():
    draft = grounded_draft()
    draft["claims"][0]["text"] = "We cut forty hours to nine days."
    draft["text"] = draft["text"].replace(
        "We cut nine days to forty hours.",
        "We cut forty hours to nine days.",
    )

    with pytest.raises(AgentProtocolError, match="relation or order"):
        _validate(draft)


@pytest.mark.parametrize(("field", "assertion"), [
    ("assumptions", "Harmonia increased revenue by 50%."),
    ("ctaTreatment", "Request a demo because Harmonia increased revenue by 50%."),
])
def test_grounding_validator_rejects_unledgered_facts_outside_post_text(field, assertion):
    draft = grounded_draft()
    draft[field] = [assertion] if field == "assumptions" else assertion

    with pytest.raises(AgentProtocolError, match="factual"):
        _validate(draft)


def test_grounding_validator_rejects_unledgered_capability_with_unlisted_verb():
    draft = grounded_draft()
    draft["text"] = (
        f'{draft["text"]} Harmonia transforms every startup into a category leader.'
    )

    with pytest.raises(AgentProtocolError, match="uncited factual statement"):
        _validate(draft)


def test_grounding_validator_rejects_factual_clause_piggybacking_on_a_claim():
    draft = grounded_draft()
    draft["text"] = draft["text"].replace(
        "We cut nine days to forty hours.",
        "We cut nine days to forty hours and Harmonia keeps content execution governed.",
    )

    with pytest.raises(AgentProtocolError, match="uncited factual statement"):
        _validate(draft)


def test_grounding_validator_rejects_repeated_fact_tokens_after_a_claim():
    draft = grounded_draft()
    draft["text"] = draft["text"].replace(
        "We cut nine days to forty hours.",
        "We cut nine days to forty hours forty.",
    )

    with pytest.raises(AgentProtocolError, match="uncited factual statement"):
        _validate(draft)


def test_grounding_validator_rejects_context_word_fact_after_audience_colon():
    draft = grounded_draft()
    draft["text"] = (
        f'{draft["text"]} Founders: content execution governed.'
    )

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft)


def test_grounding_validator_rejects_phantom_claim_not_expressed_in_text_or_cta():
    draft = grounded_draft()
    draft["claims"].append({
        "text": "Cut the delay.",
        "evidenceRefs": ["moment-1"],
    })

    with pytest.raises(AgentProtocolError, match="phantom claim"):
        _validate(draft)


def test_grounding_validator_rejects_evidence_consumed_only_by_a_phantom_claim():
    draft = grounded_draft()
    draft["claims"] = [
        draft["claims"][0],
        {"text": "Evidence-led execution.", "evidenceRefs": ["angle-1"]},
    ]

    with pytest.raises(AgentProtocolError, match="phantom claim"):
        _validate(draft)


def test_grounding_validator_rejects_epistemic_factual_assumption():
    draft = grounded_draft()
    draft["assumptions"] = ["This may resonate with founders."]

    with pytest.raises(AgentProtocolError, match="non-factual"):
        _validate(draft)


def test_grounding_validator_rejects_claim_support_manufactured_across_evidence_fields():
    supplied = original_input()
    supplied["referencedMoments"][0].update(title="Alpha", hook="Beta")
    draft = grounded_draft()
    draft["claims"][0] = {"text": "Alpha Beta.", "evidenceRefs": ["moment-1"]}
    draft["text"] = draft["text"].replace(
        "We cut nine days to forty hours.",
        "Alpha Beta.",
    )

    with pytest.raises(AgentProtocolError, match="one evidence field"):
        _validate(draft, supplied)


def test_grounding_validator_rejects_noncontiguous_nonmetric_claim_support():
    draft = grounded_draft()
    draft["claims"][1]["text"] = "Founders need proof."
    draft["text"] = draft["text"].replace(
        "Founders need verifiable operating proof.",
        "Founders need proof.",
    )

    with pytest.raises(AgentProtocolError, match="contiguous"):
        _validate(draft)


def test_grounding_validator_requires_contiguous_metric_relation():
    supplied = original_input()
    supplied["referencedMoments"][0]["quote"] = (
        "We cut the delay from nine days down to forty hours."
    )

    with pytest.raises(AgentProtocolError, match="contiguous|relation"):
        _validate(input_payload=supplied)


@pytest.mark.parametrize("connector", ["and", "or", "and/or"])
def test_grounding_validator_preserves_metric_relation_connectors(connector):
    draft = grounded_draft()
    conflicting = f"We cut nine days {connector} forty hours."
    draft["claims"][0]["text"] = conflicting
    draft["text"] = draft["text"].replace(
        "We cut nine days to forty hours.",
        conflicting,
    )

    with pytest.raises(AgentProtocolError, match="relation|connector"):
        _validate(draft)


def test_grounding_validator_rejects_undeclared_creative_clause():
    draft = grounded_draft()
    draft["text"] = f'Stop guessing. {draft["text"]}'

    with pytest.raises(AgentProtocolError, match="substantive clause"):
        _validate(draft)


def test_grounding_validator_accepts_explicit_safe_creative_phrase():
    draft = grounded_draft()
    draft["text"] = f'Stop guessing. {draft["text"]}'
    draft["assumptions"].append("Stop guessing.")

    assert _validate(draft).id == "draft-1"


@pytest.mark.parametrize("unsafe_action", [
    "Stop deploying.",
    "Ready to stop deploying?",
    "Ready to stop submitting?",
    "Are you ready to stop shipping?",
    "Ready to stop registering?",
    "Ready to stop reserving?",
])
def test_grounding_validator_rejects_unknown_creative_action_syntax(
    unsafe_action,
):
    draft = grounded_draft()
    draft["text"] = f'{unsafe_action} {draft["text"]}'
    draft["assumptions"].append(unsafe_action)

    with pytest.raises(AgentProtocolError, match="creative grammar|non-factual"):
        _validate(draft)


@pytest.mark.parametrize("unsafe_action", [
    "Consider submitting this.",
    "Imagine shipping this.",
    "Stop—deploying this.",
    "Consider deployment.",
    "Are you ready to stop registrations?",
])
def test_grounding_validator_rejects_action_punctuation_and_inflection_bypasses(
    unsafe_action,
):
    draft = grounded_draft()
    draft["text"] = f'{unsafe_action} {draft["text"]}'
    draft["assumptions"].append(unsafe_action)

    with pytest.raises(AgentProtocolError, match="creative grammar|non-factual|ASCII-only"):
        _validate(draft)


def test_grounding_validator_keeps_evidence_backed_action_copy_open():
    supplied = original_input()
    supplied["referencedMoments"][0]["hook"] = "Teams deploy content safely."
    draft = grounded_draft()
    draft["text"] = f'Teams deploy content safely. {draft["text"]}'
    draft["claims"].append({
        "text": "Teams deploy content safely.",
        "evidenceRefs": ["moment-1"],
    })

    assert _validate(draft, supplied).id == "draft-1"


def test_grounding_validator_keeps_exact_operator_supplied_cta_open():
    supplied = original_input()
    supplied["brief"].update(
        ctaIntent="reserve a demo",
        intendedConversion="qualified reserve a demo request",
    )
    supplied["editorialItem"].update(
        ctaIntent="reserve a demo",
        intendedConversion="qualified reserve a demo request",
    )
    draft = grounded_draft()
    draft.update(
        ctaIntent="reserve a demo",
        ctaTreatment="Reserve a demo.",
        intendedConversion="qualified reserve a demo request",
    )
    draft["text"] = draft["text"].replace("Request a demo.", "Reserve a demo.")

    assert _validate(draft, supplied).id == "draft-1"


def test_grounding_validator_rejects_qualifier_added_to_exact_cta_clause():
    draft = grounded_draft()
    draft["ctaTreatment"] = "According to evidence, request a demo."
    draft["text"] = draft["text"].replace(
        "Request a demo.",
        "According to evidence, request a demo.",
    )

    with pytest.raises(AgentProtocolError, match="exact brief intent"):
        _validate(draft)


@pytest.mark.parametrize("factual_assumption", [
    "Customers might love this.",
    "Teams may move faster.",
])
def test_grounding_validator_rejects_modal_factual_assumptions(factual_assumption):
    draft = grounded_draft()
    draft["assumptions"] = [factual_assumption]

    with pytest.raises(AgentProtocolError, match="non-factual"):
        _validate(draft)


def test_grounding_validator_rejects_spelled_metric_creative_assumption():
    draft = grounded_draft()
    draft["text"] = f'Nine days sounds fast. {draft["text"]}'
    draft["assumptions"].append("Nine days sounds fast.")

    with pytest.raises(AgentProtocolError, match="non-factual"):
        _validate(draft)


@pytest.mark.parametrize("factual_fragment", [
    "Sales double.",
    "Trusted worldwide.",
    "Founders win.",
])
def test_grounding_validator_rejects_factual_fragments_declared_as_creative(
    factual_fragment,
):
    draft = grounded_draft()
    draft["text"] = f'{factual_fragment} {draft["text"]}'
    draft["assumptions"].append(factual_fragment)

    with pytest.raises(AgentProtocolError, match="non-factual"):
        _validate(draft)


@pytest.mark.parametrize("question", [
    "Ready to stop guessing?",
    "Are you ready to stop guessing?",
    "Still guessing?",
    "Why keep guessing?",
])
def test_grounding_validator_accepts_narrow_nonfactual_questions(question):
    draft = grounded_draft()
    draft["text"] = f'{question} {draft["text"]}'
    draft["assumptions"].append(question)

    assert _validate(draft).id == "draft-1"


@pytest.mark.parametrize("factual_question", [
    "Loved by founders?",
    "Recommended by customers?",
    "Category leader?",
    "Market leader?",
    "Ready to become category leader?",
])
def test_grounding_validator_rejects_endorsement_and_status_questions(
    factual_question,
):
    draft = grounded_draft()
    draft["text"] = f'{factual_question} {draft["text"]}'
    draft["assumptions"].append(factual_question)

    with pytest.raises(AgentProtocolError, match="non-factual"):
        _validate(draft)


@pytest.mark.parametrize(("field", "overreach"), [
    ("text", "Consider launch now."),
    ("text", "Imagine posting this now."),
    ("text", "Consider—launch now."),
    ("text", "Consider imagining launch now."),
    ("text", "Consider perhaps launching this now."),
    ("text", "Picture going live now."),
    ("text", "Think about queueing this post."),
    ("text", "Consider verifying this."),
    ("text", "Imagine changing workflow state."),
    ("ctaTreatment", "Imagine launching this now."),
    ("assumptions", "Think about scheduling the post."),
])
def test_grounding_validator_rechecks_authority_after_stylistic_leadins(
    field,
    overreach,
):
    draft = grounded_draft()
    if field == "text":
        draft["text"] = f'{overreach} {draft["text"]}'
        draft["assumptions"].append(overreach)
    elif field == "assumptions":
        draft["assumptions"].append(overreach)
    else:
        draft[field] = overreach

    with pytest.raises(AgentProtocolError, match="authority overreach|ASCII-only"):
        _validate(draft)


@pytest.mark.parametrize(("field", "conflicting_action"), [
    ("text", "Consider booking a call."),
    ("text", "Please, consider booking a call."),
    ("text", "Consider contacting sales."),
    ("text", "Think about talking to sales."),
    ("ctaTreatment", "Imagine booking a consultation."),
    ("assumptions", "Try to book a call."),
])
def test_grounding_validator_rechecks_cta_actions_after_stylistic_leadins(
    field,
    conflicting_action,
):
    draft = grounded_draft()
    if field == "text":
        draft["text"] = f'{conflicting_action} {draft["text"]}'
        draft["assumptions"].append(conflicting_action)
    elif field == "assumptions":
        draft["assumptions"].append(conflicting_action)
    else:
        draft[field] = conflicting_action

    with pytest.raises(AgentProtocolError, match="conflicting CTA"):
        _validate(draft)


def test_grounding_validator_rejects_authority_imperative_in_assumptions():
    draft = grounded_draft()
    draft["assumptions"].append("Launch this now.")

    with pytest.raises(AgentProtocolError, match="authority overreach"):
        _validate(draft)


@pytest.mark.parametrize("conflicting_action", [
    "Buy now.",
    "Do not request a demo.",
    "Sign up.",
    "Join now.",
    "Subscribe.",
    "Download the guide.",
])
def test_grounding_validator_rejects_conflicting_cta_even_if_declared_creative(
    conflicting_action,
):
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} {conflicting_action}'
    draft["assumptions"].append(conflicting_action)

    with pytest.raises(AgentProtocolError, match="CTA|funnel"):
        _validate(draft)


@pytest.mark.parametrize(("text", "message"), [
    (
        "Founders: request a demo for beach vacations and operating proof.",
        "audience",
    ),
    (
        "Astronauts: request a demo for verifiable operating proof.",
        "audience",
    ),
    (
        "Founders: join the waitlist for verifiable operating proof.",
        "audience|CTA|funnel",
    ),
])
def test_grounding_validator_rejects_clear_brief_semantic_divergence(text, message):
    draft = grounded_draft()
    draft["text"] = text

    with pytest.raises(AgentProtocolError, match=message):
        _validate(draft)


def test_grounding_validator_rejects_even_one_unbound_topic_term():
    draft = grounded_draft()
    draft["text"] = "Founders: request a demo for operating proof and vacations."

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft)


def test_grounding_validator_rejects_negated_cta_intent():
    draft = grounded_draft()
    draft["text"] = "Founders: do not request a demo for verifiable operating proof."

    with pytest.raises(AgentProtocolError, match="CTA"):
        _validate(draft)


def test_grounding_validator_fails_closed_for_non_substantive_cta_intent():
    supplied = original_input()
    supplied["brief"]["ctaIntent"] = "the"
    supplied["editorialItem"]["ctaIntent"] = "the"

    with pytest.raises(AgentProtocolError, match="CTA"):
        _validate(input_payload=supplied)


def test_grounding_validator_requires_exact_cta_treatment_in_actual_text():
    supplied = original_input()
    supplied["brandContext"] += " Use today only when it is supplied."
    draft = grounded_draft()
    draft["ctaTreatment"] = "Request a demo."
    draft["text"] = draft["text"].replace("Request a demo.", "Request a demo today.")

    with pytest.raises(AgentProtocolError, match="exact CTA treatment"):
        _validate(draft, supplied)


def test_grounding_validator_binds_cta_intent_to_intended_conversion():
    supplied = original_input()
    supplied["brief"]["intendedConversion"] = "newsletter signup"
    supplied["editorialItem"]["intendedConversion"] = "newsletter signup"
    draft = grounded_draft()
    draft["intendedConversion"] = "newsletter signup"

    with pytest.raises(AgentProtocolError, match="intended conversion"):
        _validate(draft, supplied)


def test_grounding_validator_rejects_conflicting_direct_audience_even_if_supplied_as_context():
    supplied = original_input()
    supplied["brandContext"] += " Astronauts are a supplied context term."
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} Astronauts: Request a demo.'

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft, supplied)


def test_content_draft_contract_carries_exact_alignment_metadata():
    payload = original_draft()
    payload.update({
        "audienceId": "founders",
        "objective": "Show verified operating proof",
        "funnelStage": "consideration",
        "ctaIntent": "request a demo",
    })

    assert ContentDraft.model_validate(payload).audienceId == "founders"


@pytest.mark.parametrize(("field", "value", "message"), [
    ("audienceId", "developers", "audience"),
    ("objective", "Sell subscriptions", "objective"),
    ("funnelStage", "conversion", "funnel"),
    ("ctaIntent", "join the waitlist", "CTA"),
])
def test_grounding_validator_binds_exact_alignment_metadata(field, value, message):
    draft = grounded_draft()
    draft[field] = value

    with pytest.raises(AgentProtocolError, match=message):
        _validate(draft)


def test_grounding_validator_allows_copy_without_internal_audience_id_literal():
    supplied = original_input()
    supplied["brief"]["audienceId"] = "aud-founders"
    supplied["editorialItem"]["audienceId"] = "aud-founders"
    supplied["referencedAngles"][0]["rationale"] = "Verifiable operating proof matters."
    draft = grounded_draft()
    draft.update({
        "audienceId": "aud-founders",
        "objective": "Show verified operating proof",
        "funnelStage": "consideration",
        "ctaIntent": "request a demo",
    })
    draft["claims"][1]["text"] = "Verifiable operating proof matters."
    draft["text"] = draft["text"].replace(
        "Founders need verifiable operating proof.",
        "Verifiable operating proof matters.",
    )

    assert _validate(draft, supplied).audienceId == "aud-founders"


def test_grounding_validator_rejects_conflicting_comma_vocative():
    draft = grounded_draft()
    draft.update({
        "audienceId": "founders",
        "objective": "Show verified operating proof",
        "funnelStage": "consideration",
        "ctaIntent": "request a demo",
    })
    draft["text"] = f'Developers, stop guessing. {draft["text"]}'
    draft["assumptions"].append("Developers, stop guessing.")

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft)


@pytest.mark.parametrize("vocative", [
    "Stop guessing, developers.",
    "Ready to stop guessing, astronauts?",
    "Why keep guessing: developers?",
])
def test_grounding_validator_rejects_trailing_unbound_vocatives(vocative):
    draft = grounded_draft()
    draft["text"] = f'{vocative} {draft["text"]}'
    draft["assumptions"].append(vocative)

    with pytest.raises(AgentProtocolError, match="audience|creative grammar|non-factual"):
        _validate(draft)


@pytest.mark.parametrize("vocative", [
    "Hey developers, ready to stop guessing?",
    "Hello mobile developers, ready to stop guessing?",
    "Hey founders and developers, ready to stop guessing?",
    "Hey founders and astronauts, ready to stop guessing?",
])
def test_grounding_validator_rejects_conflicting_attention_vocatives(vocative):
    draft = grounded_draft()
    draft["text"] = f'{vocative} {draft["text"]}'
    draft["assumptions"].append(vocative)

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft)


@pytest.mark.parametrize("question", [
    "Hey startup founders, ready to stop guessing?",
    "Hey, startup founders, ready to stop guessing?",
    "Startup founders, ready to stop guessing?",
])
def test_grounding_validator_rejects_audience_id_inferred_as_display_vocative(question):
    draft = grounded_draft()
    draft["text"] = f'{question} {draft["text"]}'
    draft["assumptions"].append(question)

    with pytest.raises(AgentProtocolError, match="audience"):
        _validate(draft)


@pytest.mark.parametrize("overreach", [
    "Publication approved.",
    "Send this live now.",
    "Effect payload queued.",
    "Receipt saved.",
    "Token provided.",
    "Plan the campaign next.",
])
def test_grounding_validator_rejects_additional_authority_variants(overreach):
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} {overreach}'

    with pytest.raises(AgentProtocolError, match="authority overreach"):
        _validate(draft)


def test_grounding_validator_rejects_authority_even_when_phrase_is_supplied():
    supplied = original_input()
    supplied["brandContext"] += " Approval granted."
    draft = grounded_draft()
    draft["text"] = f'{draft["text"]} Approval granted.'

    with pytest.raises(AgentProtocolError, match="authority overreach"):
        _validate(draft, supplied)


def test_grounding_validator_rejects_lettered_final_alternatives():
    draft = grounded_draft()
    draft["text"] = "A) Request a demo. B) Join the waitlist."

    with pytest.raises(AgentProtocolError, match="multiple final alternatives"):
        _validate(draft)


def test_grounding_validator_rejects_slash_separated_alternatives():
    draft = grounded_draft()
    draft["text"] = draft["text"].replace(
        "Request a demo.",
        "Request a demo / request a demo.",
    )

    with pytest.raises(AgentProtocolError, match="multiple final alternatives"):
        _validate(draft)


def test_grounding_validator_rejects_numbered_final_alternatives():
    draft = grounded_draft()
    draft["text"] = "1) Request a demo. 2) Join the waitlist."

    with pytest.raises(AgentProtocolError, match="multiple final alternatives"):
        _validate(draft)


@pytest.mark.parametrize("prohibited_copy", [
    "Competitors.",
    "Guaranteed outcomes.",
])
def test_grounding_validator_splits_disjunctive_exclusions(prohibited_copy):
    supplied = original_input()
    exclusion = "Never mention competitors or guaranteed outcomes"
    for owner in (supplied, supplied["brief"], supplied["editorialItem"]):
        owner["constraints"].append(exclusion)
    draft = grounded_draft()
    draft["appliedConstraints"].append(exclusion)
    draft["text"] = f'{draft["text"]} {prohibited_copy}'

    with pytest.raises(AgentProtocolError, match="prohibited constraint language"):
        _validate(draft, supplied)


def test_grounding_validator_splits_nor_exclusions():
    supplied = original_input()
    exclusion = "Never mention competitors nor guaranteed outcomes"
    for owner in (supplied, supplied["brief"], supplied["editorialItem"]):
        owner["constraints"].append(exclusion)
    draft = grounded_draft()
    draft["appliedConstraints"].append(exclusion)
    draft["text"] = f'{draft["text"]} Competitors.'

    with pytest.raises(AgentProtocolError, match="prohibited constraint language"):
        _validate(draft, supplied)


@pytest.mark.parametrize("prohibited_copy", ["Competitors.", "Guarantees."])
def test_grounding_validator_normalizes_either_nor_exclusions(prohibited_copy):
    supplied = original_input()
    exclusion = "Never mention either competitors nor guarantees"
    for owner in (supplied, supplied["brief"], supplied["editorialItem"]):
        owner["constraints"].append(exclusion)
    draft = grounded_draft()
    draft["appliedConstraints"].append(exclusion)
    draft["text"] = f'{draft["text"]} {prohibited_copy}'

    with pytest.raises(AgentProtocolError, match="prohibited constraint language"):
        _validate(draft, supplied)


def revision_input() -> dict:
    value = original_input()
    value.update({"passType": "revision", "priorDraft": original_draft(), "priorReview": revise_review()})
    return value


def revision_draft() -> dict:
    value = original_draft()
    value.update({"id": "draft-2", "revision": 2, "text": "The source describes cutting a nine-day delay to forty hours. Request a demo for governed content execution.", "priorDraftId": "draft-1", "addressedIssueIds": ["issue-1"]})
    return value


def grounded_revision_draft() -> dict:
    value = grounded_draft()
    value.update({
        "id": "draft-2",
        "revision": 2,
        "priorDraftId": "draft-1",
        "addressedIssueIds": ["issue-1"],
    })
    return value


def test_grounding_validator_accepts_revision_addressing_exact_required_issues():
    assert _validate(grounded_revision_draft(), revision_input()).revision == 2


def test_grounding_validator_rejects_missing_required_revision_issue_ids():
    supplied = revision_input()
    second_issue = deepcopy(supplied["priorReview"]["issues"][0])
    second_issue["id"] = "issue-2"
    supplied["priorReview"]["issues"].append(second_issue)

    with pytest.raises(AgentProtocolError, match="addressed issue ids"):
        _validate(grounded_revision_draft(), supplied)


def test_grounding_validator_rejects_invented_revision_issue_ids():
    draft = grounded_revision_draft()
    draft["addressedIssueIds"].append("issue-invented")

    with pytest.raises(AgentProtocolError, match="addressed issue ids"):
        _validate(draft, revision_input())


def test_complete_original_and_revision_contracts_preserve_single_item_lineage():
    original = CopywriterInput.model_validate(original_input())
    revised = CopywriterInput.model_validate(revision_input())
    draft = ContentDraft.model_validate(original_draft())
    revision = ContentDraft.model_validate(revision_draft())
    review = EditorialReview.model_validate(revise_review())

    assert (original.planId, original.editorialItem.id, original.brief.id, original.platform, original.format) == ("plan-1", "item-1", "brief-1", "x", "text_post")
    assert revised.priorDraft is not None and revised.priorDraft.id == "draft-1"
    assert revised.priorReview is not None and revised.priorReview.issues[0].id == "issue-1"
    assert draft.claims[0].evidenceRefs == ["moment-1"]
    assert revision.priorDraftId == "draft-1" and revision.addressedIssueIds == ["issue-1"]
    assert review.verdict == "revise"


@pytest.mark.parametrize(("factory", "mutation", "message"), [
    (original_input, lambda value: value.update(unexpected="no"), "extra_forbidden"),
    (original_draft, lambda value: value.update(alternatives=["Second post"]), "extra_forbidden"),
    (original_input, lambda value: value["brief"].update(id="brief-other"), "exact selected brief"),
    (original_input, lambda value: value["referencedAngles"].append({"id": "extra", "angleType": "trend", "evidenceKind": "public_context", "title": "Extra", "rationale": "Extra", "evidenceRefs": ["analysis-search-1"], "assumptions": [], "confidence": "medium"}), "evidence"),
    (original_input, lambda value: value.update(priorDraft=original_draft()), "original"),
    (revision_input, lambda value: value.update(priorDraft=None), "prior draft"),
    (revision_input, lambda value: value.update(priorReview=None), "prior review"),
    (original_input, lambda value: value.update(platform="linkedin"), "literal_error"),
    (original_draft, lambda value: value.update(confidence="certain"), "literal_error"),
    (original_draft, lambda value: value.update(publishPayload={"type": "publish_x_post"}), "extra_forbidden"),
    (revise_review, lambda value: value.update(receipt={"id": "forbidden"}), "extra_forbidden"),
    (original_draft, lambda value: value.update(text="x" * 281), "string_too_long"),
])
def test_noni_dara_contracts_fail_closed_for_boundary_and_authority_violations(factory, mutation, message):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory in {original_input, revision_input} else ContentDraft if factory is original_draft else EditorialReview
    with pytest.raises(ValidationError, match=message):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "mutation"), [
    (original_input, lambda value: value["referencedMoments"].__setitem__(0, {**value["referencedMoments"][0], "id": ""})),
    (original_draft, lambda value: value.update(claims=[value["claims"][0]] * 13)),
    (original_draft, lambda value: value.update(evidenceRefs=[])),
    (original_draft, lambda value: value.update(appliedConstraints=[""])),
    (revise_review, lambda value: value.update(reviewedAt="2026-08-27T11:00:00+01:00")),
    (revise_review, lambda value: value.update(issues=[])),
])
def test_noni_dara_contracts_enforce_nonblank_lists_and_utc_fields(factory, mutation):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory is original_input else ContentDraft if factory is original_draft else EditorialReview
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "field"), [
    (original_draft, "claims"),
    (original_draft, "audienceId"),
    (original_draft, "objective"),
    (original_draft, "funnelStage"),
    (original_draft, "ctaIntent"),
    (original_draft, "assumptions"),
    (original_draft, "priorDraftId"),
    (original_draft, "addressedIssueIds"),
    (original_input, "referencedMoments"),
    (original_input, "referencedAngles"),
    (original_input, "constraints"),
    (original_input, "priorDraft"),
    (original_input, "priorReview"),
    (revise_review, "issues"),
    (revise_review, "issues.0.evidenceRefs"),
    (revise_review, "issues.0.constraintRefs"),
])
def test_new_boundary_lists_and_nullable_fields_are_required(factory, field):
    payload = deepcopy(factory())
    if field.startswith("issues.0."):
        del payload["issues"][0][field.rsplit(".", maxsplit=1)[-1]]
    else:
        del payload[field]
    model = CopywriterInput if factory is original_input else ContentDraft if factory is original_draft else EditorialReview
    with pytest.raises(ValidationError, match=field):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "mutation"), [
    (original_draft, lambda value: value.update(revision="1")),
    (original_draft, lambda value: value["claims"][0].update(text=1)),
    (original_draft, lambda value: value.update(assumptions=[1])),
    (original_input, lambda value: value.update(planId=1)),
    (original_input, lambda value: value.update(constraints=[1])),
    (revise_review, lambda value: value.update(revision="1")),
    (revise_review, lambda value: value.update(reviewedAt=1)),
    (revise_review, lambda value: value["issues"][0].update(instruction=1)),
    (revise_review, lambda value: value["issues"][0].update(evidenceRefs=[1])),
    (revise_review, lambda value: value["issues"][0].update(constraintRefs=[1])),
])
def test_new_boundary_scalars_do_not_coerce(factory, mutation):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory is original_input else ContentDraft if factory is original_draft else EditorialReview
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "mutation", "message"), [
    (revision_draft, lambda value: value.update(id="draft-1"), "distinct"),
    (revision_draft, lambda value: value.update(priorDraftId="draft-2"), "self"),
    (revision_input, lambda value: value.update(
        priorDraft=revision_draft(),
        priorReview={**revise_review(), "draftId": "draft-2", "revision": 2},
    ), "original revision-1"),
])
def test_one_revision_boundary_rejects_id_reuse_and_third_pass_targets(factory, mutation, message):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory is revision_input else ContentDraft
    with pytest.raises(ValidationError, match=message):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "mutation"), [
    (original_input, lambda value: value["referencedMoments"][0].update(startSec="1")),
    (original_input, lambda value: value["referencedMoments"][0].update(startSec=True)),
    (original_input, lambda value: value["brief"].update(priority=True)),
    (original_input, lambda value: value["editorialItem"].update(priority=True)),
    (original_input, lambda value: value["editorialItem"].update(selectionScore=True)),
    (original_draft, lambda value: value.update(evidenceRefs=("moment-1",))),
    (original_draft, lambda value: value.update(claims=(value["claims"][0],))),
    (original_draft, lambda value: value.update(assumptions=(value["assumptions"][0],))),
    (original_draft, lambda value: value.update(appliedConstraints=(value["appliedConstraints"][0],))),
    (original_draft, lambda value: value.update(addressedIssueIds=())),
    (original_input, lambda value: value.update(referencedMoments=tuple(value["referencedMoments"]))),
    (original_input, lambda value: value.update(referencedAngles=tuple(value["referencedAngles"]))),
    (original_input, lambda value: value.update(constraints=tuple(value["constraints"]))),
    (revise_review, lambda value: value.update(issues=tuple(value["issues"]))),
    (revise_review, lambda value: value["issues"][0].update(evidenceRefs=("moment-1",))),
    (revise_review, lambda value: value["issues"][0].update(constraintRefs=())),
    (revise_review, lambda value: value.update(reviewedAt="2026-08-27 10:00:00Z")),
])
def test_complete_json_boundary_rejects_nested_coercions_and_non_json_lists(factory, mutation):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory is original_input else ContentDraft if factory is original_draft else EditorialReview
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(("factory", "mutation"), [
    (original_draft, lambda value: value["claims"][0].update(evidenceRefs=("moment-1",))),
    (original_input, lambda value: value["referencedMoments"][0].update(visualEvidenceIds=("frame-1",))),
    (original_input, lambda value: value["brief"].update(channelCandidates=("x",))),
    (original_input, lambda value: value["brief"].update(formatCandidates=("text_post",))),
    (original_input, lambda value: value["brief"].update(dependencies=())),
    (original_input, lambda value: value["brief"].update(constraints=("Use an evidence-led voice",))),
    (original_input, lambda value: value["brief"].update(evidenceRefs=("moment-1", "angle-1"))),
    (original_input, lambda value: value["editorialItem"].update(evidenceRefs=("moment-1", "angle-1"))),
    (original_input, lambda value: value["editorialItem"].update(dependencies=())),
    (original_input, lambda value: value["editorialItem"].update(constraints=("Use an evidence-led voice",))),
    (original_input, lambda value: value["editorialItem"].update(requiredAssets=())),
])
def test_complete_json_boundary_rejects_tuple_for_every_nested_array(factory, mutation):
    payload = deepcopy(factory())
    mutation(payload)
    model = CopywriterInput if factory is original_input else ContentDraft
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize("timestamp", [
    "2026-08-27T10:00Z",
    "2026-08-27T10:00:00Z",
    "2026-08-27T10:00:00.123Z",
    "2026-08-27T10:00+00:00",
    "2026-08-27T10:00:00+00:00",
    "2026-08-27T10:00:00.123+00:00",
])
def test_review_timestamp_accepts_the_same_utc_iso_forms_as_zod(timestamp):
    payload = revise_review()
    payload["reviewedAt"] = timestamp
    assert EditorialReview.model_validate(payload).reviewedAt.isoformat().endswith("+00:00")


def test_copywriter_input_accepts_existing_typed_handoff_models_without_reparsing():
    payload = original_input()
    payload.update({
        "editorialItem": EditorialPlanItem.model_validate(payload["editorialItem"]),
        "brief": ContentBrief.model_validate(payload["brief"]),
        "referencedMoments": [Moment.model_validate(item) for item in payload["referencedMoments"]],
        "referencedAngles": [Angle.model_validate(item) for item in payload["referencedAngles"]],
    })

    result = CopywriterInput.model_validate(payload)
    assert isinstance(result.editorialItem, EditorialPlanItem)
    assert isinstance(result.brief, ContentBrief)
    assert isinstance(result.referencedMoments[0], Moment)
    assert isinstance(result.referencedAngles[0], Angle)


@pytest.mark.parametrize(("field", "value"), [
    ("visualHook", None),
    ("cropSuitability", None),
    ("captionSafeRegion", None),
    ("visualEvidenceIds", None),
])
def test_nested_moment_optional_fields_reject_explicit_null_but_allow_omission(field, value):
    with_null = original_input()
    with_null["referencedMoments"][0][field] = value
    with pytest.raises(ValidationError):
        CopywriterInput.model_validate(with_null)

    omitted = original_input()
    assert CopywriterInput.model_validate(omitted).referencedMoments[0].id == "moment-1"


@pytest.mark.parametrize(("collection", "index"), [
    ("referencedMoments", 0),
    ("referencedAngles", 0),
])
def test_nested_evidence_ids_are_bounded_to_100_characters(collection, index):
    accepted = original_input()
    accepted[collection][index]["id"] = "x" * 100
    if collection == "referencedMoments":
        accepted["editorialItem"]["evidenceRefs"] = ["x" * 100, "angle-1"]
        accepted["brief"]["evidenceRefs"] = ["x" * 100, "angle-1"]
    else:
        accepted["editorialItem"]["evidenceRefs"] = ["moment-1", "x" * 100]
        accepted["brief"]["evidenceRefs"] = ["moment-1", "x" * 100]
    assert CopywriterInput.model_validate(accepted)

    rejected = deepcopy(accepted)
    rejected[collection][index]["id"] = "x" * 101
    if collection == "referencedMoments":
        rejected["editorialItem"]["evidenceRefs"] = ["x" * 101, "angle-1"]
        rejected["brief"]["evidenceRefs"] = ["x" * 101, "angle-1"]
    else:
        rejected["editorialItem"]["evidenceRefs"] = ["moment-1", "x" * 101]
        rejected["brief"]["evidenceRefs"] = ["moment-1", "x" * 101]
    with pytest.raises(ValidationError):
        CopywriterInput.model_validate(rejected)


def test_nested_moment_visual_evidence_ids_are_bounded_to_100_characters():
    accepted = original_input()
    accepted["referencedMoments"][0]["visualEvidenceIds"] = ["x" * 100]
    accepted["referencedMoments"][0]["visualHook"] = "A grounded visual hook"
    assert CopywriterInput.model_validate(accepted)

    rejected = deepcopy(accepted)
    rejected["referencedMoments"][0]["visualEvidenceIds"] = ["x" * 101]
    with pytest.raises(ValidationError):
        CopywriterInput.model_validate(rejected)


@pytest.mark.parametrize("field", ["dependencies", "constraints"])
def test_nested_brief_text_items_are_nonblank_and_bounded_to_300_characters(field):
    accepted = original_input()
    accepted["brief"][field] = ["x" * 300]
    assert CopywriterInput.model_validate(accepted)

    for invalid in ("", "x" * 301):
        rejected = original_input()
        rejected["brief"][field] = [invalid]
        with pytest.raises(ValidationError):
            CopywriterInput.model_validate(rejected)
