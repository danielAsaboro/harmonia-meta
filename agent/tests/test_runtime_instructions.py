from types import SimpleNamespace

from google.adk.models.llm_request import LlmRequest
from google.genai import types

from harmonia_agent.agents import build_agent_team


def test_serialized_team_projects_host_contract_and_repair_into_model_request():
    team = build_agent_team(model="muse-spark-1.3")
    for agent in team.sub_agents:
        callback = agent.before_model_callback
        assert callable(callback), agent.name
        request = LlmRequest(config=types.GenerateContentConfig(system_instruction="Static method"))
        state = {
            "_harmonia_output_contract": {"required": ["body"], "additionalProperties": False},
            "_harmonia_repair": {"code": "extra_forbidden", "path": "hook"},
            "_durable_context_projection": {"private": "must-not-leak"},
        }
        assert callback(SimpleNamespace(state=state), request) is None
        instruction = str(request.config.system_instruction)
        assert "Static method" in instruction
        assert '"body"' in instruction and '"hook"' in instruction
        assert "must-not-leak" not in instruction
        second = LlmRequest(config=types.GenerateContentConfig(system_instruction="Next request"))
        callback(SimpleNamespace(state={}), second)
        assert str(second.config.system_instruction) == "Next request"


def test_adk_runner_exposes_contract_without_local_runtime_instruction_mutation():
    import asyncio
    from google.adk.agents import Agent
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import InMemoryRunner
    from harmonia_agent.coordinator import HarmoniaCoordinator
    from harmonia_agent.runtime_instructions import project_runtime_instructions

    class InspectModel(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            instruction = str(llm_request.config.system_instruction)
            assert '"required": ["body"]' in instruction
            assert '"path": "hook"' in instruction
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="checked")]))

    async def run():
        child = Agent(name="producer", model=InspectModel(model="test"),
                      instruction="Static", before_model_callback=project_runtime_instructions)
        runner = InMemoryRunner(agent=HarmoniaCoordinator(name="root", sub_agents=[child]))
        session = await runner.session_service.create_session(app_name=runner.app_name, user_id="test", state={
            "requested_specialist": "producer",
            "_harmonia_output_contract": {"required": ["body"]},
            "_harmonia_repair": {"path": "hook"},
        })
        events = [event async for event in runner.run_async(user_id="test", session_id=session.id,
                  new_message=types.Content(role="user", parts=[types.Part(text="Produce")] ))]
        assert events and child.instruction == "Static"
    asyncio.run(run())
