"""Live startup-tech signals from Hacker News via the official Algolia API.

Keyless and rate-limit friendly; used by proactive checks and the insight
skills so trend angles are grounded in current external evidence instead of
model recall.
"""

from __future__ import annotations

import httpx


HN_ALGOLIA_BASE = "https://hn.algolia.com/api/v1"



def _hit_to_signal(hit: dict) -> dict | None:
    title = hit.get("title") or (hit.get("story_title") or "")
    if not title:
        return None
    return {
        "title": title,
        "url": hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
        "points": int(hit.get("points") or 0),
        "comments": int(hit.get("num_comments") or 0),
    }


def fetch_signals(limit: int = 6) -> list[dict]:
    """Front-page Hacker News stories."""
    with httpx.Client(timeout=20) as c:
        res = c.get(f"{HN_ALGOLIA_BASE}/search", params={"tags": "front_page", "hitsPerPage": limit})
        res.raise_for_status()
        hits = res.json().get("hits", [])
    return [s for s in (_hit_to_signal(h) for h in hits) if s]


def search_signals(query: str, limit: int = 5) -> list[dict]:
    """Keyword search over recent Hacker News stories (relevance-ranked)."""
    query = query.strip()
    if not query:
        return []
    with httpx.Client(timeout=20) as c:
        res = c.get(
            f"{HN_ALGOLIA_BASE}/search",
            params={"query": query, "tags": "story", "hitsPerPage": limit},
        )
        res.raise_for_status()
        hits = res.json().get("hits", [])
    return [s for s in (_hit_to_signal(h) for h in hits) if s]
