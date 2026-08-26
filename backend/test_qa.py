import asyncio
from src.agents.state import ProfilingState
from src.agents.nodes.qa_nodes import qa_structured_node

async def run():
    state = {
        "question": "Trong dữ liệu có những bệnh lý nào và số lượng bệnh nhân mắc từng bệnh là bao nhiêu? Hãy trực quan hóa để tôi dễ so sánh các bệnh.",
        "profile_run_id": "test_run",
        "qa_context": {
            "analysis_execution": {
                "id": "123",
                "result": {"data": [{"Category": "Clothing", "Quantity": 41438}, {"Category": "Furniture", "Quantity": 41194}]}
            }
        },
        "workspace_id": "test_workspace"
    }
    try:
        res = qa_structured_node(state)
        print("SUCCESS:", res)
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(run())
