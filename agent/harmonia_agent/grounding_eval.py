"""Baseline comparison: does a cited customer quote actually appear on the page it cites?

    cd agent && .venv/bin/python -m harmonia_agent.grounding_eval --out ../evidence/grounding-eval.json

For each startup website, two arms do the same research job with the same model and
the same Meta ``web_search`` tool:

- ``baseline``: one plain Muse Spark call asked for competitors and customer complaints,
  each with a source URL and a short quote. Nothing checks its answer.
- ``harmonia``: the full website onboarding (``brand_onboarding.onboard_website``), whose
  research keeps an item only when Meta's search returned its source and text.

Then one independent check, identical for both arms and not part of either: fetch every
cited URL and look for the quote on the page. Each item ends up ``verified`` (the page
loads and contains the quote), ``not_on_page`` (the page loads but the quote is not
there), ``broken`` (404, 410 or no such host) or ``unreachable`` (the site blocked us, or
the page is not HTML). The headline rate is verified / (verified + not_on_page + broken):
of the sources a reader could open, how many back the quote.

The report keeps URLs, verdicts, counts and costs, never page text.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel, ConfigDict, Field

from . import brand_onboarding
from .brand_onboarding import _structured, crawl_site
from .extraction.security import assert_public_url
from .model_catalog import PRICING_VERSION, estimate_text_cost, estimate_web_search_cost
from .role_models import DEFAULT_META_MODEL

DEFAULT_SITES: tuple[str, ...] = (
    "cal.com", "linear.app", "posthog.com", "resend.com", "supabase.com",
    "plausible.io", "tally.so", "raycast.com", "loops.so", "dub.co",
)

Verdict = Literal["verified", "not_on_page", "broken", "unreachable"]

_BASELINE_INSTRUCTIONS = """You are a marketer preparing social content for a startup. Using web search,
list up to 5 competitors buyers compare it with and up to 6 real complaints or needs from its target
customers in their own words (Reddit, Hacker News, X, review sites). For each item give the source url,
its title, and supportedText: a short quote from that source."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BaselineItem(_Strict):
    name: str = Field(description="competitor name, or a short label for the complaint")
    url: str
    title: str
    supportedText: str


class BaselineResearch(_Strict):
    competitors: list[BaselineItem]
    painSignals: list[BaselineItem]


_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def normalize_text(value: str) -> str:
    """Compare text the way a reader would: case, spacing, curly quotes and dashes ignored."""
    value = unicodedata.normalize("NFKC", value).translate(_QUOTES).casefold()
    value = re.sub(r"[\"'`*_]", "", value)
    return " ".join(value.split())


def quote_on_page(quote: str, page_text: str) -> bool:
    """True when the quote (minus surrounding quotes and a trailing ellipsis) is on the page."""
    needle = normalize_text(quote).strip(" .…")
    needle = needle.removesuffix("...").strip()
    return len(needle) >= 12 and needle in normalize_text(page_text)


def check_citation(url: str, quote: str, client: httpx.Client) -> Verdict:
    try:
        current = assert_public_url(url)
        for _ in range(6):
            response = client.get(current)
            if response.is_redirect:
                current = assert_public_url(str(response.url.join(response.headers["location"])))
                continue
            break
        else:
            return "unreachable"
    except Exception as error:  # a host that does not exist is a broken citation; anything else blocked us
        message = str(error)
        return "broken" if any(sign in message for sign in ("did not resolve", "Name or service not known", "nodename nor servname")) else "unreachable"
    if response.status_code in (404, 410):
        return "broken"
    if response.status_code >= 400 or "html" not in response.headers.get("content-type", "") or len(response.content) > 8 * 1024 * 1024:
        return "unreachable"
    text = BeautifulSoup(response.content, "html.parser").get_text(" ")
    return "verified" if quote_on_page(quote, text) else "not_on_page"


def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {verdict: sum(1 for item in items if item["verdict"] == verdict) for verdict in ("verified", "not_on_page", "broken", "unreachable")}
    checkable = counts["verified"] + counts["not_on_page"] + counts["broken"]
    return {"items": len(items), **counts, "checkable": checkable,
            "verifiedRate": round(counts["verified"] / checkable, 3) if checkable else None}


def _client() -> httpx.Client:
    return httpx.Client(timeout=15.0, follow_redirects=False,
                        headers={"User-Agent": "Mozilla/5.0 (compatible; HarmoniaGroundingEval/1.0)"})


async def baseline_arm(site: str) -> tuple[list[dict[str, str]], Decimal]:
    pages = await asyncio.to_thread(crawl_site, site)
    home = pages[0]
    request = json.dumps({"website": home.url, "homepage": " ".join(s["text"] for s in home.segments)[:8000]})
    research, provenance = await _structured(DEFAULT_META_MODEL, _BASELINE_INSTRUCTIONS, request, BaselineResearch, search=True)
    cost = estimate_text_cost(DEFAULT_META_MODEL, provenance.inputTokens, provenance.outputTokens) + estimate_web_search_cost(provenance.searchCalls)
    items = [{"kind": kind, "url": item.url, "quote": item.supportedText}
             for kind, group in (("competitor", research.competitors), ("pain", research.painSignals)) for item in group]
    return items, cost


async def harmonia_arm(site: str) -> tuple[list[dict[str, str]], Decimal, int]:
    result = await brand_onboarding.onboard_website(site)
    research = result["research"]
    items = [{"kind": "competitor", "url": item["url"], "quote": item["supportedText"]} for item in research["competitors"]]
    items += [{"kind": "pain", "url": item["url"], "quote": item["supportedText"]} for item in research["painSignals"]]
    return items, Decimal(result["cost"]["totalUsd"]), int(result["unverifiedResearchDropped"])


def _checked(items: list[dict[str, str]], client: httpx.Client) -> list[dict[str, Any]]:
    return [{"kind": item["kind"], "url": item["url"], "verdict": check_citation(item["url"], item["quote"], client)} for item in items]


async def run(sites: list[str]) -> dict[str, Any]:
    started = time.monotonic()
    per_site: list[dict[str, Any]] = []
    totals: dict[str, list[dict[str, Any]]] = {"baseline": [], "harmonia": []}
    cost = {"baseline": Decimal("0"), "harmonia": Decimal("0")}
    with _client() as client:
        for site in sites:
            entry: dict[str, Any] = {"site": site}
            try:
                items, spent = await baseline_arm(site)
                checked = await asyncio.to_thread(_checked, items, client)
                entry["baseline"] = {"summary": summarize(checked), "items": checked, "costUsd": str(spent)}
                totals["baseline"] += checked
                cost["baseline"] += spent
            except Exception as error:  # one site failing must not sink the comparison
                entry["baseline"] = {"error": type(error).__name__}
            try:
                items, spent, dropped = await harmonia_arm(site)
                checked = await asyncio.to_thread(_checked, items, client)
                entry["harmonia"] = {"summary": summarize(checked), "items": checked, "costUsd": str(spent), "droppedBeforeShipping": dropped}
                totals["harmonia"] += checked
                cost["harmonia"] += spent
            except Exception as error:
                entry["harmonia"] = {"error": type(error).__name__}
            per_site.append(entry)
            print(f"{site}: baseline {entry['baseline'].get('summary')} harmonia {entry['harmonia'].get('summary')}", file=sys.stderr)
    return {
        "eval": "harmonia-grounding-baseline",
        "version": "2026-11-05",
        "ranAt": datetime.now(timezone.utc).isoformat(),
        "model": DEFAULT_META_MODEL,
        "pricingVersion": PRICING_VERSION,
        "method": "Same model and Meta web_search in both arms; every cited URL fetched independently and searched for its quote.",
        "sites": sites,
        "baseline": {**summarize(totals["baseline"]), "costUsd": str(cost["baseline"])},
        "harmonia": {**summarize(totals["harmonia"]), "costUsd": str(cost["harmonia"])},
        "perSite": per_site,
        "elapsedSeconds": round(time.monotonic() - started, 1),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sites", nargs="*", default=list(DEFAULT_SITES))
    args = parser.parse_args(argv)
    report = asyncio.run(run(args.sites))
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({arm: report[arm] for arm in ("baseline", "harmonia")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
