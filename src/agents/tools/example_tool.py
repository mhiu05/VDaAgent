import ast
import json
import operator

from langchain_core.tools import tool

_SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


@tool
def search_knowledge(query: str, user_id: str = "anonymous", limit: int = 5) -> str:
    """Search ingested requirement documents for the current user.

    Args:
        query: Search query or requirement text.
        user_id: Workspace owner identifier.
        limit: Maximum number of matching excerpts to return.

    Returns:
        JSON list of matching document excerpts.
    """
    from src.agents.planning import planning_store

    results = planning_store.search_documents(user_id=user_id, query=query, limit=limit)
    return json.dumps([result.model_dump(mode="json") for result in results], ensure_ascii=False)


@tool
def calculate(expression: str) -> str:
    """Safely evaluate a simple arithmetic expression.

    Supports +, -, *, /, //, %, **, and parentheses.
    """
    try:
        tree = ast.parse(expression, mode="eval")
        result = _eval_node(tree.body)
        return str(result)
    except (SyntaxError, ValueError, TypeError, ZeroDivisionError) as e:
        return f"Calculation error: {e}"


def _eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError(f"Unsupported constant type: {type(node.value)}")
    if isinstance(node, ast.UnaryOp):
        op_func = _SAFE_OPERATORS.get(type(node.op))
        if op_func is None:
            raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
        return op_func(_eval_node(node.operand))
    if isinstance(node, ast.BinOp):
        op_func = _SAFE_OPERATORS.get(type(node.op))
        if op_func is None:
            raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
        return op_func(_eval_node(node.left), _eval_node(node.right))
    raise ValueError(f"Unsupported expression: {type(node).__name__}")
