"""Tool cho nhánh Q&A định lượng.

Nguyên tắc: **LLM không tự tính số**. Mọi con số trong câu trả lời phải đi qua
một trong các tool ở đây, tức là đọc từ bảng `column_stats` / `*_proposals` /
`statistical_test_results` đã được compute engine ghi ra.

Tool nào trả về giá trị dữ liệu thật (`top_k_values`) đều kiểm tra PII trước và
ẩn nếu cột thuộc diện PII (eval C-01) — kể cả khi người hỏi yêu cầu trực tiếp.
"""

from __future__ import annotations

import ast
import operator
from typing import Any

from langchain_core.tools import tool

from src.config import get_settings
from src.services.repository import get_repository
from src.services.security import get_audit

# --------------------------------------------------------------------------- #
# Context: profile_run_id được inject lúc chạy, không để LLM tự chọn run
# --------------------------------------------------------------------------- #
_current_run_id: str | None = None

_MASKED = "ĐÃ ẨN — cột này thuộc diện PII, không được trả về giá trị thật."


def _run_id() -> str:
    if not _current_run_id:
        raise ValueError("Chưa có profile_run_id trong ngữ cảnh.")
    return _current_run_id


def _pii_columns(run_id: str) -> set[str]:
    return set(get_repository().confirmed_pii_columns(run_id))


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
@tool
def list_columns() -> dict[str, Any]:
    """Liệt kê các cột của dataset kèm dtype, null%, cardinality.

    Dùng khi cần biết dataset có những cột nào trước khi tra chi tiết.
    """
    run_id = _run_id()
    stats = get_repository().get_column_stats(run_id)
    pii = _pii_columns(run_id)
    return {
        "column_count": len(stats),
        "columns": [
            {
                "column_name": col,
                "dtype": st.get("dtype"),
                "null_pct": st.get("null_pct"),
                "cardinality": st.get("cardinality"),
                "is_pii": col in pii,
                "is_approximate": bool(st.get("is_approximate")),
            }
            for col, st in stats.items()
        ],
    }


@tool
def get_stat(column_name: str, stat_name: str = "all") -> dict[str, Any]:
    """Lấy thống kê của một cột từ kết quả profiling.

    Args:
        column_name: Tên cột cần tra.
        stat_name: Tên chỉ số (null_pct, cardinality, mean, median, std, min_value,
            max_value, q1, q3, outlier_count, uniqueness_ratio, top_k_values) hoặc
            "all" để lấy tất cả.

    Returns:
        Giá trị chỉ số, kèm cờ is_approximate và margin_of_error nếu quét mẫu.
    """
    run_id = _run_id()
    stats = get_repository().get_column_stats(run_id)
    if column_name not in stats:
        return {
            "error": f"Không có cột '{column_name}' trong kết quả profiling.",
            "available_columns": list(stats.keys())[:50],
        }

    entry = dict(stats[column_name])
    if column_name in _pii_columns(run_id):
        entry["top_k_values"] = _MASKED
        entry["is_pii"] = True

    if stat_name != "all":
        if stat_name not in entry:
            return {
                "error": f"Không có chỉ số '{stat_name}'.",
                "available_stats": sorted(k for k in entry if not k.startswith("_")),
            }
        return {
            "column_name": column_name,
            "stat_name": stat_name,
            "value": entry[stat_name],
            "is_approximate": bool(entry.get("is_approximate")),
            "margin_of_error": entry.get("margin_of_error"),
        }
    return {"column_name": column_name, **entry}


@tool
def get_correlation(column_a: str = "", column_b: str = "") -> dict[str, Any]:
    """Lấy hệ số tương quan Pearson giữa hai cột số, hoặc cả ma trận nếu bỏ trống.

    Args:
        column_a: Cột thứ nhất (bỏ trống để lấy toàn bộ ma trận).
        column_b: Cột thứ hai.
    """
    run = get_repository().get_profile_run(_run_id())
    matrix = (run or {}).get("correlation_matrix") or {}
    if not matrix:
        return {"error": "Dataset không có đủ cột số để tính tương quan."}
    if not column_a or not column_b:
        return {"correlation_matrix": matrix}
    if column_a not in matrix or column_b not in matrix.get(column_a, {}):
        return {
            "error": f"Không có tương quan giữa '{column_a}' và '{column_b}' (cần cả hai là cột số).",
            "numeric_columns": list(matrix.keys()),
        }
    return {
        "column_a": column_a,
        "column_b": column_b,
        "pearson_r": matrix[column_a][column_b],
    }


@tool
def get_proposals(kind: str = "all") -> dict[str, Any]:
    """Lấy các đề xuất metadata và trạng thái xác nhận của chúng.

    Args:
        kind: "candidate_key", "semantic_type", "pii" hoặc "all".
    """
    run_id = _run_id()
    proposals = get_repository().get_proposals(run_id)
    if kind != "all":
        if kind not in proposals:
            return {"error": "kind phải là candidate_key, semantic_type, pii hoặc all."}
        return {kind: proposals[kind]}
    return proposals


@tool
def get_test_results() -> dict[str, Any]:
    """Lấy kết quả các kiểm định thống kê đã chạy cho lần profiling này.

    Kết quả có kèm p_value_adjusted và significant_after_correction khi chạy
    nhiều kiểm định cùng lúc.
    """
    results = get_repository().get_test_results(_run_id())
    if not results:
        return {
            "results": [],
            "note": "Chưa chạy kiểm định nào. Analyst cần yêu cầu qua POST /profile/{id}/test.",
        }
    return {"results": results}


@tool
def get_risk_warnings() -> dict[str, Any]:
    """Lấy danh sách cảnh báo rủi ro dữ liệu (null cao, outlier, PII, quasi-identifier)."""
    run = get_repository().get_profile_run(_run_id()) or {}
    return {
        "risk_warnings": run.get("risk_warnings") or [],
        "quasi_identifiers": run.get("quasi_identifiers") or [],
        "is_approximate": bool(run.get("is_approximate")),
    }


@tool
def get_run_metadata() -> dict[str, Any]:
    """Lấy metadata của lần profiling: số dòng, chế độ quét, seed, query đã chạy."""
    run = get_repository().get_profile_run(_run_id()) or {}
    return {
        "profile_run_id": run.get("id"),
        "row_count": run.get("row_count"),
        "scan_mode": run.get("scan_mode"),
        "sampling_strategy": run.get("sampling_strategy"),
        "sample_size": run.get("sample_size"),
        "random_seed": run.get("random_seed"),
        "executed_query": run.get("executed_query"),
        "version": run.get("version"),
        "status": run.get("status"),
        "is_approximate": bool(run.get("is_approximate")),
    }


# --------------------------------------------------------------------------- #
# calculate: chỉ để LLM cộng/trừ trên số ĐÃ tra được, không tự bịa số
# --------------------------------------------------------------------------- #
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

_MAX_POW = 1_000_000


def _eval_node(node: ast.AST) -> float:
    """Duyệt AST với tập toán tử an toàn — không dùng eval()."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ValueError(f"Hằng số không hỗ trợ: {type(node.value).__name__}")
        return node.value
    if isinstance(node, ast.UnaryOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Toán tử không hỗ trợ: {type(node.op).__name__}")
        return op(_eval_node(node.operand))
    if isinstance(node, ast.BinOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Toán tử không hỗ trợ: {type(node.op).__name__}")
        left, right = _eval_node(node.left), _eval_node(node.right)
        # Chặn 9**9**9 gây treo CPU.
        if isinstance(node.op, ast.Pow) and (abs(right) > 64 or abs(left) ** abs(right) > _MAX_POW):
            raise ValueError("Luỹ thừa quá lớn.")
        return op(left, right)
    raise ValueError(f"Biểu thức không hỗ trợ: {type(node).__name__}")


@tool
def calculate(expression: str) -> str:
    """Tính biểu thức số học trên các con số ĐÃ tra được từ tool khác.

    Chỉ dùng để biến đổi số đã có (ví dụ đổi tỷ lệ thành số dòng), tuyệt đối
    không dùng để bịa ra số liệu chưa tra.

    Args:
        expression: Biểu thức, ví dụ "0.153 * 12000".
    """
    if len(expression) > 200:
        return "Lỗi: biểu thức quá dài."
    try:
        return str(_eval_node(ast.parse(expression, mode="eval").body))
    except (SyntaxError, ValueError, TypeError, ZeroDivisionError, OverflowError) as exc:
        return f"Lỗi tính toán: {exc}"


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
STRUCTURED_TOOLS = [
    list_columns,
    get_stat,
    get_correlation,
    get_proposals,
    get_test_results,
    get_risk_warnings,
    get_run_metadata,
    calculate,
]

_TOOLS_BY_NAME = {t.name: t for t in STRUCTURED_TOOLS}


def run_tool(name: str, args: dict[str, Any], profile_run_id: str | None = None) -> Any:
    """Chạy tool theo tên với `profile_run_id` được inject vào ngữ cảnh.

    LLM không được chọn run_id — nếu được, nó có thể đọc dữ liệu của dataset khác.
    """
    global _current_run_id

    tool_obj = _TOOLS_BY_NAME.get(name)
    if tool_obj is None:
        return {"error": f"Không có tool '{name}'.", "available": sorted(_TOOLS_BY_NAME)}

    previous = _current_run_id
    _current_run_id = profile_run_id
    try:
        result = tool_obj.invoke(args)
    except Exception as exc:  # noqa: BLE001 - lỗi tool phải quay lại LLM, không phá pipeline
        get_audit().log("tool_error", tool=name, error=str(exc), profile_run_id=profile_run_id)
        return {"error": f"Tool '{name}' lỗi: {exc}"}
    finally:
        _current_run_id = previous

    if get_settings().security_audit_log:
        get_audit().log("tool_call", tool=name, args=args, profile_run_id=profile_run_id)
    return result


__all__ = [
    "STRUCTURED_TOOLS",
    "calculate",
    "get_correlation",
    "get_proposals",
    "get_risk_warnings",
    "get_run_metadata",
    "get_stat",
    "get_test_results",
    "list_columns",
    "run_tool",
]
