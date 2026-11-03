import httpx
import pytest

from harmonia_agent import stages
from harmonia_agent.tenant_context import tenant_scope


def test_binary_asset_upload_carries_authoritative_tenant_context(monkeypatch):
    requests = []

    def transport(self, request):
        requests.append(request)
        return httpx.Response(201, request=request)

    monkeypatch.setattr(httpx.Client, "_send_single_request", transport)
    with tenant_scope("workspace-1", "brand-1"):
        stages.web_post_raw_asset("job-1", "clip-1", "video/mp4", "a" * 64, b"video")
    assert requests[0].headers["x-workspace-id"] == "workspace-1"
    assert requests[0].headers["x-brand-id"] == "brand-1"
    assert requests[0].headers["x-action-id"] == "clip-1"
    assert requests[0].content == b"video"


def test_binary_upload_requires_tenant_before_network(monkeypatch):
    def transport(self, request):
        pytest.fail("upload reached network without tenant authority")

    monkeypatch.setattr(httpx.Client, "_send_single_request", transport)
    with pytest.raises(RuntimeError, match="tenant context required"):
        stages.web_post_raw_asset("job-1", "clip-1", "video/mp4", "a" * 64, b"video")
