from __future__ import annotations

import pytest

from harmonia_agent.publishing.uploads import UploadCheckpoint


def test_upload_checkpoint_advances_without_losing_the_session():
    checkpoint = UploadCheckpoint("https://provider.example/upload/opaque", 100, "uploading")
    assert checkpoint.advance(250).acknowledged_bytes == 250
    assert checkpoint.advance(250).session_uri == checkpoint.session_uri


def test_upload_checkpoint_never_moves_backwards():
    checkpoint = UploadCheckpoint("https://provider.example/upload/opaque", 100, "uploading")
    with pytest.raises(ValueError, match="move backwards"):
        checkpoint.advance(99)


def test_completed_upload_cannot_advance():
    checkpoint = UploadCheckpoint("https://provider.example/upload/opaque", 100, "complete")
    with pytest.raises(ValueError, match="complete"):
        checkpoint.advance(101)
