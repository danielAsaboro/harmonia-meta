import json
import httpx
import pytest

from harmonia_agent.linkedin_client import LinkedInClient, LinkedInError
from harmonia_agent.effect_executor import linkedin_publish_adapter


def test_publish_binds_exact_author_and_reads_post_back():
    seen = []
    def handler(request):
        seen.append(request)
        if request.method == "POST":
            return httpx.Response(201, headers={"x-restli-id": "urn:li:share:123"}, json={})
        return httpx.Response(200, json={"author": "urn:li:organization:77", "commentary": "Exact approved body"})
    client = LinkedInClient("token", transport=httpx.MockTransport(handler))
    posted = client.publish_post("Exact approved body", {"kind": "linkedin_organization", "id": "77"})
    observed = client.get_post(posted["id"], {"kind": "linkedin_organization", "id": "77"})
    submitted = json.loads(seen[0].content)
    assert submitted["author"] == "urn:li:organization:77"
    assert submitted["commentary"] == "Exact approved body"
    assert observed["text"] == "Exact approved body"


def test_readback_rejects_author_mismatch():
    client = LinkedInClient("token", transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"author": "urn:li:person:other", "commentary": "Body"})))
    with pytest.raises(LinkedInError, match="author mismatch"):
        client.get_post("urn:li:share:123", {"kind": "linkedin_member", "id": "me"})


def test_effect_adapter_receipts_exact_body_digest(monkeypatch):
    monkeypatch.setattr(LinkedInClient, "publish_post", lambda self, body, destination: {"id": "urn:li:share:123", "url": "https://www.linkedin.com/feed/update/urn:li:share:123/"})
    result = linkedin_publish_adapter({"body": "Exact approved body", "destination": {"kind": "linkedin_member", "id": "me"}}, "token")
    assert result["outcome"] == "applied"
    assert result["detail"]["id"] == "urn:li:share:123"
    assert result["artifact"]["digest"] == "be2201c66cb053fa0485169bcc35d1b4e94e261ed4b1d41c32f1001cfbe80f5c"
