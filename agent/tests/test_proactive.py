"""Proactive agent unit tests: proposals and outlier detection."""

from harmonia_agent import proactive


def test_proposal_ids_deterministic_and_unique():
    ideas = [{"topic": "same topic"}, {"topic": "same topic"}]
    props = proactive.build_proposals(ideas, "trend_scan")
    assert len(props) == 1  # deduped within a batch
    assert props[0]["id"] == proactive._proposal_id("trend_scan", "same topic")
    assert props[0]["id"].startswith("prop-")
    again = proactive.build_proposals([{"topic": "same topic"}], "trend_scan")
    assert again[0]["id"] == props[0]["id"]


def test_build_proposals_caps_and_cleans():
    ideas = [
        {"topic": f"topic {i}", "sources": [f"https://s.example/{i}"] * 8}
        for i in range(6)
    ]
    props = proactive.build_proposals(ideas, "trend_scan")
    assert len(props) == proactive.MAX_PROPOSALS_PER_TICK
    for p in props:
        assert len(p["sources"]) <= 5
        assert set(p) == {"id", "source", "topic", "angle", "reason", "sources", "suggestedPost"}


def test_watch_engagement_flags_outliers(monkeypatch):
    posts = [
        {"likes": 300, "text": "breakout post"},
        {"likes": 40, "text": "normal post"},
        {"likes": 20, "text": "quiet post"},
        {"likes": 30, "text": "another quiet one"},
    ]
    monkeypatch.setattr(proactive, "get_insights", lambda: {"topPosts": posts})
    ideas = proactive.watch_engagement()
    assert len(ideas) == 1
    assert "breakout post" in ideas[0]["topic"]
    assert "median of 40" in ideas[0]["reason"]
    assert "7.5x baseline" in ideas[0]["reason"]


def test_watch_engagement_quiet_when_few_posts(monkeypatch):
    monkeypatch.setattr(proactive, "get_insights", lambda: {"topPosts": [{"likes": 5, "text": "only"}]})
    assert proactive.watch_engagement() == []


def test_watch_engagement_handles_feed_failure(monkeypatch):
    from harmonia_agent.web_client import WebApiError

    def _boom():
        raise WebApiError("feed down", 500)

    monkeypatch.setattr(proactive, "get_insights", _boom)
    assert proactive.watch_engagement() == []


# ---------- engine v2: registry, cadence, new checks ----------


def _iso(ts: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _patch_web(monkeypatch, feed=None, insights=None, states=None):
    """Stubs the web client surface used by run_due_checks."""
    store = dict(states or {})
    puts = []
    notifications = []
    submissions = []

    monkeypatch.setattr(proactive, "get_feed", lambda: feed if feed is not None else {})
    monkeypatch.setattr(proactive, "get_insights", lambda: insights or {})
    monkeypatch.setattr(proactive, "get_connection", lambda _platform: {"accessToken": "test"})
    monkeypatch.setattr(proactive, "get_state", lambda key: store.get(key))
    monkeypatch.setattr(proactive, "put_state", lambda key, patch: puts.append((key, patch)))
    monkeypatch.setattr(
        proactive, "notify",
        lambda kind, title, body, severity="info", href=None: notifications.append((kind, title, body)),
    )
    monkeypatch.setattr(
        proactive, "submit_proposals",
        lambda props: (submissions.extend(props), (len(props), 0))[1],
    )
    return store, puts, notifications, submissions


def test_registry_has_expected_checks():
    names = {c["name"] for c in proactive.CHECKS}
    assert {
        "trend_scan", "engagement_watch", "publish_pulse", "morning_briefing",
        "stale_drafts_nudge", "failure_watchdog", "calendar_gap_scan", "recycle_winners",
    } <= names


def test_cadence_gating_skips_recent_and_runs_due(monkeypatch):
    now = 1_800_000_000.0
    store = {"proactive:trend_scan": {"lastRunAt": _iso(now - 60)}}  # ran a minute ago
    feed, puts, _, subs = _patch_web(monkeypatch, feed={"items": [], "failedJobs": []}, states=store)
    # trend_scan interval is 3600s -> skipped; failure_watchdog due but no failures
    results = proactive.run_due_checks(now_ts=now)
    ran = {r["check"] for r in results}
    assert "trend_scan" not in ran
    assert len(puts) == len(ran)  # every run marks its state


def test_async_tick_runs_sync_checks_outside_the_event_loop(monkeypatch):
    import asyncio

    def sync_scan():
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return [{"check": "trend_scan", "summary": "ok"}]
        raise AssertionError("run_due_checks executed inside the async event loop")

    monkeypatch.setattr(proactive, "run_due_checks", sync_scan)
    assert asyncio.run(proactive.tick()) == [{"check": "trend_scan", "summary": "ok"}]


def test_morning_briefing_composes_digest(monkeypatch):
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).isoformat()[:10]
    feed = {
        "items": [{"id": "i1", "status": "scheduled", "scheduledFor": f"{today}T10:30:00Z"}],
        "pendingApprovalCount": 2,
        "proposalsPending": 1,
        "failedJobs": [],
    }
    insights = {"topPosts": [{"likes": 214, "text": "winner post"}]}
    _, __, notifications, ___ = _patch_web(monkeypatch, feed=feed, insights=insights)

    class FakeTG:
        @staticmethod
        def notify(text):
            assert "1 post(s) scheduled today" in text
            return True

    monkeypatch.setattr(proactive.telegram_bot, "notify", FakeTG.notify)
    summary = proactive.check_morning_briefing({"feed": feed, "insights": insights})
    assert "telegram=True" in summary
    kinds = [n[0] for n in notifications]
    assert "daily_briefing" in kinds


def test_stale_draft_nudge_fires_only_when_old(monkeypatch):
    import time as _time

    old = _time.time() - 8 * 86400
    fresh = _time.time()
    feed = {"items": [
        {"id": "old", "status": "draft", "updatedAt": _iso(old)},
        {"id": "new", "status": "draft", "updatedAt": _iso(fresh)},
    ]}
    _, __, notifications, _subs = _patch_web(monkeypatch, feed=feed)
    summary = proactive.check_stale_drafts({"feed": feed})
    assert "1 stale" in summary
    assert notifications and notifications[0][0] == "stale_drafts"


def test_failure_watchdog_flags_permanent_failures(monkeypatch):
    feed = {"failedJobs": [{"id": "abc123456789", "permanent": True, "error": "x"}]}
    _, __, notifications, _s = _patch_web(monkeypatch, feed=feed)
    summary = proactive.check_failure_watchdog({"feed": feed})
    assert "1 failed job" in summary
    assert notifications[0] and "abc12345" in notifications[0][2]


def test_calendar_gap_scan_proposes_from_goals(monkeypatch):
    feed = {
        "items": [],
        "goals": {"weeklyPostTarget": 3, "voice": "direct"},
    }
    _, __, ___, subs = _patch_web(monkeypatch, feed=feed, insights={"topPosts": []})
    summary = proactive.check_calendar_gap_scan({"feed": feed})
    assert "gap=3" in summary
    assert any(p["source"] == "calendar_gap" for p in subs)


def test_calendar_gap_scan_quiet_when_full(monkeypatch):
    from datetime import datetime, timedelta, timezone

    soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    feed = {
        "items": [
            {"id": "a", "status": "scheduled", "scheduledFor": soon},
            {"id": "b", "status": "scheduled", "scheduledFor": soon},
            {"id": "c", "status": "scheduled", "scheduledFor": soon},
        ],
        "goals": {"weeklyPostTarget": 3},
    }
    summary = proactive.check_calendar_gap_scan({"feed": feed})
    assert summary == "calendar full"


def test_recycle_winners_needs_old_high_performer(monkeypatch):
    import time as _time

    old_ts = _time.time() - 30 * 86400
    insights = {"topPosts": [{"text": "evergreen banger", "likes": 220, "checkedAt": _iso(old_ts)}]}
    _, __, ___, subs = _patch_web(monkeypatch, insights=insights)
    summary = proactive.check_recycle_winners({"insights": insights})
    assert "1 recycle proposal" in summary
    assert subs[0]["source"] == "recycle"

    # fresh top post -> no recycle
    fresh = {"topPosts": [{"text": "new hot post", "likes": 50, "checkedAt": _iso(_time.time())}]}
    summary2 = proactive.check_recycle_winners({"insights": fresh})
    assert summary2 == "top post still fresh"


def test_publish_pulse_baseline_then_spike(monkeypatch):
    metrics_seq = {"p1": {"likes": 100, "replies": 1, "reposts": 1, "quotes": 1, "impressions": 10}}
    monkeypatch.setattr(proactive.x_client, "get_post_metrics", lambda pid, _token=None: metrics_seq.get(pid))
    feed = {"recentPublished": [{"postId": "p1", "jobId": "j1", "publishedAt": _iso(0), "likesSoFar": None}]}

    # first pass records baseline only
    store, puts, _, subs = _patch_web(monkeypatch, feed=feed)
    assert "0 spike" in proactive.check_publish_pulse({"feed": feed})
    assert not subs
    baseline_pass_store = dict(store)
    baseline_pass_store.update({"pulse:p1": {"data": {"likes": 100}}})

    # second pass with doubled likes fires a spike proposal
    metrics_seq["p1"] = {"likes": 250, "replies": 1, "reposts": 1, "quotes": 1, "impressions": 99}
    _, __, ___, subs2 = _patch_web(
        monkeypatch, feed=feed,
        states={"pulse:p1": {"data": {"likes": 100}}},
    )
    summary = proactive.check_publish_pulse({"feed": feed})
    assert "1 spike proposal" in summary
    assert subs2 and "heating up" in subs2[0]["topic"]
