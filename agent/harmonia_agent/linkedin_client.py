"""Official LinkedIn versioned Posts API adapter."""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx


class LinkedInError(RuntimeError):
    pass


def _author(destination: dict[str, str]) -> str:
    kind, identifier = destination.get("kind"), destination.get("id", "").strip()
    if not identifier:
        raise LinkedInError("LinkedIn destination id is required")
    if kind == "linkedin_member":
        return f"urn:li:person:{identifier}"
    if kind == "linkedin_organization":
        return f"urn:li:organization:{identifier}"
    raise LinkedInError("unsupported LinkedIn destination")


class LinkedInClient:
    def __init__(self, access_token: str, *, api_version: str | None = None, transport=None):
        if not access_token:
            raise LinkedInError("workspace LinkedIn connection is not configured")
        self.access_token = access_token
        self.api_version = api_version or os.environ.get("LINKEDIN_API_VERSION", "202606")
        if not (len(self.api_version) == 6 and self.api_version.isdigit()):
            raise LinkedInError("LINKEDIN_API_VERSION must use YYYYMM")
        self.transport = transport

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}", "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": self.api_version, "Content-Type": "application/json"}

    def publish_post(self, body: str, destination: dict[str, str]) -> dict[str, str]:
        if not body.strip() or len(body) > 3000:
            raise LinkedInError("LinkedIn post body must contain 1-3000 characters")
        author = _author(destination)
        payload = {"author": author, "commentary": body, "visibility": "PUBLIC", "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []}, "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": False}
        with httpx.Client(timeout=30, transport=self.transport) as client:
            response = client.post("https://api.linkedin.com/rest/posts", headers=self._headers(), json=payload)
        if response.status_code != 201:
            raise LinkedInError(f"LinkedIn post create failed: {response.status_code} {response.text[:200]}")
        post_id = response.headers.get("x-restli-id")
        if not post_id:
            raise LinkedInError("LinkedIn create response omitted x-restli-id")
        return {"id": post_id, "url": f"https://www.linkedin.com/feed/update/{post_id}/"}

    def get_post(self, post_id: str, destination: dict[str, str]) -> dict[str, str]:
        with httpx.Client(timeout=20, transport=self.transport) as client:
            response = client.get(f"https://api.linkedin.com/rest/posts/{quote(post_id, safe='')}", headers=self._headers())
        if response.status_code != 200:
            raise LinkedInError(f"LinkedIn post read failed: {response.status_code} {response.text[:200]}")
        data = response.json()
        if data.get("author") != _author(destination):
            raise LinkedInError("LinkedIn readback author mismatch")
        text = data.get("commentary")
        if not isinstance(text, str):
            raise LinkedInError("LinkedIn readback omitted commentary")
        return {"id": post_id, "text": text, "author": data["author"], "url": f"https://www.linkedin.com/feed/update/{post_id}/"}
