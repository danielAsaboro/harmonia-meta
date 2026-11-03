"""ADK evalset loading and private evidence boundaries."""

from __future__ import annotations

import json
import asyncio
from pathlib import Path

import pytest
from google.adk.evaluation.eval_case import IntermediateData
from google.genai import types

from harmonia_agent.evaluation_runner import (
    EvaluationPrivacyError,
    load_eval_set,
    run_live_eval,
    validate_eval_set_privacy,
)
from harmonia_agent.evaluation_contracts import adk_contract_metric


def test_public_evalset_is_adk_pydantic_valid():
    eval_set = load_eval_set(Path("evals/contracts.evalset.json"))

    assert eval_set.eval_set_id == "harmonia-contracts-v1"
    assert {case.eval_id for case in eval_set.eval_cases} >= {
        "route-analyst", "copywriter-references", "editor-preservation", "liaison-read-only",
    }
    validate_eval_set_privacy(eval_set)


def test_noni_and_dara_public_cases_route_to_exact_specialists():
    eval_set = load_eval_set(Path("evals/contracts.evalset.json"))
    production_cases = [
        case for case in eval_set.eval_cases
        if case.eval_id in {"copywriter-references", "editor-preservation"}
    ]
    expected = {"copywriter-references": "noni_copywriter", "editor-preservation": "dara_editor"}
    for case in production_cases:
        tool_args = case.conversation[0].intermediate_data.tool_uses[0].args
        assert tool_args == {"agent_name": expected[case.eval_id]}


def test_adk_custom_metric_executes_grounding_contract():
    expected = load_eval_set(Path("evals/contracts.evalset.json")).eval_cases[0].conversation
    actual = [expected[0].model_copy(update={
        "final_response": types.Content(
            role="model",
            parts=[types.Part(text=(
                '{"summary":"Synthetic","moments":[{"id":"m1","title":"Bad",'
                '"startSec":0,"endSec":9,"hook":"Bad","quote":"invented"}],"angles":[]}'
            ))],
        ),
    })]

    result = adk_contract_metric(None, actual, expected)

    assert result.overall_score == 0.0


@pytest.mark.parametrize(("eval_id", "invalid_output"), [
    (
        "copywriter-references",
        '{"id":"d1","planId":"plan-1","planDigest":"bad"}',
    ),
    (
        "editor-preservation",
        '{"id":"review-1","draftId":"invented","verdict":"accepted","issues":[]}',
    ),
])
def test_adk_custom_metric_executes_reference_preservation_contracts(
    eval_id, invalid_output,
):
    eval_set = load_eval_set(Path("evals/contracts.evalset.json"))
    expected = next(case for case in eval_set.eval_cases if case.eval_id == eval_id).conversation
    author = {
        "copywriter-references": "noni_copywriter",
        "editor-preservation": "dara_editor",
    }[eval_id]
    responses = [(author, [types.Part(text=invalid_output)])]
    actual = [expected[0].model_copy(update={
        "final_response": types.Content(
            role="model", parts=[types.Part(text='{"actions":[]}')],
        ),
        "intermediate_data": IntermediateData(
            intermediate_responses=responses,
        ),
    })]

    result = adk_contract_metric(None, actual, expected)

    assert result.overall_score == 0.0


@pytest.mark.parametrize("eval_id", ["copywriter-references", "editor-preservation"])
def test_adk_custom_metric_fails_closed_when_author_output_is_missing(eval_id):
    eval_set = load_eval_set(Path("evals/contracts.evalset.json"))
    expected = next(case for case in eval_set.eval_cases if case.eval_id == eval_id).conversation
    responses = []
    actual = [expected[0].model_copy(update={
        "final_response": types.Content(
            role="model", parts=[types.Part(text='{"actions":[]}')],
        ),
        "intermediate_data": IntermediateData(intermediate_responses=responses),
    })]

    result = adk_contract_metric(None, actual, expected)

    assert result.overall_score == 0.0


def test_public_evalset_rejects_private_source_material(tmp_path):
    path = tmp_path / "bad.evalset.json"
    path.write_text(json.dumps({
        "eval_set_id": "bad",
        "eval_cases": [{
            "evalId": "leak",
            "conversation": [{
                "userContent": {"parts": [{"text": "raw transcript: secret"}]},
            }],
        }],
    }))

    with pytest.raises(EvaluationPrivacyError, match="private source marker"):
        load_eval_set(path)


@pytest.mark.parametrize("secret", [
    "AIzaSyA_real_looking_key_material_123456",
    "gs://private-harmonia/video.mp4",
    "https://www.youtube.com/watch?v=abc12345678",
])
def test_public_evalset_rejects_credentials_and_media_uris(tmp_path, secret):
    path = tmp_path / "bad.evalset.json"
    path.write_text(json.dumps({
        "eval_set_id": "bad",
        "eval_cases": [{"evalId": "leak", "fixture": secret}],
    }))

    with pytest.raises(EvaluationPrivacyError):
        load_eval_set(path)


def test_public_evalset_rejects_unlisted_fixture_and_short_freeform_prompt(tmp_path):
    path = tmp_path / "bad.evalset.json"
    path.write_text(json.dumps({
        "eval_set_id": "bad",
        "eval_cases": [{
            "evalId": "route-analyst",
            "fixture": "public:route:nimi_analyst",
            "conversation": [{
                "userContent": {"parts": [{"text": "A short but unreviewed source excerpt."}]},
            }],
        }],
    }))

    with pytest.raises(EvaluationPrivacyError, match="unlisted public fixture text"):
        load_eval_set(path)


def test_private_evalset_still_rejects_embedded_credentials(tmp_path):
    path = tmp_path / "private.evalset.json"
    path.write_text(json.dumps({
        "eval_set_id": "private",
        "eval_cases": [{
            "evalId": "private-case",
            "conversation": [{
                "userContent": {"parts": [{"text": "Authorization: Bearer secret-token"}]},
            }],
        }],
    }))

    with pytest.raises(EvaluationPrivacyError, match="credential-shaped"):
        load_eval_set(path, public=False)


def test_live_eval_requires_private_output_root(monkeypatch, tmp_path):
    monkeypatch.setenv("HARMONIA_REAL_EVAL", "1")
    monkeypatch.delenv("HARMONIA_EVAL_EVIDENCE_ROOT", raising=False)

    with pytest.raises(RuntimeError, match="HARMONIA_EVAL_EVIDENCE_ROOT"):
        asyncio.run(run_live_eval(
            evalset_path=Path("evals/contracts.evalset.json"),
            output_path=tmp_path / "results.json",
            agent_module="harmonia_agent",
            num_runs=1,
        ))


def test_live_eval_refuses_output_outside_private_root(monkeypatch, tmp_path):
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    monkeypatch.setenv("HARMONIA_REAL_EVAL", "1")
    monkeypatch.setenv("HARMONIA_EVAL_EVIDENCE_ROOT", str(evidence))

    with pytest.raises(RuntimeError, match="private evidence root"):
        asyncio.run(run_live_eval(
            evalset_path=Path("evals/contracts.evalset.json"),
            output_path=tmp_path / "outside.json",
            agent_module="harmonia_agent",
            num_runs=1,
        ))


def test_live_eval_refuses_relative_private_root(monkeypatch, tmp_path):
    monkeypatch.setenv("HARMONIA_REAL_EVAL", "1")
    monkeypatch.setenv("HARMONIA_EVAL_EVIDENCE_ROOT", "relative/evidence")

    with pytest.raises(RuntimeError, match="must be absolute"):
        asyncio.run(run_live_eval(
            evalset_path=Path("evals/contracts.evalset.json"),
            output_path=tmp_path / "results.json",
            agent_module="harmonia_agent",
            num_runs=1,
        ))


def test_live_eval_awaits_adk_with_explicit_config(monkeypatch, tmp_path):
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    calls = []

    async def fake_evaluate(**kwargs):
        calls.append(kwargs)

    monkeypatch.setenv("HARMONIA_REAL_EVAL", "1")
    monkeypatch.setenv("HARMONIA_EVAL_EVIDENCE_ROOT", str(evidence))
    monkeypatch.setattr(
        "harmonia_agent.evaluation_runner.AgentEvaluator.evaluate_eval_set",
        fake_evaluate,
    )

    asyncio.run(run_live_eval(
        evalset_path=Path("evals/contracts.evalset.json"),
        output_path=evidence / "results.json",
        agent_module="harmonia_agent",
        num_runs=1,
    ))

    assert calls[0]["num_runs"] == 1
    assert calls[0]["eval_config"].criteria["tool_trajectory_avg_score"] == 1.0
    assert calls[0]["eval_config"].criteria["harmonia_contract_score"] == 1.0
    assert "harmonia_contract_score" in calls[0]["eval_config"].custom_metrics
    assert calls[0]["output_file"] == str((evidence / "results.json").resolve())
