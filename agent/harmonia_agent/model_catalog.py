"""Versioned model pricing used for estimates and budget reservations."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

PRICING_VERSION = "2026-11-03"
RATE_SOURCE = "https://dev.meta.ai/docs/pricing-rate-limits"
MILLION = Decimal("1000000")


class UnknownModelPrice(ValueError):
    """Raised when a model has no budget-authorized catalog entry."""


@dataclass(frozen=True)
class PricingEntry:
    model: str
    input_usd_per_million: Decimal
    output_usd_per_million: Decimal
    version: str = PRICING_VERSION
    source: str = RATE_SOURCE


def _entry(model: str, input_usd: str, output_usd: str, source: str = RATE_SOURCE) -> PricingEntry:
    return PricingEntry(
        model=model,
        input_usd_per_million=Decimal(input_usd),
        output_usd_per_million=Decimal(output_usd),
        source=source,
    )


# Standard-mode pay-as-you-go rates; reasoning tokens bill as output.
CATALOG = {
    "muse-spark-1.3": _entry("muse-spark-1.3", "1.25", "4.25"),
    "muse-spark-1.2": _entry("muse-spark-1.2", "1.25", "4.25"),
    "muse-spark-1.1": _entry("muse-spark-1.1", "1.25", "4.25"),
    "muse-wonder-1.0": _entry("muse-wonder-1.0", "4.00", "20.00"),
    "meta-models/muse-spark-open-1026": _entry(
        "meta-models/muse-spark-open-1026", "1.25", "4.25",
        source="https://www.baseten.co/pricing/",
    ),
}

# Web search grounding bills per query on top of the request's tokens.
WEB_SEARCH_USD_PER_QUERY = Decimal("2.50") / Decimal(1000)

MEDIA_CATALOG = {
    "veo-3.1-fast-generate-001": {"unit": "second", "price": Decimal("0.080000")},
    "lyria-002": {"unit": "generation", "price": Decimal("0.060000")},
    "lyria-3-clip-preview": {"unit": "generation", "price": None},
    "lyria-3-pro-preview": {"unit": "generation", "price": None},
}


def lookup_pricing(model_id: str) -> PricingEntry:
    try:
        return CATALOG[model_id]
    except KeyError as exc:
        raise UnknownModelPrice(f"no price configured for model: {model_id}") from exc


def estimate_text_cost(model_id: str, input_tokens: int, output_tokens: int) -> Decimal:
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("token counts must be non-negative")
    entry = lookup_pricing(model_id)
    total = (
        Decimal(input_tokens) * entry.input_usd_per_million
        + Decimal(output_tokens) * entry.output_usd_per_million
    ) / MILLION
    return total.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def estimate_web_search_cost(queries: int) -> Decimal:
    if queries < 0:
        raise ValueError("query count must be non-negative")
    return (Decimal(queries) * WEB_SEARCH_USD_PER_QUERY).quantize(
        Decimal("0.000001"), rounding=ROUND_HALF_UP,
    )


def lookup_media_price(
    model_id: str, *, duration_sec: int, configured_price: str | None = None,
) -> Decimal:
    try:
        entry = MEDIA_CATALOG[model_id]
    except KeyError as exc:
        raise UnknownModelPrice(f"no media price configured for model: {model_id}") from exc
    price = Decimal(configured_price) if configured_price is not None else entry["price"]
    if price is None:
        raise UnknownModelPrice(f"deployment price is required for preview model: {model_id}")
    if duration_sec <= 0:
        raise ValueError("media duration must be positive")
    amount = price * duration_sec if entry["unit"] == "second" else price
    return amount.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
