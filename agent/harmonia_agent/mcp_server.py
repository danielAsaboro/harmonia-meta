"""Harmonia as an MCP server: any MCP client can ask for campaigns and follow them.

    HARMONIA_URL=https://your-harmonia HARMONIA_TOKEN=hmn_... python -m harmonia_agent.mcp_server

The token is minted under Settings (POST /api/settings/agent-tokens) and acts
for the operator who minted it, inside that workspace only. It reaches three
routes: chat, the campaign list, and one campaign. Approving a strategy or a
post, publishing, and spending stay with the human operator: the web app
refuses this principal on every one of those routes, so an agent can prepare
work but never release it.

Claude Code, for example:

    claude mcp add harmonia -e HARMONIA_URL=... -e HARMONIA_TOKEN=... -- \\
      /path/to/agent/.venv/bin/python -m harmonia_agent.mcp_server
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server import MCPServer

RIGHTS_ATTESTATION_PHRASE = "I confirm I have rights to use this source"

server = MCPServer(
    name="harmonia",
    title="Harmonia",
    instructions=(
        "Harmonia is a team of Meta-model agents that turns a startup's source material (a video, a page, "
        "notes) into a month of reviewed social content. Use ask_harmonia to request work in plain language, "
        "list_campaigns and get_campaign to follow it. Strategy and every post wait for the human operator's "
        "approval in Harmonia; you cannot approve or publish."
    ),
)


def _client() -> httpx.Client:
    base, token = os.environ.get("HARMONIA_URL"), os.environ.get("HARMONIA_TOKEN")
    if not base or not token:
        raise RuntimeError("set HARMONIA_URL and HARMONIA_TOKEN")
    return httpx.Client(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=120.0)


def _json(response: httpx.Response) -> dict[str, Any]:
    if response.status_code >= 400:
        try:
            detail = response.json().get("error")
        except ValueError:
            detail = response.text[:200]
        raise RuntimeError(f"Harmonia returned {response.status_code}: {detail}")
    return response.json()


def _card(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not job:
        return None
    return {key: job[key] for key in ("id", "stage", "status", "title") if job.get(key) is not None}


@server.tool(description=(
    "Ask Harmonia for content work in plain language, e.g. 'turn this talk into a LinkedIn post and two X "
    "posts'. Include a public source URL if there is one. Set i_have_rights only when the operator owns or "
    "may use that source; Harmonia records the attestation against the operator's token."
))
def ask_harmonia(message: str, source_url: str | None = None, i_have_rights: bool = False) -> dict[str, Any]:
    text = message.strip()
    if source_url:
        text = f"{text}\nSource: {source_url.strip()}"
    if i_have_rights:
        text = f"{text}\n{RIGHTS_ATTESTATION_PHRASE}."
    with _client() as client:
        body = _json(client.post("/api/chat", json={"message": text[:2000], "conversationId": "mcp"}))
    return {
        "reply": body.get("reply"),
        "intent": body.get("intent"),
        "campaign": _card(body.get("job")),
        "waitingForHumanApproval": len(body.get("pendingActions") or []),
    }


@server.tool(description="List this workspace's campaigns with their stage and status.")
def list_campaigns() -> list[dict[str, Any]]:
    with _client() as client:
        jobs = _json(client.get("/api/jobs")).get("jobs") or []
    return [{key: job.get(key) for key in ("id", "stage", "status", "controlState", "updatedAt")} for job in jobs]


@server.tool(description="Read one campaign: stage, status, the grounded moments Nimi found, drafts, and what waits for approval.")
def get_campaign(campaign_id: str) -> dict[str, Any]:
    with _client() as client:
        body = _json(client.get(f"/api/jobs/{campaign_id}"))
    job = body.get("job") or body
    analysis = job.get("sourceAnalysis") or {}
    actions = job.get("actions") or []
    return {
        "id": job.get("id"),
        "stage": job.get("stage"),
        "status": job.get("status"),
        "summary": analysis.get("summary"),
        "moments": [{"title": m.get("title"), "startSec": m.get("startSec"), "endSec": m.get("endSec")} for m in analysis.get("moments") or []][:12],
        "drafts": [{"kind": (a.get("payload") or {}).get("kind"), "id": a.get("id")} for a in job.get("contentArtifacts") or []][:20],
        "waitingForHumanApproval": [a.get("title") for a in actions if a.get("approvalState") == "pending"],
        "failure": (job.get("failure") or {}).get("publicMessage"),
    }


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
