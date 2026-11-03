from pathlib import Path


def test_scheduler_never_calls_platform_adapters_directly():
    source = (Path(__file__).parents[1] / "harmonia_agent" / "scheduler.py").read_text()
    assert "x_client" not in source
    assert "publish_post" not in source
