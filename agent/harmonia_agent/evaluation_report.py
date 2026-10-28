"""Deterministic, evidence-linked role model comparison reporting."""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from math import ceil
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from .role_models import RoleModelCatalog, load_role_model_catalog


class EvalCaseEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    case_id: str
    passed: bool
    latency_ms: int = Field(ge=0)


class EvaluationUsageEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    record_id: str
    model_id: str
    estimated_cost_usd: Decimal = Field(ge=0)
    pricing_version: str


class RoleEvaluationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: str
    model_id: str
    eval_run_id: str
    evidence_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    usage_evidence_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    cases: tuple[EvalCaseEvidence, ...] = Field(min_length=1)
    usage_records: tuple[EvaluationUsageEvidence, ...] = ()
    pricing_version: str
    policy_version: str
    minimum_pass_rate: Decimal = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_evidence_linkage(self) -> "RoleEvaluationRecord":
        case_ids = [case.case_id for case in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("eval case IDs must be unique")
        usage_ids = [usage.record_id for usage in self.usage_records]
        if len(usage_ids) != len(set(usage_ids)):
            raise ValueError("usage record IDs must be unique")
        for usage in self.usage_records:
            if usage.model_id != self.model_id:
                raise ValueError("usage model must match candidate model")
            if usage.pricing_version != self.pricing_version:
                raise ValueError("usage pricing version must match candidate pricing version")
        return self

    @computed_field
    @property
    def pass_rate(self) -> Decimal:
        passed = sum(case.passed for case in self.cases)
        return Decimal(passed) / Decimal(len(self.cases))

    @computed_field
    @property
    def case_count(self) -> int:
        return len(self.cases)

    @computed_field
    @property
    def estimated_cost_usd(self) -> Decimal | None:
        if not self.usage_records:
            return None
        return sum(
            (usage.estimated_cost_usd for usage in self.usage_records),
            start=Decimal("0"),
        )

    @computed_field
    @property
    def p95_latency_ms(self) -> int:
        ordered = sorted(case.latency_ms for case in self.cases)
        return ordered[max(0, ceil(len(ordered) * 0.95) - 1)]


class RejectedCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    record: RoleEvaluationRecord
    reason: Literal["below_quality_floor", "unknown_cost"]


class RoleComparison(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: str
    minimum_pass_rate: Decimal
    pricing_version: str
    policy_version: str
    selected_model: str | None
    eligible: tuple[RoleEvaluationRecord, ...]
    rejected: tuple[RejectedCandidate, ...]


class EvaluationEvidenceManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    eval_artifact: Path = Field(alias="evalArtifact")
    eval_artifact_sha256: str = Field(alias="evalArtifactSha256", pattern=r"^[0-9a-f]{64}$")
    usage_export: Path = Field(alias="usageExport")
    usage_export_sha256: str = Field(alias="usageExportSha256", pattern=r"^[0-9a-f]{64}$")


def _verified_json(path: Path, expected_digest: str) -> tuple[object, str]:
    raw = path.expanduser().resolve().read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_digest:
        raise ValueError(f"evidence digest mismatch for {path}")
    return json.loads(raw), digest


def load_verified_evaluation_record(
    manifest: EvaluationEvidenceManifest | dict[str, object],
    *,
    catalog: RoleModelCatalog | None = None,
) -> RoleEvaluationRecord:
    """Resolve digested eval/usage exports and bind them to the role catalog policy."""
    manifest = EvaluationEvidenceManifest.model_validate(manifest)
    artifact, artifact_digest = _verified_json(
        manifest.eval_artifact, manifest.eval_artifact_sha256,
    )
    usage_export, usage_digest = _verified_json(
        manifest.usage_export, manifest.usage_export_sha256,
    )
    if not isinstance(artifact, dict) or not isinstance(usage_export, list):
        raise ValueError("evaluation artifact or usage export has the wrong shape")
    role = str(artifact.get("role", ""))
    config = (catalog or load_role_model_catalog()).model_for(role)
    if artifact.get("policyVersion") != config.policy_version:
        raise ValueError("eval artifact policy version does not match role catalog")
    if artifact.get("pricingVersion") != config.pricing_version:
        raise ValueError("eval artifact pricing version does not match role catalog")
    if Decimal(str(artifact.get("minimumPassRate"))) != config.minimum_pass_rate:
        raise ValueError("eval artifact quality floor does not match role catalog")

    requested_usage_ids = list(artifact.get("usageRecordIds") or [])
    usage_by_id = {str(item.get("id")): item for item in usage_export if isinstance(item, dict)}
    if len(requested_usage_ids) != len(set(requested_usage_ids)):
        raise ValueError("eval artifact usage record IDs must be unique")
    if set(requested_usage_ids) != set(usage_by_id):
        raise ValueError("usage export must contain exactly the eval artifact usage IDs")
    model_id = str(artifact.get("modelId", ""))
    usage_records = []
    expected_policy = config.policy_snapshot()
    for record_id in requested_usage_ids:
        item = usage_by_id[record_id]
        if item.get("role") != role or item.get("model") != model_id:
            raise ValueError("usage record role/model does not match eval artifact")
        if item.get("pricingVersion") != config.pricing_version:
            raise ValueError("usage record pricing version does not match role catalog")
        if item.get("modelPolicy") != expected_policy:
            raise ValueError("usage record model policy does not match role catalog")
        usage_records.append(EvaluationUsageEvidence(
            record_id=record_id,
            model_id=model_id,
            estimated_cost_usd=item["estimatedCostUsd"],
            pricing_version=item["pricingVersion"],
        ))
    return RoleEvaluationRecord(
        role=role,
        model_id=model_id,
        eval_run_id=str(artifact.get("runId", "")),
        evidence_digest=artifact_digest,
        usage_evidence_digest=usage_digest,
        cases=tuple(EvalCaseEvidence.model_validate({
            "case_id": item["caseId"],
            "passed": item["passed"],
            "latency_ms": item["latencyMs"],
        }) for item in artifact.get("cases") or []),
        usage_records=tuple(usage_records),
        pricing_version=config.pricing_version,
        policy_version=config.policy_version,
        minimum_pass_rate=config.minimum_pass_rate,
    )


def compare_role_candidates(
    records: list[RoleEvaluationRecord], *, minimum_pass_rate: Decimal | str | None = None,
) -> RoleComparison:
    if not records:
        raise ValueError("at least one role evaluation record is required")
    roles = {record.role for record in records}
    policies = {record.policy_version for record in records}
    prices = {record.pricing_version for record in records}
    configured_floors = {record.minimum_pass_rate for record in records}
    if len(roles) != 1:
        raise ValueError("candidate records must use one role")
    if len(policies) != 1:
        raise ValueError("candidate records must use one policy version")
    if len(prices) != 1:
        raise ValueError("candidate records must use one pricing version")
    if len(configured_floors) != 1:
        raise ValueError("candidate records must use one configured quality floor")

    configured_floor = next(iter(configured_floors))
    floor = configured_floor if minimum_pass_rate is None else Decimal(minimum_pass_rate)
    if floor != configured_floor:
        raise ValueError("requested quality floor does not match the recorded role policy")
    if not 0 <= floor <= 1:
        raise ValueError("minimum pass rate must be between 0 and 1")
    eligible: list[RoleEvaluationRecord] = []
    rejected: list[RejectedCandidate] = []
    for record in records:
        if record.pass_rate < floor:
            rejected.append(RejectedCandidate(
                record=record, reason="below_quality_floor",
            ))
        elif record.estimated_cost_usd is None:
            rejected.append(RejectedCandidate(
                record=record, reason="unknown_cost",
            ))
        else:
            eligible.append(record)
    eligible.sort(key=lambda item: (
        -item.pass_rate,
        item.estimated_cost_usd,
        item.p95_latency_ms,
        item.model_id,
    ))
    return RoleComparison(
        role=next(iter(roles)),
        minimum_pass_rate=floor,
        pricing_version=next(iter(prices)),
        policy_version=next(iter(policies)),
        selected_model=eligible[0].model_id if eligible else None,
        eligible=tuple(eligible),
        rejected=tuple(rejected),
    )


def comparison_markdown(comparison: RoleComparison) -> str:
    lines = [
        f"# Model comparison: {comparison.role}",
        "",
        f"Quality floor: {comparison.minimum_pass_rate}",
        f"Selected model: {comparison.selected_model or 'none'}",
        f"Policy version: {comparison.policy_version}",
        f"Pricing version: {comparison.pricing_version}",
        "",
        "| Model | Pass rate | Cost USD | p95 ms | Evidence | Decision |",
        "|---|---:|---:|---:|---|---|",
    ]
    for record in comparison.eligible:
        lines.append(
            f"| {record.model_id} | {record.pass_rate} | "
            f"{record.estimated_cost_usd} | {record.p95_latency_ms} | "
            f"{record.eval_run_id}:{record.evidence_digest[:12]} | eligible |",
        )
    for item in comparison.rejected:
        record = item.record
        lines.append(
            f"| {record.model_id} | {record.pass_rate} | "
            f"{record.estimated_cost_usd if record.estimated_cost_usd is not None else 'unknown'} | "
            f"{record.p95_latency_ms} | {record.eval_run_id}:{record.evidence_digest[:12]} | "
            f"{item.reason} |",
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--minimum-pass-rate")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args()
    records = [load_verified_evaluation_record(item) for item in json.loads(
        args.input.read_text(encoding="utf-8"),
    )]
    comparison = compare_role_candidates(
        records, minimum_pass_rate=args.minimum_pass_rate,
    )
    if args.format == "markdown":
        print(comparison_markdown(comparison), end="")
    else:
        print(comparison.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
