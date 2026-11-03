from pathlib import Path

from harmonia_agent.youtube import download_audio, extract_video_id, iso8601_to_seconds
from harmonia_agent.stages import classify_failure
import httpx


def test_video_id_extraction():
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"


def test_bad_url_raises():
    import pytest
    from harmonia_agent.youtube import IngestError
    with pytest.raises(IngestError):
        extract_video_id("https://vimeo.com/123")


def test_iso_duration():
    assert iso8601_to_seconds("PT4M13S") == 253
    assert iso8601_to_seconds("PT1H2M3S") == 3723


def test_download_audio_uses_cookie_free_embedded_client_and_bounded_audio(monkeypatch):
    invoked = []

    class Result:
        returncode = 0
        stderr = ""

    def run(command, **kwargs):
        invoked.append((command, kwargs))
        Path(command[command.index("-o") + 1]).write_bytes(b"audio")
        return Result()

    monkeypatch.setattr("harmonia_agent.youtube.subprocess.run", run)

    audio, _digest = download_audio("https://www.youtube.com/watch?v=aqz-KE-bpKQ")

    assert audio == b"audio"
    command, options = invoked[0]
    assert command[command.index("--extractor-args") + 1] == "youtube:player_client=web_embedded"
    assert command[command.index("-f") + 1] == "bestaudio[ext=m4a][abr<=160]/bestaudio[abr<=160]/bestaudio"
    assert options["timeout"] == 600


def test_download_audio_retries_with_bounded_cookie_free_clients(monkeypatch):
    invoked = []

    class Result:
        def __init__(self, returncode, stderr=""):
            self.returncode = returncode
            self.stderr = stderr

    def run(command, **kwargs):
        invoked.append(command)
        client = command[command.index("--extractor-args") + 1]
        if client == "youtube:player_client=mweb":
            Path(command[command.index("-o") + 1]).write_bytes(b"audio")
            return Result(0)
        return Result(1, "Sign in to confirm you're not a bot")

    monkeypatch.setattr("harmonia_agent.youtube.subprocess.run", run)

    audio, _digest = download_audio("https://www.youtube.com/watch?v=aqz-KE-bpKQ")

    assert audio == b"audio"
    assert [
        command[command.index("--extractor-args") + 1] for command in invoked
    ] == [
        "youtube:player_client=web_embedded",
        "youtube:player_client=android_vr",
        "youtube:player_client=mweb",
    ]
    assert invoked[-1].count("--extractor-args") == 2
    assert "youtubepot-bgutilscript:server_home=/opt/bgutil-ytdlp-pot-provider/server" in invoked[-1]


def test_transport_failures_are_transient():
    req = httpx.Request("GET", "https://api.x.com")
    assert classify_failure(httpx.ConnectTimeout("t", request=req)) is False
