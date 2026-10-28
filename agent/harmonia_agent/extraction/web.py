"""Bounded HTML normalization for already-authorized public responses."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from urllib.parse import urldefrag

from bs4 import BeautifulSoup

from ..agent_models import ContentSegment, NormalizedSource, UrlFragmentLocator


class WebExtractionError(ValueError):
    pass


def extract_html(source_id: str, url: str, body: bytes, content_type: str, *, receipt_id: str = "local-extraction") -> NormalizedSource:
    if len(body) > 5 * 1024 * 1024:
        raise WebExtractionError("web response exceeds byte limit")
    if content_type.split(";", 1)[0].strip().lower() not in {"text/html", "application/xhtml+xml"}:
        raise WebExtractionError("unsupported web content type")
    soup = BeautifulSoup(body, "html.parser")
    for node in soup(["script", "style", "noscript", "iframe", "object"]):
        node.decompose()
    canonical = urldefrag(url)[0]
    segments: list[ContentSegment] = []
    for index, node in enumerate(soup.find_all(["h1", "h2", "h3", "p", "li"]), 1):
        text = " ".join(node.get_text(" ", strip=True).split())
        if not text:
            continue
        fragment = node.get("id") or f"content-{index}"
        segments.append(ContentSegment(
            id=f"seg-{len(segments) + 1}", text=text,
            locator=UrlFragmentLocator(canonicalUrl=canonical, fragment=fragment),
            digest=sha256(text.encode()).hexdigest(),
        ))
    if not segments:
        raise WebExtractionError("web page has no extractable text")
    title = soup.title.get_text(strip=True) if soup.title else canonical
    return NormalizedSource(
        sourceId=source_id, sourceKind="web", title=title, mimeType="text/html",
        contentDigest=sha256(body).hexdigest(), extractorVersion="web-v1",
        extractedAt=datetime.now(timezone.utc), segments=segments,
        metadata={"canonicalUrl": canonical}, extractionReceiptId=receipt_id,
    )
