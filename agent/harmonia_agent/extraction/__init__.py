"""Generalized source extraction package."""

from .base import ExtractionContext, ExtractionEstimate, ExtractionResult, SourceExtractor
from .documents import extract_docx, extract_pdf
from .media import extract_media
from .text import extract_text
from .web import extract_html

__all__ = ["ExtractionContext", "ExtractionEstimate", "ExtractionResult", "SourceExtractor", "extract_docx", "extract_html", "extract_media", "extract_pdf", "extract_text"]
