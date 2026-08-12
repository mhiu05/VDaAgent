"""LangGraph nodes for understanding and answering profiling questions."""

from langchain_core.messages import HumanMessage, SystemMessage

from src.agents.state import AgentState
from src.services.llm import get_llm


async def analyze_node(state: AgentState) -> dict:
    """Prepare a concise analysis instruction for the response node."""
    query = state.get("query", "")
    if not query.strip():
        return {"error": "The question is empty."}
    return {"analysis": "Answer the profiling question using only available context."}


async def respond_node(state: AgentState) -> dict:
    """Generate the user-facing answer through the configured LLM API."""
    query = state.get("query", "")
    context = state.get("context", "")
    error = state.get("error")

    if error:
        return {"response": f"Error: {error}"}

    system_prompt = (
        "You are the assistant inside a data profiling platform. Explain profiling metrics, "
        "data quality findings, statistical tests, PII, and HITL decisions accurately and "
        "concisely. Never invent dataset facts that are not present in the supplied context. "
        "Reply in the same language as the user. Do not reveal chain-of-thought."
    )
    messages = [SystemMessage(content=system_prompt)]
    if context:
        messages.append(SystemMessage(content=f"Current profile context:\n{context}"))
    messages.append(HumanMessage(content=query))

    try:
        result = await get_llm().ainvoke(messages)
    except Exception as exc:
        return {
            "error": type(exc).__name__,
            "response": "The language model request failed. Check the agent run trace for details.",
        }
    return {"response": str(result.content), "analysis": "Response generated from safe context."}
