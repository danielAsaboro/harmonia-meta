import asyncio

from harmonia_agent.agenda_dispatcher import dispatch_agenda


def test_agenda_items_dispatch_independently_and_duplicate_claims_are_suppressed():
    calls = []
    items = [
        {"id": "a", "authority": "execute"}, {"id": "b", "authority": "propose"},
        {"id": "c", "authority": "request_attention"}, {"id": "dup", "authority": "execute"},
    ]
    def execute(item):
        calls.append(("execute", item["id"]))
        if item["id"] == "a":
            raise RuntimeError("maintenance failed")
        return {"ok": True}
    result = asyncio.run(dispatch_agenda(
        items, claim=lambda item_id: item_id != "dup", execute=execute,
        auto_tune=lambda item: calls.append(("tune", item["id"])), propose=lambda item: calls.append(("propose", item["id"])),
        request_attention=lambda item: calls.append(("attention", item["id"])), finalize=lambda item_id, outcome: calls.append(("finalize", item_id, outcome["status"])),
    ))
    assert [entry["status"] for entry in result] == ["failed", "completed", "completed", "already_claimed"]
    assert ("propose", "b") in calls and ("attention", "c") in calls
    assert not any(call[:2] == ("execute", "dup") for call in calls)
