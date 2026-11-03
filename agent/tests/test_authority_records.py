from pathlib import Path

from harmonia_agent.authority_records import (
    authority_read_record,
    skill_activation_records,
    validate_skill_activation,
)


def test_compiled_skill_records_are_host_activations_not_tool_calls(tmp_path: Path) -> None:
    root = tmp_path / "demo-skill"
    (root / "references").mkdir(parents=True)
    (root / "SKILL.md").write_text("# Demo\n", encoding="utf-8")
    (root / "references" / "method.md").write_text("Approved method.\n", encoding="utf-8")

    records = skill_activation_records(
        skill_name="demo-skill",
        skill_root=root,
        references=("references/method.md",),
    )

    assert [item["kind"] for item in records] == ["skill_activation", "skill_resource_activation"]
    assert all(item["owner"] == "harmonia_coordinator" for item in records)
    assert all("name" not in item and "args" not in item for item in records)
    validate_skill_activation(
        records,
        skill_name="demo-skill",
        skill_root=root,
        allowed_references=("references/method.md",),
    )


def test_authority_read_binds_the_exact_host_value_without_embedding_it() -> None:
    record = authority_read_record(
        authority="planning_snapshot",
        authority_id="snapshot-1",
        value={"snapshotId": "snapshot-1", "capacity": 3},
    )

    assert record["kind"] == "authority_read"
    assert record["owner"] == "harmonia_coordinator"
    assert record["authorityId"] == "snapshot-1"
    assert record["contentDigest"] == "c03830bb0b52642d6c66b172448d5d9a851b21e2f805017f485667408dcf399c"
    assert "value" not in record and "response" not in record
