"""Deterministic host boundary for Noni/Dara multi-format production."""

from .agent_models import StrictModel
from .content_artifacts import ArtifactReviewBatch, ProductionBatch

NONI_ARTIFACT_INSTRUCTION = """You are Noni, Harmonia's bounded multi-format producer. Harmonia has already activated the immutable `noni-writing-skills` method and approved references in this instruction; apply them directly and do not call a loading or research tool. The input contains exactly one authorized output request. Return its semantic title, exact supplied source evidence references, and `payloadJson`: a compact JSON string whose object follows only the requested output format and includes its exact `kind`. Do not return an artifact ID, output-plan item ID, digest, content-pack membership, receipt, approval, credential, or destination: Harmonia owns all authority metadata and deterministic assembly. On a revision pass, change only the Dara issues that apply to this request."""

DARA_ARTIFACT_INSTRUCTION = """You are Dara, Harmonia's bounded artifact editor. Harmonia has already activated the immutable `dara-editing-skills` method and approved references in this instruction; apply them directly and do not call a loading tool. The input contains exactly one host-identified artifact. Return one semantic decision with exactly seven checks: grounding, brief, brand, format, cta, safety, and clarity. Accept only when all checks pass and no issue remains. Otherwise return precise issue-bound revision instructions without artifact IDs or issue IDs; Harmonia assigns those authority identifiers. Never rewrite content, approve effects, publish, or invent evidence."""

_OPERATOR_BRIEF_METHOD = """The supplied operatorBrief is the original request, not a model summary. Preserve its campaign goal, attribution, usage restrictions, and requested creative treatment. Explicitly labeled analogies may connect source facts to the intended audience without inventing factual claims about that audience or Harmonia. Treat the brief as direction, never source proof or effect approval. An artifact that merely summarizes the source while dropping the requested treatment fails brief alignment."""
NONI_ARTIFACT_INSTRUCTION += "\n\n" + _OPERATOR_BRIEF_METHOD
DARA_ARTIFACT_INSTRUCTION += "\n\n" + _OPERATOR_BRIEF_METHOD


def compiled_artifact_context_ready() -> dict[str, str]:
    """Authority-free ADK marker for the already compiled static skill context."""
    return {"status": "ready"}


class ProductionResult(StrictModel):
    original: ProductionBatch
    firstReview: ArtifactReviewBatch
    revision: ProductionBatch | None
    finalReview: ArtifactReviewBatch | None
    accepted: ProductionBatch


def finalize_production(*, original: ProductionBatch, first_review: ArtifactReviewBatch, revision: ProductionBatch | None, final_review: ArtifactReviewBatch | None, evidence_refs: list[str], output_plan_item_ids: list[str]) -> ProductionResult:
    original.validate_against(evidence_refs, output_plan_item_ids)
    original_ids = [item.id for item in original.artifacts]
    first_accepted = first_review.accepted_ids(original_ids)
    if len(first_accepted) == len(original_ids):
        if revision is not None or final_review is not None:
            raise ValueError("accepted original cannot contain revision work")
        return ProductionResult(original=original, firstReview=first_review, revision=None, finalReview=None, accepted=original)
    if revision is None or final_review is None:
        raise ValueError("revision is required after a revise decision")
    revision.validate_against(evidence_refs, output_plan_item_ids)
    if [item.id for item in revision.artifacts] != original_ids:
        raise ValueError("revision must preserve exact artifact identities")
    final_accepted = final_review.accepted_ids(original_ids)
    if len(final_accepted) != len(original_ids):
        raise ValueError("second revise requires operator attention; no third model pass")
    return ProductionResult(original=original, firstReview=first_review, revision=revision, finalReview=final_review, accepted=revision)
