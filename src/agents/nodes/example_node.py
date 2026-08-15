"""LangGraph nodes for understanding and answering profiling questions."""

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

from src.agents.state import AgentState
from src.agents.tools.example_tool import calculate, search_knowledge
from src.agents.tools.registry import TOOL_REGISTRY
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
    tool_names = ", ".join(tool.name for tool in TOOL_REGISTRY)
    messages = [
        SystemMessage(content=system_prompt),
        SystemMessage(content=f"Available platform tools: {tool_names}"),
    ]
    if context:
        messages.append(SystemMessage(content=f"Current profile context:\n{context}"))
    messages.append(HumanMessage(content=query))

    try:
        llm = get_llm()
        executable_tools = [search_knowledge, calculate]
        if not hasattr(llm, "bind_tools"):
            result = await llm.ainvoke(messages)
            return {"response": str(result.content), "analysis": "Response generated from safe context."}

        tool_bound_llm = llm.bind_tools(executable_tools)
        tool_by_name = {selected_tool.name: selected_tool for selected_tool in executable_tools}
        tool_call_count = 0
        for _ in range(4):
            result = await tool_bound_llm.ainvoke(messages)
            messages.append(result)
            tool_calls = getattr(result, "tool_calls", None) or []
            if not tool_calls:
                return {
                    "response": str(result.content),
                    "analysis": f"Response generated with {tool_call_count} tool call(s).",
                }
            for tool_call in tool_calls:
                selected_tool = tool_by_name.get(tool_call.get("name"))
                if selected_tool is None:
                    continue
                tool_content = selected_tool.invoke(tool_call.get("args") or {})
                tool_call_count += 1
                messages.append(
                    ToolMessage(
                        content=tool_content,
                        tool_call_id=tool_call.get("id", selected_tool.name),
                    )
                )
        result = await tool_bound_llm.ainvoke(messages)
    except Exception as exc:
        return {
            "error": type(exc).__name__,
            "response": "The language model request failed. Check the agent run trace for details.",
        }
    return {
        "response": str(result.content),
        "analysis": "Response generated after tool loop limit.",
    }
