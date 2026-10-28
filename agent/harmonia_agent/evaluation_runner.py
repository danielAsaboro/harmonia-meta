"""Load ADK evalsets safely and run explicitly authorized live evaluations."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any

from google.adk.evaluation.agent_evaluator import AgentEvaluator
from google.adk.evaluation.eval_config import EvalConfig
from google.adk.evaluation.eval_set import EvalSet


class EvaluationPrivacyError(ValueError):
    """A public evalset appears to contain private or credential material."""


_PRIVATE_MARKERS = (
    "raw transcript:",
    "gs://",
    "youtube.com/watch",
    "youtu.be/",
    "model_api_key",
    "google_api_key",
    "authorization: bearer",
)
_CREDENTIAL_MARKERS = (
    "model_api_key", "baseten_api_key", "authorization: bearer", "aiza",
)
_PUBLIC_PRODUCTION_CONTRACT_STRINGS = frozenset({
    "plan-public-v1", "brief-1", "item-1", "m1", "x", "text_post",
    "Public proof", "Source proof", "Explain the supplied synthetic proof",
    "public-operators", "consideration", "request more information",
    "invite a follow-up", "qualified replies", "planned", "high", "proof",
    "bounded proof", "Use only supplied synthetic evidence",
    "Lead with the only supplied proof.", "This is the only eligible item.",
    "The supplied source contains bounded proof.", "Direct and evidence-led.",
    "2026-09-01T12:00:00Z", "2026-09-01T16:00:00Z",
    "2026-09-01T18:00:00Z", "a" * 64,
})

_PUBLIC_FIXTURES: dict[str, tuple[str, frozenset[str]]] = {
    "route-analyst": (
        "public:route:nimi_analyst",
        frozenset({
            "route-analyst", "route-analyst-1", "public:route:nimi_analyst",
            "Delegate the public synthetic source to nimi_analyst exactly once.",
            "Delegate this request to nimi_analyst exactly once. Use the typed payload already present in managed session state.",
            "harmonia", "public-eval-user", "public-route-analyst", "synthetic demo",
            "public channel", "[0s] public synthetic source [2s] bounded proof",
            "nimi_analyst", "harmonia_coordinator", "model", "user",
            "transfer_to_agent", "agent_name", "source_analysis",
            '{"sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"Public synthetic source.","moments":[{"id":"moment-1","title":"Public proof","startSec":0,"endSec":2,"hook":"bounded proof","quote":"public synthetic source bounded proof","sourceSegmentRefs":["segment-1"],"visualEvidenceIds":[],"assumptions":[],"confidence":"high"}],"angles":[{"id":"angle-1","angleType":"source_insight","evidenceKind":"source","title":"Bounded proof","rationale":"The source contains bounded proof.","evidenceRefs":["moment-1"],"assumptions":[],"confidence":"high"}],"assumptions":[],"confidence":"high"}',
            "harmonia_contract",
            '{"kind":"analysis"}', "moment-1", "segment-1", "angle-1", "source",
            "Public proof", "Bounded proof", "Public synthetic source.",
            "public synthetic source bounded proof", "The source contains bounded proof.",
        }),
    ),
    "liaison-read-only": (
        "public:authority:liaison-read-only",
        frozenset({
            "liaison-read-only", "liaison-read-only-1",
            "public:authority:liaison-read-only",
            "Delegate this request to nova_liaison exactly once. Use the typed payload already present in managed session state.",
            "Delegate the synthetic status question to nova_liaison exactly once.",
            "harmonia", "public-eval-user", "public-liaison", "nova_liaison",
            "harmonia_coordinator", "model", "user", "transfer_to_agent", "agent_name",
            "Report the status of the synthetic job without changing it.",
            "The synthetic job status is available read-only.",
            "harmonia_contract", '{"kind":"read_only"}',
        }),
    ),
    "copywriter-references": (
        "public:contract:copywriter-references",
        frozenset({
            "copywriter-references", "copywriter-references-1",
            "public:contract:copywriter-references", "public-copywriter",
            "harmonia", "public-eval-user", "model", "user", "done",
            "Delegate the typed public fixture to noni_copywriter exactly once.",
            "harmonia_contract", "noni_copywriter", "transfer_to_agent",
            '{"kind":"draft"}',
            '{"id":"draft-1","planId":"plan-1","planDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","strategyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","editorialItemId":"item-1","briefId":"brief-1","revision":1,"platform":"x","format":"text_post","audienceId":"founders","objective":"Show verified operating proof","funnelStage":"consideration","ctaIntent":"request a demo","text":"We cut nine days to forty hours. Request a demo.","ctaTreatment":"Request a demo.","intendedConversion":"qualified demo request","evidenceRefs":["moment-1"],"claims":[{"text":"We cut nine days to forty hours.","evidenceRefs":["moment-1"]}],"assumptions":[],"confidence":"high","appliedConstraints":["Use an evidence-led voice"],"priorDraftId":null,"addressedIssueIds":[]}',
        }),
    ),
    "editor-preservation": (
        "public:contract:editor-preservation",
        frozenset({
            "editor-preservation", "editor-preservation-1",
            "public:contract:editor-preservation", "public-editor",
            "harmonia", "public-eval-user", "model", "user", "done",
            "Delegate the typed public fixture to dara_editor exactly once.",
            "harmonia_contract", "dara_editor", "transfer_to_agent",
            '{"kind":"review"}',
            '{"verdict":"accepted","checks":[{"dimension":"grounding","status":"pass","rationale":"Grounded in supplied proof.","evidenceRefs":["moment-1"],"constraintRefs":[]},{"dimension":"brief_alignment","status":"pass","rationale":"Aligned to the brief.","evidenceRefs":["moment-1"],"constraintRefs":[]},{"dimension":"brand_voice","status":"pass","rationale":"Matches the supplied voice.","evidenceRefs":[],"constraintRefs":["Use an evidence-led voice"]},{"dimension":"platform_constraints","status":"pass","rationale":"Fits the selected format.","evidenceRefs":[],"constraintRefs":[]},{"dimension":"cta","status":"pass","rationale":"Uses the exact CTA intent.","evidenceRefs":[],"constraintRefs":[]},{"dimension":"safety","status":"pass","rationale":"Observes supplied constraints.","evidenceRefs":[],"constraintRefs":["Use an evidence-led voice"]},{"dimension":"clarity","status":"pass","rationale":"One clear candidate.","evidenceRefs":[],"constraintRefs":[]}],"issues":[],"resolvedIssueIds":[]}',
        }),
    ),
}


def _serialized_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True).casefold()


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [item for key, nested in value.items() for item in (str(key), *_strings(nested))]
    if isinstance(value, list):
        return [item for nested in value for item in _strings(nested)]
    return []


def validate_eval_set_privacy(value: EvalSet | dict[str, Any]) -> None:
    """Reject source material and common credential shapes from public fixtures."""
    payload = value.model_dump(
        mode="json", by_alias=True, exclude_none=True, exclude_defaults=True,
    ) if isinstance(value, EvalSet) else value
    text = _serialized_text(payload)
    marker = next((item for item in _PRIVATE_MARKERS if item in text), None)
    if marker is not None:
        raise EvaluationPrivacyError(f"private source marker is not allowed: {marker}")
    if "aiza" in text:
        raise EvaluationPrivacyError("credential-shaped material is not allowed")
    cases = payload.get("eval_cases", [])
    for case in cases:
        case_id = case.get("evalId") or case.get("eval_id")
        configured = _PUBLIC_FIXTURES.get(case_id)
        if configured is None or case.get("fixture") != configured[0]:
            raise EvaluationPrivacyError(f"unlisted public fixture: {case_id}")
        structural_keys = {
            "evalId", "eval_id", "fixture", "conversation", "invocationId",
            "invocation_id", "userContent", "user_content", "parts", "text", "role",
            "finalResponse", "final_response", "intermediateData", "intermediate_data",
            "toolUses", "tool_uses", "name", "args", "sessionInput", "session_input",
            "appName", "app_name", "userId", "user_id", "sessionId", "session_id",
            "state", "requested_specialist", "title", "channel", "transcript",
            "reviewed_drafts", "drafts", "id", "platform", "type", "actions",
            "question", "analysis", "summary", "moments", "angles",
            "agent_name",
            "rubrics", "rubricId", "rubricContent", "textProperty",
            "intermediateResponses", "intermediate_responses",
                "kind", "angleType", "evidenceKind", "durationSec", "reviewed", "originals", "momentId",
            "startSec", "endSec", "hook", "quote",
            "sourceDigest", "sourceSegmentRefs", "visualEvidenceIds", "assumptions",
            "production_input", "planId", "strategyDigest", "editorialItem",
            "brief", "briefId", "campaignTheme", "contentPillar", "objective",
            "audienceId", "funnelStage", "intendedConversion", "ctaIntent",
            "kpi", "format", "evidenceRefs", "publicationWindowStartAt",
            "publicationWindowEndAt", "productionDeadlineAt", "priority",
            "selectionScore", "dependencies", "productionStatus", "constraints",
            "requiredAssets", "planningRationale", "selectionRationale",
            "confidence", "keyMessage", "channelCandidates", "formatCandidates",
            "referencedMoments", "referencedAngles", "brandContext",
        }
        allowed = configured[1] | structural_keys | _PUBLIC_PRODUCTION_CONTRACT_STRINGS
        unexpected = sorted({item for item in _strings(case) if item not in allowed})
        if unexpected:
            raise EvaluationPrivacyError(
                f"unlisted public fixture text in {case_id}: {unexpected[0]}",
            )


def load_eval_set(path: Path, *, public: bool = True) -> EvalSet:
    """Load an ADK 2.x evalset after checking its raw and parsed representations."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    serialized = _serialized_text(raw)
    credential = next((item for item in _CREDENTIAL_MARKERS if item in serialized), None)
    if credential is not None:
        raise EvaluationPrivacyError("credential-shaped material is not allowed")
    if public:
        validate_eval_set_privacy(raw)
    eval_set = EvalSet.model_validate(raw)
    return eval_set


def _private_output_path(output_path: Path) -> Path:
    configured = os.environ.get("HARMONIA_EVAL_EVIDENCE_ROOT")
    if not configured:
        raise RuntimeError("HARMONIA_EVAL_EVIDENCE_ROOT is required for live evaluation")
    configured_root = Path(configured).expanduser()
    if not configured_root.is_absolute():
        raise RuntimeError("HARMONIA_EVAL_EVIDENCE_ROOT must be absolute")
    root = configured_root.resolve()
    output = output_path.expanduser().resolve()
    if not output.is_relative_to(root):
        raise RuntimeError("evaluation output must stay inside the private evidence root")
    public_repo = Path(__file__).resolve().parents[2]
    if output.is_relative_to(public_repo):
        raise RuntimeError("evaluation output cannot be written inside the public repository")
    return output


async def run_live_eval(
    *, evalset_path: Path, output_path: Path, agent_module: str, num_runs: int,
) -> None:
    if os.environ.get("HARMONIA_REAL_EVAL") != "1":
        raise RuntimeError("set HARMONIA_REAL_EVAL=1 to authorize a live model evaluation")
    output_path = _private_output_path(output_path)
    eval_set = load_eval_set(evalset_path, public=False)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    await AgentEvaluator.evaluate_eval_set(
        agent_module=agent_module,
        eval_set=eval_set,
        eval_config=EvalConfig.model_validate({
            "criteria": {
                "tool_trajectory_avg_score": 1.0,
                "response_match_score": 0.8,
                "harmonia_contract_score": 1.0,
            },
            "customMetrics": {
                "harmonia_contract_score": {
                    "codeConfig": {
                        "name": "harmonia_agent.evaluation_contracts.adk_contract_metric",
                    },
                    "description": "Deterministic Harmonia grounding and authority contracts",
                },
            },
        }),
        num_runs=num_runs,
        output_file=str(output_path),
        print_detailed_results=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evalset", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--agent-module", default="harmonia_agent")
    parser.add_argument("--num-runs", type=int, default=2)
    args = parser.parse_args()
    try:
        asyncio.run(run_live_eval(
            evalset_path=args.evalset,
            output_path=args.output,
            agent_module=args.agent_module,
            num_runs=args.num_runs,
        ))
    except (EvaluationPrivacyError, RuntimeError, ValueError) as exc:
        parser.exit(2, f"evaluation refused: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
