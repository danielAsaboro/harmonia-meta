"""X API v2 publish, verification, and metrics client."""

from __future__ import annotations

import httpx
from collections.abc import Callable


class XError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    @property
    def permanent(self) -> bool:
        return self.status is not None and 400 <= self.status < 500 and self.status != 429


def _bearer(token: str | None) -> str:
    if not token:
        raise XError("workspace X connection is not configured", 401)
    return token


def publish_post(text: str, bearer_token: str | None = None) -> dict:
    with httpx.Client(timeout=30) as c:
        res = c.post(
            "https://api.x.com/2/tweets",
            headers={"Authorization": f"Bearer {_bearer(bearer_token)}"},
            json={"text": text},
        )
    if res.status_code not in (200, 201):
        raise XError(f"tweet create failed: {res.status_code} {res.text[:200]}", res.status_code)
    data = res.json()["data"]
    return {"id": data["id"], "url": f"https://x.com/i/web/status/{data['id']}"}


def publish_thread(
    posts: list[dict], bearer_token: str | None,
    *, confirmed: list[str], persist_confirmed: Callable[[list[str]], None],
    transport=None,
) -> dict:
    """Publish or resume an ordered X thread, durably fencing every reply."""
    if len(posts) < 2 or len(posts) > 25:
        raise XError("X thread must contain 2-25 posts")
    if len(confirmed) > len(posts):
        raise XError("confirmed thread progress exceeds requested posts")
    confirmed_ids = list(confirmed)
    with httpx.Client(timeout=30, transport=transport) as client:
        for index in range(len(confirmed_ids), len(posts)):
            text = posts[index].get("text")
            if not isinstance(text, str) or not text or len(text) > 280:
                raise XError(f"X thread post {index + 1} must contain 1-280 characters")
            payload = {"text": text}
            if confirmed_ids:
                payload["reply"] = {"in_reply_to_tweet_id": confirmed_ids[-1]}
            response = client.post(
                "https://api.x.com/2/tweets",
                headers={"Authorization": f"Bearer {_bearer(bearer_token)}"},
                json=payload,
            )
            if response.status_code not in (200, 201):
                raise XError(f"thread post create failed: {response.status_code} {response.text[:200]}", response.status_code)
            post_id = str((response.json().get("data") or {}).get("id") or "")
            if not post_id:
                raise XError("thread post response omitted id")
            confirmed_ids.append(post_id)
            persist_confirmed(confirmed_ids)
    return {"postIds": confirmed_ids, "rootId": confirmed_ids[0], "url": f"https://x.com/i/web/status/{confirmed_ids[0]}"}


def get_post(post_id: str, bearer_token: str | None = None) -> dict | None:
    with httpx.Client(timeout=20) as c:
        res = c.get(
            f"https://api.x.com/2/tweets/{post_id}",
            headers={"Authorization": f"Bearer {_bearer(bearer_token)}"},
        )
    if res.status_code == 404:
        return None
    if res.status_code != 200:
        raise XError(f"tweet fetch failed: {res.status_code}", res.status_code)
    return res.json()["data"]


def get_post_metrics(post_id: str, bearer_token: str | None = None) -> dict | None:
    """Fetches reaction metrics for a published post (learn stage)."""
    with httpx.Client(timeout=20) as c:
        res = c.get(
            f"https://api.x.com/2/tweets/{post_id}",
            headers={"Authorization": f"Bearer {_bearer(bearer_token)}"},
            params={"tweet.fields": "public_metrics"},
        )
    if res.status_code == 404:
        return None
    if res.status_code != 200:
        raise XError(f"metrics fetch failed: {res.status_code}", res.status_code)
    data = res.json()["data"]
    m = data.get("public_metrics", {})
    return {
        "likes": int(m.get("like_count", 0)),
        "replies": int(m.get("reply_count", 0)),
        "reposts": int(m.get("retweet_count", 0)),
        "quotes": int(m.get("quote_count", 0)),
        "impressions": int(m["impression_count"]) if "impression_count" in m else None,
    }
