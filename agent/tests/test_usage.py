from types import SimpleNamespace

from harmonia_agent.usage import (
    InvocationContext,
    UsageAccumulator,
    endpoint_usage_record,
    estimate_request_tokens,
    media_usage_record,
)


def test_estimate_request_tokens_is_deterministic():
    assert estimate_request_tokens('{"brief":"12345678"}', 200) == (5, 200)


def test_accumulator_sums_adk_usage_metadata():
    accumulator = UsageAccumulator(
        job_id="j1",
        operation_id="j1:draft:nimi:0",
        stage="draft",
        role="nimi",
        model="muse-spark-1.3",
        model_policy={"policyVersion": "gear-test", "temperature": 0.2},
    )
    accumulator.observe_event(SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=120,
        candidates_token_count=30,
    )))
    accumulator.observe_event(SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
    )))
    record = accumulator.finalize(trace_id="0" * 32)
    assert record.input_units == 130
    assert record.output_units == 35
    assert record.estimated_cost_usd == "0.000311"
    assert record.operation_id == "j1:draft:nimi:0"
    assert record.model_policy["policyVersion"] == "gear-test"


def test_usage_record_id_is_stable_across_retries():
    first = UsageAccumulator(
        job_id="j1", operation_id="j1:draft:nimi:0", stage="draft",
        role="nimi", model="muse-spark-1.3",
    ).finalize(trace_id="0" * 32)
    second = UsageAccumulator(
        job_id="j1", operation_id="j1:draft:nimi:0", stage="draft",
        role="nimi", model="muse-spark-1.3",
    ).finalize(trace_id="f" * 32)
    assert first.id == second.id


def test_accumulator_bills_prefix_cached_input_at_the_cached_rate():
    accumulator = UsageAccumulator(
        job_id="j1", operation_id="j1:draft:noni:0", stage="draft", role="noni", model="muse-spark-1.3",
    )
    accumulator.observe_event(SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=10_000, candidates_token_count=1_000, cached_content_token_count=8_000,
    )))
    record = accumulator.finalize(trace_id="0" * 32)
    # 2,000 x $1.25 + 8,000 x $0.15 + 1,000 x $4.25 per million
    assert record.estimated_cost_usd == "0.007950"
    assert record.to_wire()["cachedInputUnits"] == 8_000


def test_endpoint_usage_records_elapsed_seconds_without_fake_token_pricing():
    record = endpoint_usage_record(
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="j1", stage="draft", operation_id="j1:draft:0",
        ),
        role="noni_copywriter",
        model="custom-endpoint-model",
        elapsed_seconds=1.2,
        estimated_cost_usd="0.100000",
        trace_id="0" * 32,
    )

    assert record.unit_type == "endpoint_seconds"
    assert record.input_units == 2
    assert record.output_units == 0
    assert record.observed_cost_usd is None


def test_media_usage_records_one_priced_generation_without_fake_tokens():
    record = media_usage_record(
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="j1", stage="publish", operation_id="j1:publish:image1",
        ),
        role="image_generator",
        model="muse-image-1.0",
        estimated_cost_usd="0.080000",
        trace_id="0" * 32,
    )
    assert record.unit_type == "media_generations"
    assert record.input_units == 1
    assert record.output_units == 0
