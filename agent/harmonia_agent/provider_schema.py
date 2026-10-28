"""Meta Model API structured-output schemas built from strict local models.

Meta constrains decoding to the JSON Schema sent in
``response_format.json_schema``. ADK's LiteLLM adapter always sends
``strict: true``, so every schema here must satisfy Meta's strict subset
(docs/meta-model-api/structured-output.md, "Enforce strict mode"): a plain
object root, no ``oneOf``/``allOf``, ``additionalProperties: false`` on every
object, and every property listed in ``required``. Local Pydantic validation
stays complete; this only shapes what crosses the wire.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

_DROPPED_KEYS = {"$defs", "discriminator", "title", "default"}


def _adapt(value: Any, *, definitions: dict[str, Any], resolving: tuple[str, ...]) -> Any:
    if isinstance(value, list):
        return [_adapt(item, definitions=definitions, resolving=resolving) for item in value]
    if not isinstance(value, dict):
        return value
    reference = value.get("$ref")
    if isinstance(reference, str) and reference.startswith("#/$defs/"):
        name = reference.removeprefix("#/$defs/")
        target = definitions.get(name)
        if not isinstance(target, dict):
            raise ValueError(f"unresolved local schema reference: {reference}")
        if name in resolving:
            raise ValueError(f"Meta structured output rejects recursive schemas: {name}")
        merged = {**target, **{key: item for key, item in value.items() if key != "$ref"}}
        return _adapt(merged, definitions=definitions, resolving=(*resolving, name))
    adapted: dict[str, Any] = {}
    for key, item in value.items():
        if key in _DROPPED_KEYS:
            continue
        if key == "properties" and isinstance(item, dict):
            # Property names are data-contract keys; a field literally named
            # `title` or `default` must survive.
            adapted[key] = {
                name: _adapt(schema, definitions=definitions, resolving=resolving)
                for name, schema in item.items()
            }
        elif key == "oneOf":
            adapted["anyOf"] = _adapt(item, definitions=definitions, resolving=resolving)
        elif key == "const":
            adapted["enum"] = [item]
        else:
            adapted[key] = _adapt(item, definitions=definitions, resolving=resolving)
    if adapted.get("type") == "object":
        if isinstance(adapted.get("additionalProperties"), dict):
            raise ValueError("Meta strict structured output cannot express open-ended maps")
        adapted["additionalProperties"] = False
        properties = adapted.setdefault("properties", {})
        adapted["required"] = list(properties)
    return adapted


def meta_output_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Return the strict-subset wire schema for one structured-output model."""
    schema = model.model_json_schema()
    return _adapt(schema, definitions=schema.get("$defs") or {}, resolving=())
