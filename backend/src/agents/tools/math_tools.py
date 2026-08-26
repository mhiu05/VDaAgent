"""Math tools for the LLM to perform numeric calculations."""

import operator
import ast
from typing import Any
from langchain_core.tools import tool
# pyrefly: ignore [missing-import]
from src.agents.tools.common import active_run, ok, error

def _eval_ast(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    elif isinstance(node, ast.BinOp):
        left = _eval_ast(node.left)
        right = _eval_ast(node.right)
        op = type(node.op)
        if op is ast.Add: return left + right
        elif op is ast.Sub: return left - right
        elif op is ast.Mult: return left * right
        elif op is ast.Div: return left / right
        elif op is ast.Mod: return left % right
        else:
            raise ValueError("Chỉ hỗ trợ +, -, *, /, %")
    elif isinstance(node, ast.UnaryOp):
        operand = _eval_ast(node.operand)
        if isinstance(node.op, ast.USub): return -operand
        elif isinstance(node.op, ast.UAdd): return operand
        else:
            raise ValueError("Chỉ hỗ trợ dấu âm/dương")
    else:
        raise ValueError(f"Cú pháp không được hỗ trợ: {type(node)}")

@tool
def calculate(expression: str) -> dict[str, Any]:
    """Thực hiện phép tính toán học cơ bản (+, -, *, /, %). Luôn dùng tool này nếu cần tính toán, tỷ lệ phần trăm hoặc chênh lệch, không tự đoán số."""
    run_id, run = active_run("calculate")
    if not run:
        return error("calculate", "forbidden_scope", "Thiếu profile_run_id để ghi nhận.")
    
    try:
        node = ast.parse(expression.strip(), mode='eval').body
        result = _eval_ast(node)
        return ok(
            "calculate",
            run_id,
            run,
            {"expression": expression, "result": result},
            artifact="calculator",
        )
    except Exception as exc:
        return error("calculate", "invalid_expression", f"Biểu thức không hợp lệ: {exc}")

MATH_TOOLS = [calculate]
