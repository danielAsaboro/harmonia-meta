from __future__ import annotations

import pytest

from harmonia_agent.publishing.registry import PublishingRegistry


def test_registry_returns_the_registered_action_adapter():
    adapter = object()
    registry = PublishingRegistry({"publish_linkedin_post": adapter})
    assert registry.adapter_for("publish_linkedin_post") is adapter


def test_registry_rejects_unregistered_actions():
    with pytest.raises(RuntimeError, match="no adapter"):
        PublishingRegistry({}).adapter_for("publish_instagram_post")
