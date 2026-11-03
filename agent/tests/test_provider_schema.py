"""Meta strict structured-output schema compatibility."""

import json

import pytest
from pydantic import BaseModel

from harmonia_agent.agent_models import SourceAnalysis
from harmonia_agent.content_artifacts import ProductionBatch
from harmonia_agent.provider_schema import meta_output_schema


def _objects(value):
    if isinstance(value, dict):
        if value.get("type") == "object":
            yield value
        for item in value.values():
            yield from _objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from _objects(item)


def test_meta_output_schema_keeps_local_constraints_and_meets_strict_subset():
    schema = meta_output_schema(SourceAnalysis)

    assert schema["properties"]["sourceDigest"]["pattern"] == "^[0-9a-f]{64}$"
    assert schema["properties"]["summary"]["maxLength"] == 2000
    for item in _objects(schema):
        assert item["additionalProperties"] is False
        assert item["required"] == list(item["properties"])


def test_meta_output_schema_converts_discriminated_unions_to_any_of():
    schema = meta_output_schema(ProductionBatch)
    payload = schema["properties"]["artifacts"]["items"]["properties"]["payload"]
    encoded = json.dumps(schema)

    assert "discriminator" not in payload
    assert "oneOf" not in encoded
    assert "allOf" not in encoded
    assert len(payload["anyOf"]) == 11
    assert "$defs" not in schema
    assert "$ref" not in encoded


def test_meta_output_schema_rejects_open_ended_maps():
    class Loose(BaseModel):
        labels: dict[str, str]

    with pytest.raises(ValueError, match="open-ended maps"):
        meta_output_schema(Loose)
