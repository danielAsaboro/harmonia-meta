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



def test_video_extraction_adds_frame_anchored_visual_evidence(monkeypatch) -> None:
    monkeypatch.setattr(media.content, "transcribe_audio", lambda *_args, **_kwargs: {
        "language": "und", "segments": [{"startSec": 0, "endSec": 4, "text": "We ship on Fridays."}],
    })
    monkeypatch.setattr(media.youtube, "probe_audio_duration", lambda _body: 8)
    monkeypatch.setattr(media.video_understanding, "has_video_stream", lambda _path: True)
    seen = {}

    def observe(path, duration, *, invocation, store_frame):
        seen.update(duration=duration, operation=invocation.operation_id)
        return [(1.5, "A dashboard chart rises on screen.", "artifact-frame-1")]

    monkeypatch.setattr(media.video_understanding, "observe_video", observe)

    result = media.extract_media(
        "source-1", "Demo", b"real-video", "video/mp4",
        invocation=InvocationContext(
            workspace_id="w1", brand_id="b1", user_id="u1", job_id="j1",
            stage="extract_sources", operation_id="op1",
        ),
        receipt_id="receipt-1",
    )

    assert [segment.id for segment in result.segments] == ["seg-1", "frame-1"]
    frame = result.segments[1]
    assert frame.locator.model_dump() == {"kind": "frame", "timestampMs": 1500, "frameArtifactId": "artifact-frame-1"}
    assert result.extractorVersion == "meta-muse-voice-transcribe-1.0+muse-spark-1.3"
    assert seen == {"duration": 8, "operation": "op1"}


def test_video_extraction_keeps_the_transcript_when_visual_analysis_fails(monkeypatch) -> None:
    monkeypatch.setattr(media.content, "transcribe_audio", lambda *_args, **_kwargs: {
        "language": "und", "segments": [{"startSec": 0, "endSec": 4, "text": "Hello."}],
    })
    monkeypatch.setattr(media.youtube, "probe_audio_duration", lambda _body: 4)
    monkeypatch.setattr(media.video_understanding, "has_video_stream", lambda _path: True)

    def fail(*_args, **_kwargs):
        raise media.video_understanding.VideoUnderstandingError("video is too long for inline visual analysis")

    monkeypatch.setattr(media.video_understanding, "observe_video", fail)

    result = media.extract_media(
        "source-1", "Demo", b"real-video", "video/mp4",
        invocation=InvocationContext(
            workspace_id="w1", brand_id="b1", user_id="u1", job_id="j1",
            stage="extract_sources", operation_id="op1",
        ),
        receipt_id="receipt-1",
    )

    assert [segment.id for segment in result.segments] == ["seg-1"]
    assert result.extractorVersion == "meta-muse-voice-transcribe-1.0"
