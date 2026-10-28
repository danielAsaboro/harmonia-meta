"""Managed Google ADK presentation-agent boundary for Harmonia A2UI."""

from __future__ import annotations

import re
from collections.abc import Callable

from .a2ui_models import SurfacePlan, UiContext
from .agents import AgentProtocolError, _run_coordinator, _validated_state
from .team_runtime import TeamRuntime
from .usage import InvocationContext
from .web_client import report_usage, reserve_budget


_AUTHORITY_TITLE = re.compile(
    r"\b(?:approved|rejected|published|verified|executed|scheduled|authorized)\b",
    re.IGNORECASE,
)
_REF_FIELDS = ("draftIds", "momentIds", "sourceIds", "assetActionIds", "actionIds", "receiptIds")
_ALLOWED_REFS = {
    "CampaignBrief": frozenset(),
    "JobProgress": frozenset(),
    "MomentExplorer": frozenset({"momentIds"}),
    "DraftComparison": frozenset({"draftIds"}),
    "PlatformPreview": frozenset({"draftIds", "assetActionIds"}),
    "SourceEvidence": frozenset({"sourceIds"}),
    "ApprovalReview": frozenset({"actionIds"}),
    "VerificationReceipt": frozenset({"receiptIds"}),
}


def validate_surface_plan(context: UiContext, plan: SurfacePlan) -> SurfacePlan:
    """Fail closed when Maya's graph exceeds the exact supplied presentation context."""
    if context.job is None:
        raise AgentProtocolError("Maya requires an active persisted job")
    known = {
        "draftIds": {item.id for item in context.drafts},
        "momentIds": {item.id for item in context.moments},
        "sourceIds": {item.id for item in context.sources},
        "assetActionIds": {item.actionId for item in context.assets},
        "actionIds": {item.id for item in context.actions},
        "receiptIds": {item.id for item in context.receipts},
    }
    labels = {"draftIds": "draft", "momentIds": "moment", "sourceIds": "source",
              "assetActionIds": "asset action", "actionIds": "action", "receiptIds": "receipt"}
    pending_actions = {item.id for item in context.actions if item.pending}
    for surface in plan.surfaces:
        approval_nodes = [node for node in surface.nodes if node.component == "ApprovalReview"]
        if surface.slot == "approval" and len(approval_nodes) != 1:
            raise AgentProtocolError("Maya approval surface requires exactly one ApprovalReview")
        for node in surface.nodes:
            if node.title and _AUTHORITY_TITLE.search(node.title):
                raise AgentProtocolError("Maya title claims lifecycle authority")
            if node.refs.jobId != context.job.id:
                raise AgentProtocolError("Maya node must reference the exact active job")
            allowed = _ALLOWED_REFS[node.component]
            for field in _REF_FIELDS:
                values = getattr(node.refs, field)
                if values and field not in allowed:
                    raise AgentProtocolError(f"Maya {node.component} cannot use {field}")
                unknown = set(values) - known[field]
                if unknown:
                    raise AgentProtocolError(f"Maya references unknown {labels[field]} ids: {sorted(unknown)}")
            if node.component == "MomentExplorer" and not node.refs.momentIds:
                raise AgentProtocolError("Maya MomentExplorer requires momentIds")
            if node.component == "DraftComparison" and not node.refs.draftIds:
                raise AgentProtocolError("Maya DraftComparison requires draftIds")
            if node.component == "PlatformPreview" and len(node.refs.draftIds) != 1:
                raise AgentProtocolError("Maya PlatformPreview requires exactly one draftId")
            if node.component == "SourceEvidence" and not node.refs.sourceIds:
                raise AgentProtocolError("Maya SourceEvidence requires sourceIds")
            if node.component == "ApprovalReview":
                if surface.slot != "approval":
                    raise AgentProtocolError("Maya ApprovalReview requires the approval slot")
                if len(node.refs.actionIds) != 1:
                    raise AgentProtocolError("Maya ApprovalReview requires exactly one actionId")
                if node.refs.actionIds[0] not in pending_actions:
                    raise AgentProtocolError("Maya ApprovalReview requires a pending action")
            if node.component == "VerificationReceipt" and len(node.refs.receiptIds) != 1:
                raise AgentProtocolError("Maya VerificationReceipt requires exactly one receiptId")
    return plan


async def plan_surface(
    context: UiContext,
    *,
    invocation: InvocationContext,
    team_runtime: TeamRuntime | None = None,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> SurfacePlan:
    """Generate and validate one reference-only presentation plan."""
    validated = UiContext.model_validate(context)
    state = await _run_coordinator(
        "maya_presenter",
        validated,
        invocation=invocation,
        team_runtime=team_runtime,
        budget_reserver=budget_reserver,
        usage_reporter=usage_reporter,
    )
    return validate_surface_plan(validated, _validated_state(state, "surface_plan", SurfacePlan))
