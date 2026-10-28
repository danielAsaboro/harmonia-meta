"""Deterministic extraction for text, Markdown, and pasted content."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from hashlib import sha256

from ..agent_models import ContentSegment, LineRangeLocator, NormalizedSource, SectionLocator


class TextExtractionError(ValueError):
    pass


def _digest(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def extract_text(source_id: str, title: str, text: str, mime_type: str, *, receipt_id: str = "local-extraction", extractor_version: str = "text-v1") -> NormalizedSource:
    if not text.strip():
        raise TextExtractionError("source text is empty")
    lines = text.splitlines()
    segments: list[ContentSegment] = []
    heading_occurrences: dict[str, int] = {}
    paragraph: list[str] = []
    paragraph_start = 1

    def emit(end_line: int) -> None:
        nonlocal paragraph
        value = "\n".join(paragraph).strip()
        if value:
            locator = LineRangeLocator(startLine=paragraph_start, endLine=end_line)
            segments.append(ContentSegment(id=f"seg-{len(segments) + 1}", text=value, locator=locator, digest=_digest(value)))
        paragraph = []

    for line_number, line in enumerate(lines, 1):
        heading = re.match(r"^#{1,6}\s+(.+?)\s*$", line) if mime_type in {"text/markdown", "text/x-markdown"} else None
        if heading:
            emit(line_number - 1)
            name = heading.group(1)
            heading_occurrences[name] = heading_occurrences.get(name, 0) + 1
            segments.append(ContentSegment(
                id=f"seg-{len(segments) + 1}", text=name,
                locator=SectionLocator(heading=name, occurrence=heading_occurrences[name]), digest=_digest(name),
            ))
            paragraph_start = line_number + 1
        elif not line.strip():
            emit(line_number - 1)
            paragraph_start = line_number + 1
        else:
            if not paragraph:
                paragraph_start = line_number
            paragraph.append(line)
    emit(len(lines))
    return NormalizedSource(
        sourceId=source_id, sourceKind="text", title=title, mimeType=mime_type,
        contentDigest=_digest(text), extractorVersion=extractor_version,
        extractedAt=datetime.now(timezone.utc), segments=segments,
        metadata={"lineCount": len(lines)}, extractionReceiptId=receipt_id,
    )
