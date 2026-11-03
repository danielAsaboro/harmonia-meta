"""Skill definitions and their real backing tools (offline dev mode only)."""

from __future__ import annotations

from harmonia_agent import skills_runtime


def test_all_skills_are_valid_and_discoverable():
    skillset = skills_runtime.build_insight_skillset()
    names = {skill.frontmatter.name for skill in skillset.skills}
    assert names == set(skills_runtime._SKILL_NAMES)
    for skill in skillset.skills:
        assert len(skill.frontmatter.name) <= 64
        assert "-" not in (skill.frontmatter.name[0], skill.frontmatter.name[-1])
        assert 0 < len(skill.frontmatter.description) <= 1024
        assert skill.instructions.strip()


def test_skill_tools_are_read_only():
    skillset = skills_runtime.build_insight_skillset()
    tool_names = {
        tool.name
        for skill in skillset.skills
        for tool in getattr(skillset, "_SkillToolset__tools", []) or []
    } | {
        tool.__name__
        for tool in skills_runtime._TOOLS
    }
    assert {"fetch_trend_signals", "search_trend_signals", "get_engagement_insights",
            "get_operator_feed", "get_job_status", "suggest_posting_windows"} <= tool_names
    contracts = skills_runtime.validate_tool_contracts()
    assert set(contracts) == {tool.__name__ for tool in skills_runtime._TOOLS}
    assert all(contract.permission == "read" for contract in contracts.values())
    assert all(contract.external_effect is False for contract in contracts.values())


def test_fetch_trend_signals_returns_live_provenance(monkeypatch):
    monkeypatch.setattr(skills_runtime.signals, "fetch_signals", lambda limit: [{"title": "Signal", "url": "https://news.ycombinator.com/item?id=1", "points": 1, "comments": 0}])
    result = skills_runtime.fetch_trend_signals(limit=3)
    assert result["status"] == "success"
    assert result["data"]["count"] == 1
    assert result["evidence"][0]["provenance"] == "live"
    assert all(s["title"] and s["url"].startswith("http") for s in result["data"]["signals"])
    assert {item["reference"] for item in result["evidence"][1:]} == {
        signal["url"] for signal in result["data"]["signals"]
    }


def test_search_trend_signals_ignores_blank_queries():
    result = skills_runtime.search_trend_signals("   ")
    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_query"


def test_job_status_summary_never_leaks_internal_fields(monkeypatch):
    monkeypatch.setattr(skills_runtime.web_client, "get_job", lambda job_id: {"id": job_id, "sourceAnalysis": {"summary": "Launch source bundle"}, "config": {"sourceManifestId": "manifest"}, "stage": "awaiting_approval", "status": "active", "contentArtifacts": [{"id": "a1"}], "actions": [{"id": "act1", "type": "publish_x_post", "state": "planned", "approvalState": "pending", "risk": "high", "requiresApproval": True}], "verifications": [], "receipts": []})
    result = skills_runtime.get_job_status("job-123")
    summary = result["data"]["job"]
    assert summary["stage"] == "awaiting_approval"
    assert "accessToken" not in str(summary)
    assert summary["actions"][0]["requiresApproval"] is True
    assert summary["actions"][0]["approvalState"] == "pending"
    assert summary["actions"][0]["state"] == "planned"
    assert summary["title"] == "Launch source bundle"
    assert summary["sourceKind"] == "source_manifest"


def test_job_status_reports_missing_jobs_honestly():
    result = skills_runtime.get_job_status(" ")
    assert result["status"] == "error"
    assert result["data"] is None
    assert result["error"]["code"] == "invalid_job_id"


def test_posting_windows_derive_only_from_measured_history(monkeypatch):
    monkeypatch.setattr(skills_runtime.web_client, "get_insights", lambda: {"topPosts": [{"postId": "1", "likes": 100, "publishedAt": "2026-08-20T14:05:00Z"}, {"postId": "2", "likes": 90, "publishedAt": "2026-08-18T14:30:00Z"}, {"postId": "3", "likes": 20, "publishedAt": "2026-08-15T09:40:00Z"}]})
    monkeypatch.setattr(skills_runtime.web_client, "get_feed", lambda: {"recentPublished": []})
    result = skills_runtime.suggest_posting_windows()
    assert result["status"] == "success"
    assert result["data"]["insufficientData"] is False
    assert result["data"]["measuredPosts"] == 3
    hours = [w["hourUtc"] for w in result["data"]["windows"]]
    assert hours[0] == 14  # two measured posts at 14:UTC outperform one at 9:UTC
    assert all(w["sampleSize"] >= 1 for w in result["data"]["windows"])
    assert result["data"]["confidence"] == "low"
    assert result["data"]["limitations"]
    assert {item["reference"] for item in result["evidence"][1:]} == {
        item["postId"] for item in result["data"]["basis"]
    }


def test_posting_windows_fail_closed_without_measured_posts(monkeypatch):
    monkeypatch.setattr(skills_runtime.web_client, "get_insights", lambda: {"topPosts": [{"postId": "1", "text": "x"}]})
    monkeypatch.setattr(skills_runtime.web_client, "get_feed", lambda: {"recentPublished": []})
    result = skills_runtime.suggest_posting_windows()
    assert result["status"] == "error"
    assert result["error"]["code"] == "insufficient_measured_history"
    assert result["error"]["retryable"] is False


def test_insight_reads_stay_within_workspace_tools(monkeypatch):
    monkeypatch.setattr(skills_runtime.web_client, "get_feed", lambda: {"recentPublished": []})
    monkeypatch.setattr(skills_runtime.web_client, "get_insights", lambda: {"topPosts": [{"postId": "1", "likes": 2}, {"postId": "2", "likes": 1}]})
    feed = skills_runtime.get_operator_feed()
    insights = skills_runtime.get_engagement_insights()
    assert "recentPublished" in feed["data"]
    assert insights["data"]["topPosts"][0]["likes"] > insights["data"]["topPosts"][1]["likes"]
    assert {item["reference"] for item in insights["evidence"][1:]} == {
        post["postId"] for post in insights["data"]["topPosts"]
    }


def test_tool_provider_failures_are_typed_and_do_not_leak(monkeypatch):
    monkeypatch.setattr(skills_runtime.web_client, "get_insights", lambda: (_ for _ in ()).throw(skills_runtime.web_client.WebApiError("token=super-secret", 401)))
    result = skills_runtime.get_engagement_insights()
    assert result["status"] == "error"
    assert result["error"]["code"] == "authorization_failed"
    assert "super-secret" not in str(result)
