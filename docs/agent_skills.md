# Native Agent Skills

## Mô hình

Skill không đồng nghĩa với tool. Skill là playbook có version: mục tiêu, điều kiện dùng, quyền yêu cầu, guardrail và evidence cần trả. Tool là thao tác có contract hẹp. Một skill có thể gọi nhiều tools, một tool cũng có thể được dùng bởi nhiều skills; workflow có side effect đi qua API đã được phân quyền, không đi qua tool dispatcher tự do.

Registry ở `backend/src/agents/skills/registry.py` là nguồn runtime cho catalog, version, capability và allowlist. Mỗi skill có `SKILL.md` ngắn để làm playbook và `agents/openai.yaml` để hiển thị UI metadata.

| Skill | Mode | Permission | Tools / workflow |
| --- | --- | --- | --- |
| `profile-dataset` | API workflow | `profile.run` | `POST /profile` |
| `diagnose-data-quality` | Read-only bundle | `profile.read` | readiness, overview, quality, missingness, duplicates, governance |
| `compare-profile-drift` | Read-only bundle | `profile.read` | persisted drift summary, findings, schema diff |
| `answer-business-question` | API workflow | `qa.profile.ask` | `POST /qa` + existing bounded catalog |
| `generate-report` | API workflow | `report.draft.write` | report workflow API |

## Runtime behavior

Q&A chọn playbook bằng deterministic keyword routing và đưa guidance đã version vào prompt structured. Đây chỉ là hint hành vi: guardrail, tenant scope, tool budget và router Q&A hiện hữu vẫn là authority.

Hai skill read-only có thể chạy bundle qua API:

```text
GET  /api/v1/agent-skills
GET  /api/v1/agent-skills/{skill_name}
POST /api/v1/agent-skills/{skill_name}/inspect
```

`inspect` cần `profile.read`, kiểm tra `profile_run_id` thuộc workspace hiện tại trước khi dispatcher gọi tool. Skill API workflow trả `409` tại endpoint inspect và nêu API chuẩn cần gọi, tránh để agent kích hoạt profiling, QA hoặc xuất report ngoài contract hiện có.

## Tool mới

`get_profile_readiness` là tool chỉ-đọc, trả profile status, số proposal pending và cờ `ready_for_evidence_workflows`. Nó được dùng trong `diagnose-data-quality`; không thay thế Analysis Workspace quality gate.

## Bảo mật và giới hạn

- Không có raw SQL, arbitrary code, raw row hay giá trị PII trong skill/tool contract.
- Tool names là allowlist tĩnh trong registry; model không thể đăng ký tool hay skill mới lúc chạy.
- Mọi aggregate/evidence vẫn xuất phát từ profiling deterministic và được giới hạn bởi tool envelope.
- Drift chỉ đọc report đã persist; việc tạo drift vẫn do endpoint hiện hữu kiểm tra same-dataset.
- Metadata proposal vẫn cần human review; report chỉ dùng evidence đã persist và section được chọn.
