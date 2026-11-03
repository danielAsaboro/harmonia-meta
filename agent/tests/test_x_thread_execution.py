import httpx

from harmonia_agent.x_client import publish_thread


def test_thread_publishes_ordered_replies_and_persists_each_confirmed_id():
    requests = []
    progress = []
    ids = iter(["101", "102", "103"])
    def handler(request):
        requests.append(request)
        return httpx.Response(201, json={"data": {"id": next(ids)}})
    result = publish_thread(
        [{"id": "p1", "text": "One"}, {"id": "p2", "text": "Two"}, {"id": "p3", "text": "Three"}],
        "token", confirmed=[], persist_confirmed=lambda value: progress.append(list(value)),
        transport=httpx.MockTransport(handler),
    )
    assert result["postIds"] == ["101", "102", "103"]
    assert requests[0].read().decode() == '{"text":"One"}'
    assert requests[1].read().decode() == '{"text":"Two","reply":{"in_reply_to_tweet_id":"101"}}'
    assert requests[2].read().decode() == '{"text":"Three","reply":{"in_reply_to_tweet_id":"102"}}'
    assert progress == [["101"], ["101", "102"], ["101", "102", "103"]]


def test_thread_resume_skips_confirmed_prefix_and_replies_to_last_id():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(201, json={"data": {"id": "103"}})
    result = publish_thread(
        [{"id": "p1", "text": "One"}, {"id": "p2", "text": "Two"}, {"id": "p3", "text": "Three"}],
        "token", confirmed=["101", "102"], persist_confirmed=lambda _value: None,
        transport=httpx.MockTransport(handler),
    )
    assert len(requests) == 1
    assert '"in_reply_to_tweet_id":"102"' in requests[0].read().decode()
    assert result["postIds"] == ["101", "102", "103"]
