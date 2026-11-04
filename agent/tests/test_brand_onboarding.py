import asyncio

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from harmonia_agent import brand_onboarding as onboarding
from harmonia_agent import onboarding_api
from harmonia_agent.meta_search import WebSearchCitation, WebSearchProvenance, WebSearchResult

HOME = b"""<html><head><title>Acme</title></head><body>
<h1>Acme turns client reporting into a five-minute job</h1>
<p>Agencies stop copying numbers into slides.</p>
<a href="/pricing">Pricing</a><a href="/about-us">About</a><a href="/login">Log in</a>
<a href="https://other.example/pricing">Partner</a><a href="/features">Features</a>
<a href="/privacy">Privacy</a><a href="/customers">Customers</a><a href="/blog">Blog</a>
</body></html>"""


def test_select_pages_keeps_one_same_site_link_per_role_in_priority_order():
    pages = onboarding.select_pages("https://www.acme.test/", HOME)
    assert pages == [
        ("pricing", "https://www.acme.test/pricing"),
        ("product", "https://www.acme.test/features"),
        ("about", "https://www.acme.test/about-us"),
        ("customers", "https://www.acme.test/customers"),
    ]


def test_normalize_site_url_accepts_bare_domains_and_rejects_non_domains():
    assert onboarding.normalize_site_url("Acme.test") == "https://acme.test/"
    with pytest.raises(onboarding.OnboardingError):
        onboarding.normalize_site_url("localhost")


def test_crawl_site_reads_home_and_role_pages(monkeypatch):
    monkeypatch.setattr(onboarding, "assert_public_url", lambda url: url)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(200, content=HOME, headers={"content-type": "text/html"})
        if request.url.path == "/pricing":
            return httpx.Response(200, content=b"<title>Pricing</title><p>Starts at $49 a month.</p>", headers={"content-type": "text/html"})
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    pages = onboarding.crawl_site("acme.test", client=client)
    assert [page.role for page in pages] == ["home", "pricing"]
    assert pages[1].segments[0] == {"id": "p2-seg-1", "sourceId": "p2", "text": "Starts at $49 a month."}


def _reading(**overrides):
    values = {
        "company": "Acme", "product": "Client reporting", "category": "Agency reporting software",
        "positioning": "Five-minute client reports", "differentiators": ["Automatic slides"],
        "statedCustomers": ["Agencies"], "pricingModel": "Subscription",
        "claims": [{"text": "Agencies stop copying numbers", "segmentId": "p1-seg-2"}],
        "voiceSamples": [{"text": "Acme turns client reporting into a five-minute job", "segmentId": "p1-seg-1"},
                          {"text": "invented line", "segmentId": "p1-seg-1"}],
    }
    values.update(overrides)
    return onboarding.SiteReading.model_validate(values)


def _pages():
    return [onboarding.CrawledPage(pageId="p1", role="home", url="https://acme.test/", title="Acme", segments=[
        {"id": "p1-seg-1", "sourceId": "p1", "text": "Acme turns client reporting into a five-minute job"},
        {"id": "p1-seg-2", "sourceId": "p1", "text": "Agencies stop copying numbers into slides."},
    ])]


def test_site_evidence_keeps_only_verbatim_quotes():
    reading, evidence = onboarding._site_evidence(_reading(), _pages())
    assert [item.text for item in reading.voiceSamples] == ["Acme turns client reporting into a five-minute job"]
    assert set(evidence) == {"site:p1-seg-1", "site:p1-seg-2"}


def test_site_evidence_fails_closed_without_any_real_voice_sample():
    with pytest.raises(onboarding.OnboardingError):
        onboarding._site_evidence(_reading(voiceSamples=[{"text": "made up", "segmentId": "p1-seg-1"}]), _pages())


def _provenance():
    return WebSearchProvenance(
        responseId="resp-1", model="muse-spark-1.3", searchCalls=3,
        results=[WebSearchResult(url="https://reddit.com/r/agency/1", title="Reporting is killing me", snippet="I lose a full day every month building client reports"),
                 WebSearchResult(url="https://hn.example/2", title="Ask HN", snippet="")],
        citations=[WebSearchCitation(url="https://g2.example/rival", title="Rival reviews", citedText="Rival automates dashboards")],
        inputTokens=10, outputTokens=5,
    )


def _research():
    return onboarding.MarketResearch.model_validate({
        "competitors": [
            {"name": "Rival", "positioning": "Dashboards", "url": "https://g2.example/rival", "title": "Rival reviews", "supportedText": "Rival automates dashboards"},
            {"name": "Ghost", "positioning": "Invented", "url": "https://ghost.example", "title": "Ghost", "supportedText": "not returned"},
            {"name": "Shorty", "positioning": "Listed", "url": "https://hn.example/", "title": "Ask  HN", "supportedText": "anything"},
        ],
        "painSignals": [
            {"audience": "Agency owners", "pain": "Reporting eats a day", "platform": "reddit", "url": "https://reddit.com/r/agency/1", "title": "Reporting is killing me", "supportedText": "I lose a full day every month"},
            {"audience": "Agency owners", "pain": "Own site", "platform": "blog", "url": "https://acme.test/blog", "title": "Acme", "supportedText": "x"},
            {"audience": "Agency owners", "pain": "Misquoted", "platform": "reddit", "url": "https://reddit.com/r/agency/1", "title": "Reporting is killing me", "supportedText": "words nobody wrote"},
            {"audience": "Founders", "pain": "Snippetless", "platform": "hacker_news", "url": "https://hn.example/2", "title": "Ask HN", "supportedText": "any"},
        ],
        "trends": [],
    })


def test_web_evidence_drops_uncited_and_own_site_items():
    research, evidence, dropped = onboarding._web_evidence(_research(), _provenance(), "acme.test")
    assert [(item.name, item.url) for item in research.competitors] == [("Rival", "https://g2.example/rival"), ("Shorty", "https://hn.example/2")]
    assert [item.pain for item in research.painSignals] == ["Reporting eats a day", "Snippetless"]
    assert dropped == 3
    assert [(value["kind"], value["check"]) for value in evidence.values()] == [("competitor", "quote"), ("competitor", "source"), ("pain", "quote"), ("pain", "source")]


def _brief():
    return onboarding.BrandBriefDraft.model_validate({
        "company": "Acme", "product": "Client reporting", "category": "Agency reporting software",
        "positioning": "Five-minute client reports", "differentiators": ["Automatic slides"],
        "audiences": [{"id": "agency-owners", "name": "Agency owners", "pains": ["Reporting eats a day"], "jobsToBeDone": [], "objections": [], "evidenceIds": ["web:2", "web:99"]}],
        "competitors": [{"name": "Rival", "howWeDiffer": "Slides, not dashboards", "evidenceIds": ["web:1"]},
                        {"name": "Ghost", "howWeDiffer": "Invented", "evidenceIds": ["web:42"]}],
        "pillars": [{"name": "Get your day back", "purpose": "Tie the pain to the five-minute claim", "evidenceIds": ["site:p1-seg-1"]}],
        "voiceRules": ["Plain, confident, numbers first " + "x" * 200],
        "exclusions": [], "businessObjectives": ["Grow trials"], "campaignObjectives": ["Show the time saved"],
        "funnelStage": "awareness", "intendedConversion": "Start a free trial",
    })


def test_strategy_context_matches_ryan_contract_bounds():
    context = onboarding.strategy_context_from_brief(_brief(), ["x", "linkedin"])
    assert context["company"] == "Acme"
    assert context["audiences"] == [{"id": "agency-owners", "name": "Agency owners", "pains": ["Reporting eats a day"]}]
    assert all(len(item) <= 120 for item in context["brandVoice"])
    assert context["supportedChannels"] == ["x", "linkedin"]


def test_onboard_website_runs_read_research_synthesize_with_meta_models(monkeypatch):
    calls = []
    monkeypatch.setattr(onboarding, "crawl_site", lambda url: _pages())
    monkeypatch.setattr(onboarding, "screen_pages", lambda pages: (pages, {"screenedSegments": 2}))

    research = _research()

    async def structured(model_id, _instructions, _request, output_model, *, search=False, effort="low", **_kwargs):
        calls.append((model_id, output_model.__name__, search))
        if output_model is onboarding.CompetitorResearch:
            return onboarding.CompetitorResearch(competitors=research.competitors, trends=[]), _provenance()
        if output_model is onboarding.PainResearch:
            return onboarding.PainResearch(painSignals=research.painSignals), _provenance()
        value = _reading() if output_model is onboarding.SiteReading else _brief()
        return value, WebSearchProvenance(responseId=f"resp-{len(calls)}", model=model_id, searchCalls=0, results=[], citations=[], inputTokens=1, outputTokens=1)

    monkeypatch.setattr(onboarding, "_structured", structured)
    result = asyncio.run(onboarding.onboard_website("acme.test"))
    assert calls == [
        ("muse-spark-1.3", "SiteReading", False), ("muse-spark-1.3", "CompetitorResearch", True),
        ("muse-spark-1.3", "PainResearch", True), ("muse-wonder-1.0", "BrandBriefDraft", False),
    ]
    assert [item["id"] for item in result["evidence"] if item["id"].startswith("web:")] == ["web:1", "web:2", "web:3", "web:4"]
    # Evidence ids the model invented are removed; a competitor left with none is dropped.
    assert result["brief"]["audiences"][0]["evidenceIds"] == ["web:2"]
    assert [item["name"] for item in result["brief"]["competitors"]] == ["Rival"]
    assert result["unverifiedResearchDropped"] == 3
    assert [call["step"] for call in result["modelCalls"]] == ["read_site", "research_competitors", "research_customer_pain", "synthesize_brief"]


def _app():
    app = FastAPI()
    app.include_router(onboarding_api.router)
    return TestClient(app)


def test_onboarding_endpoint_requires_internal_auth_and_tenant():
    assert _app().post("/internal/agent/onboard-website", json={"url": "acme.test"}).status_code == 401
    response = _app().post("/internal/agent/onboard-website", json={"url": "acme.test"}, headers={
        "x-harmonia-internal-token": "test-token-not-a-secret", "x-workspace-id": "../x", "x-brand-id": "b"})
    assert response.status_code == 400


def test_onboarding_endpoint_maps_failures_to_retryable_dependency_error(monkeypatch):
    async def fail(url, *, channels):
        raise onboarding.OnboardingError("could not read the website: ConnectError")

    monkeypatch.setattr(onboarding_api, "onboard_website", fail)
    response = _app().post("/internal/agent/onboard-website", json={"url": "acme.test"}, headers={
        "x-harmonia-internal-token": "test-token-not-a-secret", "x-workspace-id": "w1", "x-brand-id": "b1"})
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "website_onboarding_failed"


def _job_with_brief():
    return {"config": {"strategyContext": {
        "positioning": "Five-minute client reports", "brandVoice": ["Numbers first"], "exclusions": ["No competitor bashing"],
        "audiences": [
            {"id": "agency-owners", "name": "Agency owners", "pains": ["Reporting eats a day", "Clients ignore dashboards"]},
            {"id": "freelancers", "name": "Freelancers", "pains": ["No time to build decks"]},
        ],
    }}}


def test_nimi_receives_brief_customers_as_eligible_memory_facts():
    from harmonia_agent.stages import brand_audience_facts

    facts = brand_audience_facts(_job_with_brief())
    assert [fact.id for fact in facts] == ["memory:brief:agency-owners", "memory:brief:freelancers"]
    assert "Reporting eats a day; Clients ignore dashboards" in facts[0].content
    assert brand_audience_facts({"config": {}}) == []


def test_noni_and_dara_receive_the_briefs_target_customer_voice_and_a_pain_constraint():
    from harmonia_agent.stages import brand_writing_context

    extra, constraints = brand_writing_context(_job_with_brief(), "agency-owners")
    assert extra["targetCustomer"] == {"id": "agency-owners", "name": "Agency owners", "pains": ["Reporting eats a day", "Clients ignore dashboards"]}
    assert extra["brandVoice"] == ["Numbers first"]
    assert constraints == ["Write for Agency owners: speak to one of their pains (Reporting eats a day; Clients ignore dashboards)"]
    assert brand_writing_context(_job_with_brief(), "unknown")[1] == []
