from decimal import Decimal

import pytest

from harmonia_agent.model_catalog import (
    PRICING_VERSION,
    UnknownModelPrice,
    estimate_text_cost,
    lookup_pricing,
)


def test_muse_spark_cost_uses_decimal_standard_mode_rates():
    assert PRICING_VERSION == "2026-11-03"
    entry = lookup_pricing("muse-spark-1.3")
    assert entry.input_usd_per_million == Decimal("1.25")
    assert entry.output_usd_per_million == Decimal("4.25")
    assert estimate_text_cost("muse-spark-1.3", 100_000, 10_000) == Decimal("0.167500")


def test_muse_wonder_and_baseten_open_weights_are_budget_authorized():
    assert estimate_text_cost("muse-wonder-1.0", 100_000, 10_000) == Decimal("0.600000")
    entry = lookup_pricing("meta-models/muse-spark-open-1026")
    assert entry.source == "https://www.baseten.co/pricing/"
    assert estimate_text_cost("meta-models/muse-spark-open-1026", 100_000, 10_000) == Decimal("0.167500")


def test_unknown_model_price_is_not_treated_as_free():
    with pytest.raises(UnknownModelPrice):
        estimate_text_cost("unpriced-model", 100, 100)


