"""Proactive agent: watches events and proposes content without being asked.

Background thread inside the FastAPI worker (alongside the scheduler). A
registry of independent checks runs on its own cadence; each check gathers
what it needs, then produces proposals (operator-approved before anything
happens) and/or bell notifications. Cadence markers persist via the web
service's agent-state API so restarts never double-fire daily checks.

Checks (see CHECKS):
- trend_scan        hourly      external signals -> topic proposals
- engagement_watch  6h          outliers among published posts -> follow-ups
- publish_pulse     hourly      fresh metrics for posts <48h old; spikes fire fast
- morning_briefing  daily       digest notification (+ Telegram push)
- stale_drafts_nudge daily     nudge idle drafts back into review
- failure_watchdog  daily       resurface permanently failed jobs until resolved
- calendar_gap_scan weekly      upcoming calendar gaps -> fill ideas from goals+learnings
- recycle_winners   weekly      aging top posts -> refresh-angle proposals

Every leg fails independently and visibly. Nothing here publishes: proposals
require operator approval, notifications are read-only.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from . import signals, telegram_bot, x_client
from .web_client import (
    WebApiError,
    get_feed,
    get_connection,
    get_insights,
    get_state,
    get_workspaces,
    post as web_post,
    put_state,
)
from .tenant_context import tenant_scope

logger = logging.getLogger("harmonia.proactive")

SCAN_SECONDS = int(os.environ.get("PROACTIVE_SCAN_SECONDS", "60"))
MAX_PROPOSALS_PER_TICK = 3
OUTLIER_FACTOR = 2.0
RECYCLE_MIN_AGE_DAYS = 21
STALE_DRAFT_DAYS = 7


def _interval(name: str, default_seconds: int) -> int:
    return int(os.environ.get(f"PROACTIVE_{name.upper()}_INTERVAL_SECONDS", str(default_seconds)))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- shared helpers ----------

def _proposal_id(source: str, topic: str) -> str:
    return f"prop-{hashlib.sha256(f'{source}:{topic}'.encode()).hexdigest()[:16]}"


def build_proposals(ideas: list[dict[str, Any]], source: str) -> list[dict[str, Any]]:
    """Normalizes idea dicts into proposal payloads with deterministic ids."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idea in ideas[:MAX_PROPOSALS_PER_TICK]:
        topic = str(idea.get("topic", "")).strip()
        if not topic:
            continue
        pid = _proposal_id(source, topic)
        if pid in seen:
            continue
        seen.add(pid)
        out.append({
            "id": pid,
            "source": source,
            "topic": topic[:300],
            "angle": str(idea.get("angle", "")).strip()[:300],
            "reason": str(idea.get("reason", "")).strip()[:600],
            "sources": [str(u) for u in (idea.get("sources") or [])][:5],
            "suggestedPost": str(idea.get("suggestedPost", "")).strip()[:280],
        })
    return out


def submit_proposals(proposals: list[dict[str, Any]]) -> tuple[int, int]:
    """Submits proposals to the web inbox; returns (created, skipped)."""
    if not proposals:
        return 0, 0
    data = web_post("/api/internal/proposals", {"proposals": proposals})
    return int(data.get("created", 0)), int(data.get("skipped", 0))


def notify(kind: str, title: str, body: str, severity: str = "info", href: str | None = None) -> None:
    payload: dict[str, Any] = {"kind": kind, "title": title, "body": body[:500], "severity": severity}
    if href:
        payload["href"] = href
    web_post("/api/internal/notify", payload)


# ---------- signal gathering (official APIs only) ----------

def fetch_signals(limit: int = 6) -> list[dict[str, Any]]:
    """Front-page Hacker News stories via the official Algolia API (keyless)."""
    return signals.fetch_signals(limit=limit)


# ---------- checks ----------

def watch_engagement() -> list[dict[str, Any]]:
    """Flags engagement outliers (>= OUTLIER_FACTOR x median likes) as ideas."""
    try:
        insights = get_insights()
    except WebApiError:
        logger.warning("engagement watch: insights feed unavailable")
        return []
    posts = [p for p in insights.get("topPosts", []) if p.get("likes") is not None]
    if len(posts) < 3:
        return []
    likes = sorted(int(p["likes"]) for p in posts)
    median = likes[len(likes) // 2]
    if median <= 0:
        return []
    out = []
    for p in posts:
        text = str(p.get("text", ""))
        if int(p["likes"]) >= max(median * OUTLIER_FACTOR, median + 10):
            out.append({
                "topic": f"Follow-up to our breakout post: {text[:120]}",
                "angle": "Double down on the pattern that clearly resonated",
                "reason": (
                    f"Post earned {p['likes']} likes vs a median of {median} across recent "
                    f"posts ({round(int(p['likes']) / median, 1)}x baseline); audiences want more of this."
                ),
                "sources": [],
                "suggestedPost": "",
            })
    return out


def check_trend_scan(ctx: dict[str, Any]) -> str:
    observed = fetch_signals()
    if not observed:
        return "no signals"
    ideas = [{
        "topic": item.get("title", ""), "angle": "Observed external signal",
        "reason": f"Observed {int(item.get('points') or 0)} points and {int(item.get('comments') or 0)} comments.",
        "sources": [item["url"]] if item.get("url") else [], "suggestedPost": "",
    } for item in observed]
    created, _ = submit_proposals(build_proposals(ideas, "trend_scan"))
    return f"{created} proposal(s)"


def check_engagement_watch(ctx: dict[str, Any]) -> str:
    created, _ = submit_proposals(build_proposals(watch_engagement(), "engagement_watch"))
    return f"{created} proposal(s)"


def check_publish_pulse(ctx: dict[str, Any]) -> str:
    """Fresh metrics for posts published <48h ago; spikes become fast proposals."""
    fired = 0
    for entry in (ctx.get("feed") or {}).get("recentPublished", []):
        post_id = str(entry.get("postId", ""))
        if not post_id:
            continue
        state_key = f"pulse:{post_id}"
        prev = get_state(state_key) or {}
        baseline = prev.get("data", {}).get("likes")
        try:
            connection = get_connection("x")
            metrics = x_client.get_post_metrics(post_id, connection.get("accessToken"))
        except Exception as exc:  # noqa: BLE001 - one post failing must not kill the pulse
            logger.warning("pulse metrics fetch failed for %s: %s", post_id, exc)
            continue
        if not metrics:
            continue
        likes = int(metrics["likes"])
        put_state(state_key, {"likes": likes})
        if baseline is not None and likes >= int(baseline) * 2 and likes >= int(baseline) + 5:
            created, _ = submit_proposals(build_proposals([{
                "topic": f"Spike alert: your post is heating up ({post_id})",
                "angle": "Ride the momentum with a follow-up while attention lasts",
                "reason": f"Likes jumped from {baseline} to {likes} within 48h of publishing.",
                "sources": [],
                "suggestedPost": "",
            }], "engagement_watch"))
            fired += created
    return f"{fired} spike proposal(s)"


def check_morning_briefing(ctx: dict[str, Any]) -> str:
    feed = ctx.get("feed") or {}
    today = _now()[:10]
    scheduled_today = [
        i for i in feed.get("items", [])
        if i.get("scheduledFor") and str(i["scheduledFor"])[:10] == today
        and i.get("status") in ("scheduled", "awaiting_final_review")
    ]
    lines = ["Good morning. Harmonia daily brief:"]
    lines.append(f"- {len(scheduled_today)} post(s) scheduled today")
    lines.append(f"- {feed.get('pendingApprovalCount', 0)} job(s) awaiting approval")
    lines.append(f"- {feed.get('proposalsPending', 0)} idea proposal(s) waiting in your inbox")
    failed = feed.get("failedJobs", [])
    if failed:
        lines.append(f"- {len(failed)} failed job(s) need attention")
    insights = ctx.get("insights") or {}
    top = (insights.get("topPosts") or [])[:1]
    if top:
        lines.append(f"- Top recent post: {int(top[0].get('likes', 0))} likes - \"{str(top[0].get('text', ''))[:70]}\"")
    body = "\n".join(lines)

    notify("daily_briefing", "Morning briefing", body, href="/dashboard")
    delivered = telegram_bot.notify(body)
    print(f"[MOCK-AI] morning briefing telegram push: {'delivered' if delivered else 'skipped (not configured)'}", flush=True)
    return f"briefing sent (telegram={delivered})"


def check_stale_drafts(ctx: dict[str, Any]) -> str:
    cutoff = time.time() - STALE_DRAFT_DAYS * 86400
    stale = [
        i for i in (ctx.get("feed") or {}).get("items", [])
        if i.get("status") == "draft"
        and _parse_iso(i.get("updatedAt")) < cutoff
    ]
    if stale:
        notify(
            "stale_drafts",
            "Drafts going stale",
            f"{len(stale)} draft content item(s) have sat unreviewed for over {STALE_DRAFT_DAYS} days. Review or schedule them.",
            severity="warning",
            href="/dashboard/calendar",
        )
    return f"{len(stale)} stale draft(s)"


def check_failure_watchdog(ctx: dict[str, Any]) -> str:
    failed = [j for j in (ctx.get("feed") or {}).get("failedJobs", []) if j.get("permanent")]
    if failed:
        names = ", ".join(str(j["id"])[:8] for j in failed[:3])
        notify(
            "failure_watchdog",
            "Failed jobs need resolution",
            f"{len(failed)} permanently failed job(s): {names}. Inspect, fix the cause, retry.",
            severity="critical",
            href="/dashboard/monitoring",
        )
    return f"{len(failed)} failed job(s)"


def check_calendar_gap_scan(ctx: dict[str, Any]) -> str:
    feed = ctx.get("feed") or {}
    week_ahead = time.time() + 7 * 86400
    scheduled_soon = sum(
        1 for i in feed.get("items", [])
        if i.get("status") == "scheduled"
        and i.get("scheduledFor")
        and time.time() <= _parse_iso(i["scheduledFor"]) <= week_ahead
    )
    target = int(((feed.get("goals") or {}).get("weeklyPostTarget")) or 3)
    gap = max(target - scheduled_soon, 0)
    if gap == 0:
        return "calendar full"
    goals = feed.get("goals") or {}
    topics = goals.get("topics") or ["Fill the documented weekly content gap"]
    ideas = [{
        "topic": str(topic), "angle": "Calendar capacity gap",
        "reason": f"The calendar is {gap} item(s) below the operator's weekly target.",
        "sources": [], "suggestedPost": "",
    } for topic in topics[:gap]]
    created, _ = submit_proposals(build_proposals(ideas, "calendar_gap"))
    return f"gap={gap}; {created} fill proposal(s)"


def check_recycle_winners(ctx: dict[str, Any]) -> str:
    insights = ctx.get("insights") or {}
    posts = insights.get("topPosts") or []
    if not posts:
        return "nothing worth recycling yet"
    best = max(posts, key=lambda p: int(p.get("likes", 0)))
    # Age signal: engagement records carry checkedAt; use the newest as proxy.
    checked_at = _parse_iso(best.get("checkedAt")) if isinstance(best.get("checkedAt"), str) else None
    age_days = (time.time() - checked_at) / 86400 if checked_at else RECYCLE_MIN_AGE_DAYS
    if age_days < RECYCLE_MIN_AGE_DAYS or int(best.get("likes", 0)) < 10:
        return "top post still fresh"
    ideas = [{
        "topic": f"Revisit verified winner: {str(best.get('text', ''))[:180]}",
        "angle": "Measured winner eligible for a new strategy cycle",
        "reason": f"The verified post is {round(age_days)} days old and earned {int(best.get('likes', 0))} likes.",
        "sources": [], "suggestedPost": "",
    }]
    created, _ = submit_proposals(build_proposals(ideas, "recycle"))
    return f"{created} recycle proposal(s)"


# ---------- plumbing ----------

def _prior_learnings_line(insights: dict[str, Any]) -> str:
    goals = insights.get("goals") or {}
    bits = []
    if goals.get("voice"):
        bits.append(f"brand voice: {goals['voice']}")
    for t in (goals.get("topics") or [])[:3]:
        bits.append(f"priority topic: {t}")
    return "; ".join(bits)


def _goals_text(goals: dict[str, Any]) -> str:
    bits = []
    for key in ("weeklyPostTarget", "audience", "voice"):
        if goals.get(key):
            bits.append(f"{key}: {goals[key]}")
    for t in (goals.get("topics") or [])[:5]:
        bits.append(f"priority topic: {t}")
    return "; ".join(bits)


def _learnings_text(insights: dict[str, Any]) -> str:
    posts = insights.get("topPosts") or []
    return " | ".join(
        f"{int(p.get('likes', 0))} likes: \"{str(p.get('text', ''))[:80]}\"" for p in posts[:3]
    )


def _parse_iso(value: Any) -> float:
    """Parses an ISO timestamp to epoch seconds; unparsable input -> 0."""
    if not isinstance(value, str) or not value:
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


CHECKS: list[dict[str, Any]] = [
    {"name": "trend_scan", "seconds": _interval("trend_scan", 3600), "run": check_trend_scan},
    {"name": "engagement_watch", "seconds": _interval("engagement_watch", 6 * 3600), "run": check_engagement_watch},
    {"name": "publish_pulse", "seconds": _interval("publish_pulse", 3600), "run": check_publish_pulse},
    {"name": "morning_briefing", "seconds": _interval("morning_briefing", 24 * 3600), "run": check_morning_briefing},
    {"name": "stale_drafts_nudge", "seconds": _interval("stale_drafts", 24 * 3600), "run": check_stale_drafts},
    {"name": "failure_watchdog", "seconds": _interval("failure_watchdog", 24 * 3600), "run": check_failure_watchdog},
    {"name": "calendar_gap_scan", "seconds": _interval("calendar_gap", 7 * 86400), "run": check_calendar_gap_scan},
    {"name": "recycle_winners", "seconds": _interval("recycle", 7 * 86400), "run": check_recycle_winners},
]


def run_due_checks(now_ts: float | None = None) -> list[dict[str, Any]]:
    """Runs every check whose persisted cadence marker has elapsed.

    Feed + insights are fetched once and shared. Each check fails
    independently; results are returned for logging/tests.
    """
    now_ts = now_ts if now_ts is not None else time.time()
    try:
        feed = get_feed()
    except WebApiError as exc:
        logger.warning("proactive feed unavailable (%s); skipping scan", exc)
        return []

    try:
        insights = get_insights()
    except WebApiError:
        insights = {}

    ctx = {"feed": feed, "insights": insights}
    results = []
    for check in CHECKS:
        name, seconds = check["name"], int(check["seconds"])
        key = f"proactive:{name}"
        last = get_state(key) or {}
        last_run = _parse_iso(last.get("lastRunAt"))
        if last_run and now_ts - last_run < seconds:
            continue
        summary = "error"
        try:
            summary = str(check["run"](ctx))
        except Exception as exc:  # noqa: BLE001 - one check failing never blocks others
            logger.warning("proactive check '%s' failed: %s", name, exc)
        finally:
            try:
                put_state(key, _now())
            except WebApiError as exc:
                logger.warning("could not persist cadence state for %s: %s", name, exc)
        results.append({"check": name, "summary": summary})
    return results


async def tick() -> list[dict[str, Any]]:
    return await asyncio.to_thread(run_due_checks)


def _run_loop() -> None:
    logger.info(
        "proactive agent started (%d checks; scanning every %ss)",
        len(CHECKS), SCAN_SECONDS,
    )
    for c in CHECKS:
        logger.info("  check %-20s every %ss", c["name"], c["seconds"])
    while True:
        try:
            for workspace in get_workspaces():
                with tenant_scope(workspace["workspaceId"], workspace["brandId"]):
                    results = run_due_checks()
                    for r in results:
                        logger.info(
                            "proactive workspace=%s [%s]: %s",
                            workspace["workspaceId"], r["check"], r["summary"],
                        )
        except Exception:  # noqa: BLE001 - keep the loop alive
            logger.exception("proactive scan failed")
        time.sleep(SCAN_SECONDS)


def start_background() -> None:
    threading.Thread(target=_run_loop, daemon=True).start()
