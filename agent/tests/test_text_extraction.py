import pytest

from harmonia_agent.extraction.text import TextExtractionError, extract_text


def test_text_extraction_preserves_unicode_and_one_based_lines() -> None:
    result = extract_text("source-1", "Launch notes", "Hello 🌍\n\nSecond claim", "text/plain")
    assert [segment.text for segment in result.segments] == ["Hello 🌍", "Second claim"]
    assert result.segments[0].locator.kind == "line_range"
    assert result.segments[0].locator.startLine == 1
    assert result.segments[1].locator.startLine == 3
    assert result.segments[0].digest == extract_text("source-1", "Launch notes", "Hello 🌍\n\nSecond claim", "text/plain").segments[0].digest


def test_markdown_uses_stable_section_locators() -> None:
    result = extract_text("source-1", "Brief", "# Proof\nFirst\n\n# Proof\nSecond", "text/markdown")
    sections = [segment.locator for segment in result.segments if segment.locator.kind == "section"]
    assert [(locator.heading, locator.occurrence) for locator in sections] == [("Proof", 1), ("Proof", 2)]


def test_empty_text_is_rejected() -> None:
    with pytest.raises(TextExtractionError, match="empty"):
        extract_text("source-1", "Empty", " \n\t", "text/plain")
