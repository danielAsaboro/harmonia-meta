"""The labelled screen eval scores rules alone and never mislabels clean cases."""

from __future__ import annotations

from harmonia_agent import source_guard_eval


def test_rules_catch_every_direct_injection_and_withhold_no_clean_case(monkeypatch):
    monkeypatch.delenv("GLIMMER_BASE_URL", raising=False)
    report = source_guard_eval.run_eval()

    assert report["rules"]["wronglyWithheld"] == []
    assert all(case.startswith("inject-subtle") for case in report["rules"]["missed"])
    assert report["rules"]["caught"] == 7 and report["glimmer"] == {"state": "not configured"}
