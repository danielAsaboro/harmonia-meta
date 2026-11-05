"""The grounding baseline checks every arm's citations the same way, offline here."""

from __future__ import annotations

import asyncio
from decimal import Decimal

import httpx

from harmonia_agent import grounding_eval

PAGE = """<html><body><p>Whenever I share a Calendly link over email, the
conversation tends to die down.</p><p>Pricing &ndash; “free forever”</p></body></html>"""


def _client(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes.get(str(request.url), httpx.Response(404))
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_quote_matching_ignores_case_spacing_quotes_and_ellipsis():
    assert grounding_eval.quote_on_page("“whenever I share a Calendly link over email, the conversation tends to die down…”", PAGE)
    assert grounding_eval.quote_on_page("Pricing - \"free forever\"", "Pricing – “free forever”")
    assert not grounding_eval.quote_on_page("Calendly is too expensive for small teams", PAGE)
    assert not grounding_eval.quote_on_page("die down", PAGE)  # too short to count as a quote


def test_each_citation_gets_one_verdict(monkeypatch):
    monkeypatch.setattr(grounding_eval, "assert_public_url", lambda url: url)
    html = {"content-type": "text/html; charset=utf-8"}
    client = _client({
        "https://forum.test/a": httpx.Response(200, headers=html, text=PAGE),
        "https://forum.test/blocked": httpx.Response(403, headers=html, text="no"),
        "https://forum.test/pdf": httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"),
        "https://forum.test/moved": httpx.Response(301, headers={"location": "https://forum.test/a"}),
    })
    quote = "the conversation tends to die down"
    assert grounding_eval.check_citation("https://forum.test/a", quote, client) == "verified"
    assert grounding_eval.check_citation("https://forum.test/moved", quote, client) == "verified"
    assert grounding_eval.check_citation("https://forum.test/a", "this sentence was never written anywhere", client) == "not_on_page"
    assert grounding_eval.check_citation("https://forum.test/missing", quote, client) == "broken"
    assert grounding_eval.check_citation("https://forum.test/blocked", quote, client) == "unreachable"
    assert grounding_eval.check_citation("https://forum.test/pdf", quote, client) == "unreachable"


def test_unresolvable_host_is_broken_not_unreachable(monkeypatch):
    def refuse(url):
        raise ValueError("source hostname did not resolve")
    monkeypatch.setattr(grounding_eval, "assert_public_url", refuse)
    assert grounding_eval.check_citation("https://no-such-host.test/x", "a quote long enough", _client({})) == "broken"


def test_rate_counts_only_sources_a_reader_could_open():
    items = [{"verdict": v} for v in ("verified", "verified", "not_on_page", "broken", "unreachable", "unreachable")]
    summary = grounding_eval.summarize(items)
    assert summary == {"items": 6, "verified": 2, "not_on_page": 1, "broken": 1, "unreachable": 2, "checkable": 4, "verifiedRate": 0.5}
    assert grounding_eval.summarize([])["verifiedRate"] is None


def test_run_reports_both_arms_and_survives_a_failing_site(monkeypatch):
    async def baseline(site):
        if site == "bad.test":
            raise RuntimeError("model refused")
        return [{"kind": "pain", "url": "https://forum.test/a", "quote": "invented complaint that no one wrote"}], Decimal("0.03")

    async def harmonia(site):
        return [{"kind": "pain", "url": "https://forum.test/a", "quote": "the conversation tends to die down"}], Decimal("0.18"), 2

    monkeypatch.setattr(grounding_eval, "baseline_arm", baseline)
    monkeypatch.setattr(grounding_eval, "harmonia_arm", harmonia)
    monkeypatch.setattr(grounding_eval, "assert_public_url", lambda url: url)
    monkeypatch.setattr(grounding_eval, "_client", lambda: _client({
        "https://forum.test/a": httpx.Response(200, headers={"content-type": "text/html"}, text=PAGE)}))

    report = asyncio.run(grounding_eval.run(["good.test", "bad.test"]))

    assert report["baseline"]["not_on_page"] == 1 and report["baseline"]["verifiedRate"] == 0.0
    assert report["harmonia"]["verified"] == 2 and report["harmonia"]["verifiedRate"] == 1.0
    assert report["harmonia"]["costUsd"] == "0.36"
    assert report["perSite"][1]["baseline"] == {"error": "RuntimeError"}
    assert report["perSite"][0]["harmonia"]["droppedBeforeShipping"] == 2
    assert "text" not in str(report["perSite"][0]["baseline"]["items"][0])
