import ipaddress

import pytest

from harmonia_agent.extraction.security import UnsafeSourceUrl, assert_public_url
from harmonia_agent.extraction.web import extract_html


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/a", "http://[::1]/a", "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/a", "file:///etc/passwd",
])
def test_private_and_non_http_urls_are_rejected(url: str) -> None:
    with pytest.raises(UnsafeSourceUrl):
        assert_public_url(url, resolver=lambda _host: [ipaddress.ip_address("93.184.216.34")])


def test_public_dns_resolution_is_accepted() -> None:
    assert assert_public_url("https://example.com/launch", resolver=lambda _host: [ipaddress.ip_address("93.184.216.34")]) == "https://example.com/launch"


def test_html_extraction_preserves_canonical_url_and_headings() -> None:
    result = extract_html("s1", "https://example.com/launch", b"<h1>Launch</h1><p>Grounded proof.</p>", "text/html; charset=utf-8")
    assert result.sourceKind == "web"
    assert result.segments[0].locator.kind == "url_fragment"
    assert result.segments[0].locator.canonicalUrl == "https://example.com/launch"
    assert "Grounded proof" in " ".join(segment.text for segment in result.segments)
