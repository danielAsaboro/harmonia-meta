"""Media normalization must not trust model-chosen evidence identities."""

from harmonia_agent.extraction import media
from harmonia_agent.usage import InvocationContext


def test_media_extraction_assigns_unique_ordered_segment_ids(monkeypatch) -> None:
    monkeypatch.setattr(media.content, "transcribe_audio", lambda *_args, **_kwargs: {
        "language": "en",
        "segments": [
            {"id": "2", "startSec": 1, "endSec": 2, "text": "First"},
            {"id": "2", "startSec": 3, "endSec": 4, "text": "Second"},
            {"id": "model-invented", "startSec": 5, "endSec": 6, "text": "Third"},
        ],
    })
    monkeypatch.setattr(media.youtube, "probe_audio_duration", lambda _body: 6)

    result = media.extract_media(
        "source-1", "Demo", b"real-media", "audio/mp4",
        invocation=InvocationContext(
            workspace_id="w1", brand_id="b1", user_id="u1", job_id="j1",
            stage="extract_sources", operation_id="op1",
        ),
        receipt_id="receipt-1",
    )

    assert [segment.id for segment in result.segments] == ["seg-1", "seg-2", "seg-3"]

