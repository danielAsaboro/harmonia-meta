"""The running agent team, described by what each specialist actually is.

Each entry is derived at request time from the built ADK team, not from a
hand-kept list, so the roster cannot drift from the agents. ``definitionDigest``
hashes everything that determines a specialist's behaviour: its instruction,
output contract, tools, skill files, model and generation limits. The same
digest means the same agent; any edit to a prompt or skill changes it.

No prompt text is returned, only its size and digest.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .agents import _resolve_role_models, build_agent_team
from .content import image_model, model_used as transcriber_model
from .segmentation import segmentation_model
from .source_guard import SCREEN_VERSION, glimmer_config
from .video_understanding import video_model

SKILLS_ROOT = Path(__file__).parent / "skills"
AUTHORITY = (
    "Returns one typed proposal per call. Cannot publish, approve, schedule, spend, "
    "or change workflow state; deterministic code validates every output first."
)


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _skill_digest(name: str) -> str:
    root = SKILLS_ROOT / name
    files = sorted(path for path in root.rglob("*") if path.is_file()) if root.is_dir() else []
    return _digest([[str(path.relative_to(root)), hashlib.sha256(path.read_bytes()).hexdigest()] for path in files])


def _tools(agent: Any) -> tuple[list[str], dict[str, str]]:
    tools: list[str] = []
    skills: dict[str, str] = {}
    for tool in agent.tools or []:
        names = list(getattr(tool, "_skills", {}) or {})
        if names:
            skills.update({name: _skill_digest(name) for name in names})
            tools.append("load_skill")
        else:
            tools.append(str(getattr(tool, "name", type(tool).__name__)))
    return tools, skills


@lru_cache(maxsize=1)
def agent_roster() -> dict[str, Any]:
    models = _resolve_role_models()
    team = build_agent_team(models=models)
    agents = []
    for agent in team.sub_agents:
        model = getattr(agent.model, "model", agent.model)
        model_id = str(model).removeprefix("openai/")
        provider = str(getattr(agent.model, "provider", "meta"))
        config = None
        # Research variants run on their base role's model and limits.
        for role in (agent.name, agent.name.replace("_research_", "_")):
            try:
                config = models.config_for(role)
                break
            except (KeyError, ValueError):
                continue
        tools, skills = _tools(agent)
        instruction = agent.instruction if isinstance(agent.instruction, str) else ""
        definition = {
            "name": agent.name,
            "instruction": instruction,
            "outputSchema": agent.output_schema,
            "tools": tools,
            "skills": skills,
            "model": model_id,
            "provider": provider,
            "generation": config.generation.model_dump(mode="json") if config else None,
            "maxOutputTokens": config.max_output_tokens if config else None,
        }
        agents.append({
            "name": agent.name,
            "description": agent.description or "",
            "model": model_id,
            "provider": provider,
            "reasoningEffort": config.generation.reasoning_effort if config else None,
            "maxOutputTokens": config.max_output_tokens if config else None,
            "tools": tools,
            "skills": sorted(skills),
            "typedOutput": agent.output_schema is not None,
            "instructionChars": len(instruction),
            "definitionDigest": _digest(definition),
        })
    glimmer = glimmer_config()
    media = [
        {"name": "transcriber", "model": transcriber_model(), "job": "timed speech segments from audio and video"},
        {"name": "video_observer", "model": video_model(), "job": "timed visual observations anchored to frame stills"},
        {"name": "image_reader", "model": video_model(), "job": "visible text and observations from uploaded images"},
        {"name": "subject_tracker", "model": segmentation_model(), "job": "speaker-following crop for vertical and square clips"},
        {"name": "image_generator", "model": image_model(), "job": "approved campaign images"},
        {"name": "source_screen", "model": glimmer[1] if glimmer else "rules only",
         "job": f"quarantine instructions hidden in untrusted sources ({SCREEN_VERSION})"},
    ]
    return {
        "coordinator": team.name,
        "authority": AUTHORITY,
        "agents": agents,
        "media": media,
        "rosterDigest": _digest([item["definitionDigest"] for item in agents] + [_digest(media)]),
    }
