"""
Stepcharts proposal agent: shared state between the agent and the app.
Uses the ProposalBuildSpec schema from full-stack/schema to build legal/financial
structure proposals. As the user describes their legal need, the agent updates
and emits proposal state so the frontend can display it in an embedded
stepcharts.io/play iframe.
"""

import json
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request

from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.types import Command
from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_customize_config, copilotkit_emit_state
from copilotkit.langgraph import copilotkit_exit
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

# Schema summary for the LLM (aligned with full-stack/schema ProposalBuildSpec)
PROPOSAL_SCHEMA_SUMMARY = """
ProposalBuildSpec: { id (string), title (string), steps (array), actors (optional), assets (optional), ... }
StepBuildSpec: { title (string), id (number, 0-based), instructions (array) }
Actors: array of { type: "Person"|"Company"|"Partnership"|"Trust", id (string), name (string), legalStatuses?: string[], taxClasses?: string[] }
Instructions (common):
- AddActor: { type: "AddActor", actorId: string }  (add existing actor to this step)
- AddLegalName: { type: "AddLegalName", actorId: string, legalName: string }
- AddLegalStatus: { type: "AddLegalStatus", actorId: string, legalStatusCode: string }
- FormCompany: { type: "FormCompany", actorId: string }
- SettleTrust: { type: "SettleTrust", actorId: string }
- AddOwnership: { type: "AddOwnership", ownerId: string, propertyId: string, amount: number, unit: string }
- AddCash: { type: "AddCash", amount: number, currency: string }
Actor ids should be unique (e.g. person_jane, company_abc_llc). Always include actors in the top-level "actors" array and reference them by id in instructions.
"""

UPDATE_PROPOSAL_TOOL = {
    "type": "function",
    "function": {
        "name": "update_proposal",
        "description": "Update the legal/financial structure proposal. Provide the full or partial proposal following the ProposalBuildSpec schema. Use this when the user describes a new structure or changes (e.g. add a person, form a trust, add ownership). Always send a complete valid proposal: include id, title, steps (each with id and title and instructions), and actors array. Merge with existing proposal if you are only making partial changes.",
        "parameters": {
            "type": "object",
            "properties": {
                "proposal": {
                    "type": "object",
                    "description": "Proposal object conforming to ProposalBuildSpec (id, title, steps[], actors[], etc.)",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "steps": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "number"},
                                    "title": {"type": "string"},
                                    "instructions": {"type": "array", "items": {"type": "object"}},
                                },
                            },
                        },
                        "actors": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "enum": ["Person", "Company", "Partnership", "Trust"]},
                                    "id": {"type": "string"},
                                    "name": {"type": "string"},
                                    "legalStatuses": {"type": "array", "items": {"type": "string"}},
                                    "taxClasses": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["type", "id", "name"],
                            },
                        },
                        "assets": {"type": "array", "items": {"type": "object"}},
                    },
                    "required": ["id", "title", "steps"],
                },
            },
            "required": ["proposal"],
        },
    },
}


READ_PROPOSAL_TOOL = {
    "type": "function",
    "function": {
        "name": "read_proposal",
        "description": (
            "Fetch and summarize an existing embedded proposal from the Firebase "
            "Realtime Database. Use this when the user is working with an existing "
            "stepcharts.io/play embedded chart and wants an explanation of that chart. "
            "The embedded_id is the numeric id from the URL "
            "(e.g. https://stepcharts.io/play?embeddedId=1771868477233 "
            "→ embedded_id='1771868477233')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "embedded_id": {
                    "type": "string",
                    "description": (
                        "The embedded proposal ID used in "
                        "https://structuretracks.firebaseio.com/embedded-proposals/{embedded_id}.json"
                    ),
                }
            },
            "required": ["embedded_id"],
        },
    },
}


SUMMARIZE_PROPOSAL_TOOL = {
    "type": "function",
    "function": {
        "name": "summarize_current_proposal",
        "description": (
            "Summarize the current proposal from AgentState.proposal. "
            "Use this when the user asks you to summarize, explain, or "
            "describe the current chart or proposal that is already loaded "
            "in the agent state (not from an external embedded_id)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": (
                        "Optional focus for the summary (e.g. 'overall structure', "
                        "'cash flows', 'who owns what'). If omitted, give a clear "
                        "high-level overview."
                    ),
                }
            },
        },
    },
}


class AgentState(CopilotKitState):
    """State includes the current proposal (ProposalBuildSpec) and messages."""

    proposal: Optional[Dict[str, Any]] = None


def _default_proposal() -> Dict[str, Any]:
    return {
        "id": f"proposal_{uuid.uuid4().hex[:12]}",
        "title": "New Proposal",
        "steps": [
            {"id": 0, "title": "Initial Step", "instructions": []},
        ],
        "actors": [],
    }


def _fetch_proposal_from_rtdb(embedded_id: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Fetch proposal JSON from Firebase RTDB for a given embedded proposal id."""
    embedded_id = str(embedded_id).strip()
    if not embedded_id:
        return "No embedded_id provided.", None

    base_url = "https://structuretracks.firebaseio.com/embedded-proposals"
    url = f"{base_url}/{embedded_id}.json"

    try:
        with urllib_request.urlopen(url, timeout=10) as resp:
            data = resp.read().decode("utf-8")
    except urllib_error.HTTPError as e:
        return f"Failed to fetch proposal from {url}: HTTP {e.code}", None
    except urllib_error.URLError as e:
        return f"Failed to fetch proposal from {url}: {e.reason}", None
    except Exception as e:  # pragma: no cover - defensive
        return f"Unexpected error fetching proposal from {url}: {e}", None

    try:
        proposal = json.loads(data)
    except Exception as e:  # pragma: no cover - defensive
        return f"Fetched data from {url} but failed to parse JSON: {e}", None

    # RTDB returns JSON null when there is no proposal stored for this id.
    # Treat this as a clear error so the assistant can explain the limitation
    # instead of hallucinating an empty proposal.
    if proposal is None:
        return (
            f"No embedded proposal data found in Firebase for embedded_id={embedded_id!r}.",
            None,
        )

    return "", proposal


def _summarize_proposal(proposal: Dict[str, Any], embedded_id: str) -> str:
    """Create a concise natural-language summary of an embedded proposal."""
    title = proposal.get("title") or proposal.get("id") or embedded_id or "Untitled proposal"
    steps = proposal.get("steps") or []
    actors = proposal.get("actors") or []

    step_titles = [str(step.get("title") or f"Step {idx}") for idx, step in enumerate(steps)]
    actor_names = [str(actor.get("name") or actor.get("id")) for actor in actors]

    num_steps = len(steps)
    num_actors = len(actors)

    parts: List[str] = []
    parts.append(
        f"This chart is an embedded Stepcharts proposal (id {embedded_id!r}) titled "
        f"{title!r}."
    )
    if num_steps:
        parts.append(
            f"It contains {num_steps} step(s), including: "
            + ", ".join(step_titles[:5])
            + ("..." if num_steps > 5 else "")
        )
    if num_actors:
        parts.append(
            f"The proposal involves {num_actors} actor(s), for example: "
            + ", ".join(actor_names[:5])
            + ("..." if num_actors > 5 else "")
        )

    # Optionally highlight the first and last step for a high-level narrative.
    if num_steps >= 2:
        first = steps[0]
        last = steps[-1]
        parts.append(
            "At a high level, it starts with "
            f"{first.get('title', 'an initial structure')} and culminates in "
            f"{last.get('title', 'a final structure')}."
        )

    return " ".join(parts)


async def start_flow(state: Dict[str, Any], config: RunnableConfig) -> Command:
    """Initialize or keep proposal and go to chat."""
    if "proposal" not in state or state["proposal"] is None:
        state["proposal"] = _default_proposal()
        await copilotkit_emit_state(config, state)

    return Command(
        goto="chat_node",
        update={
            "messages": state["messages"],
            "proposal": state["proposal"],
        },
    )


async def chat_node(state: Dict[str, Any], config: RunnableConfig) -> Command:
    """Chat node: use LLM with update_proposal tool and emit state on update."""
    proposal_json = "No proposal yet"
    if state.get("proposal"):
        try:
            proposal_json = json.dumps(state["proposal"], indent=2)
        except Exception as e:
            proposal_json = f"Error: {e}"

    system_prompt = f"""You are a helpful assistant for building legal and financial structure proposals (e.g. trusts, companies, ownership, distributions). The proposal will be displayed in stepcharts.io/play.

Current proposal state:
{proposal_json}

Schema summary (follow this structure):
{PROPOSAL_SCHEMA_SUMMARY}

When the user describes what they want (e.g. "add my spouse as a beneficiary", "form a Delaware LLC", "create a trust with two trustees"), call update_proposal with a complete valid proposal. You may merge with the existing proposal: keep existing actors and steps, add or modify as needed. Use clear, stable actor ids (e.g. person_grantor, company_holding_llc). After updating, reply briefly confirming what you did.

When the user is looking at an existing embedded Stepcharts chart (for example, after they select a preconfigured example in stepcharts.io/play) and asks you to explain or analyze that chart, call read_proposal with the embedded proposal id (the numeric id from the URL or conversation). Then use the tool output to ground your explanation in the actual chart data (actors, steps, ownership, and cash flows)."""

    model = ChatOpenAI(model="gpt-4o-mini")
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[
            {
                "state_key": "proposal",
                "tool": "update_proposal",
                "tool_argument": "proposal",
            }
        ],
    )
    model_with_tools = model.bind_tools(
        [
            *state["copilotkit"]["actions"],
            UPDATE_PROPOSAL_TOOL,
            READ_PROPOSAL_TOOL,
            SUMMARIZE_PROPOSAL_TOOL,
        ],
        parallel_tool_calls=False,
    )

    response = await model_with_tools.ainvoke(
        [
            SystemMessage(content=system_prompt),
            *state["messages"],
        ],
        config,
    )

    messages: List[Any] = state["messages"] + [response]

    if getattr(response, "tool_calls", None):
        tool_call = response.tool_calls[0]
        if isinstance(tool_call, dict):
            tool_call_id = tool_call["id"]
            tool_call_name = tool_call["name"]
            tool_call_args = tool_call.get("args") or {}
            if isinstance(tool_call_args, str):
                tool_call_args = json.loads(tool_call_args)
        else:
            tool_call_id = tool_call.id
            tool_call_name = tool_call.name
            tool_call_args = getattr(tool_call, "args", {}) or {}
            if isinstance(tool_call_args, str):
                tool_call_args = json.loads(tool_call_args)

        if tool_call_name == "update_proposal":
            new_proposal = tool_call_args.get("proposal") or {}
            # Ensure required fields
            if not new_proposal.get("id"):
                new_proposal["id"] = (state.get("proposal") or {}).get("id") or f"proposal_{uuid.uuid4().hex[:12]}"
            if not new_proposal.get("title"):
                new_proposal["title"] = (state.get("proposal") or {}).get("title") or "Proposal"
            if "steps" not in new_proposal or not new_proposal["steps"]:
                new_proposal["steps"] = (state.get("proposal") or {}).get("steps") or [{"id": 0, "title": "Initial Step", "instructions": []}]
            if "actors" not in new_proposal:
                new_proposal["actors"] = (state.get("proposal") or {}).get("actors") or []

            state["proposal"] = new_proposal
            await copilotkit_emit_state(config, state)

            messages = messages + [
                {"role": "tool", "content": "Proposal updated.", "tool_call_id": tool_call_id}
            ]
            return Command(
                goto="start_flow",
                update={"messages": messages, "proposal": new_proposal},
            )

        if tool_call_name == "read_proposal":
            embedded_id = str(tool_call_args.get("embedded_id") or "").strip()
            error_message, embedded_proposal = _fetch_proposal_from_rtdb(embedded_id)

            if error_message:
                tool_content = json.dumps(
                    {
                        "embedded_id": embedded_id,
                        "error": error_message,
                    }
                )
            else:
                summary = _summarize_proposal(embedded_proposal or {}, embedded_id)
                tool_content = json.dumps(
                    {
                        "embedded_id": embedded_id,
                        "summary": summary,
                    }
                )

            messages = messages + [
                {
                    "role": "tool",
                    "content": tool_content,
                    "tool_call_id": tool_call_id,
                }
            ]

            # Let the model turn the tool result into a user-facing explanation.
            followup = await model.ainvoke(
                [
                    SystemMessage(
                        content=(
                            "You just called the read_proposal tool, which fetched and "
                            "summarized the current embedded Stepcharts proposal. "
                            "Use that tool output to give the user a clear, concise "
                            "explanation of the chart, focusing on the overall structure, "
                            "key actors, and major steps."
                        )
                    ),
                    *messages,
                ],
                config,
            )
            messages = messages + [followup]
            return Command(
                goto="start_flow",
                update={"messages": messages, "proposal": state.get("proposal")},
            )

        if tool_call_name == "summarize_current_proposal":
            proposal = state.get("proposal") or {}
            tool_content = json.dumps({"proposal": proposal})

            messages = messages + [
                {
                    "role": "tool",
                    "content": tool_content,
                    "tool_call_id": tool_call_id,
                }
            ]

            followup = await model.ainvoke(
                [
                    SystemMessage(
                        content=(
                            "You just called the summarize_current_proposal tool. "
                            "The tool output is the current ProposalBuildSpec JSON "
                            "under the 'proposal' key. Using ONLY that JSON (do not "
                            "invent steps or actors that are not present), give the "
                            "user a clear, concise natural-language summary of the "
                            "proposal: who the key actors are, what the main steps "
                            "do, and any important ownership or cash-flow structures. "
                            "Keep the summary 1–3 short paragraphs unless the user "
                            "asked for more detail."
                        )
                    ),
                    *messages,
                ],
                config,
            )
            messages = messages + [followup]
            return Command(
                goto="start_flow",
                update={"messages": messages, "proposal": state.get("proposal")},
            )

    await copilotkit_exit(config)
    return Command(
        goto=END,
        update={"messages": messages, "proposal": state.get("proposal")},
    )


workflow = StateGraph(AgentState)
workflow.add_node("start_flow", start_flow)
workflow.add_node("chat_node", chat_node)
workflow.set_entry_point("start_flow")
workflow.add_edge(START, "start_flow")
workflow.add_edge("start_flow", "chat_node")
workflow.add_edge("chat_node", END)

cyber_risk_graph = workflow.compile()
