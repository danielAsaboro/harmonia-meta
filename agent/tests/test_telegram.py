from pathlib import Path


def test_worker_telegram_surface_is_notification_only():
    source = (Path(__file__).parents[1] / "harmonia_agent" / "telegram_bot.py").read_text()
    assert "getUpdates" not in source
    assert "callback_query" not in source
    assert "decide(" not in source
