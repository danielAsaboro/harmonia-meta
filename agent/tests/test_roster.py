"""The roster is derived from the built team and changes when an agent does."""

from __future__ import annotations

from fastapi.testclient import TestClient

from harmonia_agent import main, roster


def test_roster_lists_every_specialist_with_its_model_and_no_prompt_text(monkeypatch):
    for name in ("STRATEGIST_MODEL_ID", "STRATEGIST_PROVIDER", "GLIMMER_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    roster.agent_roster.cache_clear()
    response = TestClient(main.app).get("/roster")
    assert response.status_code == 200
    body = response.json()
    agents = {item["name"]: item for item in body["agents"]}
    assert {"ryan_strategist", "nimi_analyst", "noni_copywriter", "dara_editor", "temi_editorial_planner"} <= agents.keys()
    assert agents["ryan_strategist"]["model"] == "muse-wonder-1.0"
    assert agents["ryan_research_strategist"]["tools"] == ["ryan_web_search"]
    assert agents["ryan_research_strategist"]["reasoningEffort"] == "high"
    assert agents["dara_editor"]["skills"] == ["dara-editing-skills"]
    assert all(len(item["definitionDigest"]) == 64 for item in agents.values())
    assert "instruction" not in agents["nimi_analyst"]
    assert {item["name"] for item in body["media"]} >= {"transcriber", "subject_tracker", "source_screen"}
    assert next(item for item in body["media"] if item["name"] == "source_screen")["model"] == "rules only"


def test_a_model_change_changes_that_agents_digest_only(monkeypatch):
    for name in ("STRATEGIST_MODEL_ID", "STRATEGIST_PROVIDER", "EDITOR_MODEL_ID"):
        monkeypatch.delenv(name, raising=False)
    roster.agent_roster.cache_clear()
    before = {item["name"]: item["definitionDigest"] for item in roster.agent_roster()["agents"]}
    monkeypatch.setenv("STRATEGIST_MODEL_ID", "muse-spark-1.3")
    roster.agent_roster.cache_clear()
    after = {item["name"]: item["definitionDigest"] for item in roster.agent_roster()["agents"]}
    roster.agent_roster.cache_clear()
    assert before["ryan_strategist"] != after["ryan_strategist"]
    assert before["dara_editor"] == after["dara_editor"]
