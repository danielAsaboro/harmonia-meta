from pathlib import Path
from harmonia_agent import clipper


def test_format_conversion_preserves_source_edges(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(clipper, "_run", lambda args: calls.append(args))
    clipper.render_clip(Path("source.mp4"), tmp_path / "out.mp4", 2, 17)
    filters = calls[0][calls[0].index("-vf") + 1]
    assert "force_original_aspect_ratio=decrease" in filters
    assert "pad=1080:1920:(ow-iw)/2:(oh-ih)/2" in filters
    assert "crop=" not in filters
