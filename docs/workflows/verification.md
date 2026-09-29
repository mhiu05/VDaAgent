# Kiểm tra luồng phân tích

Chạy các lệnh từ root repository. Các suite unit và integration dùng provider giả lập và cơ sở dữ liệu thử nghiệm tách biệt; không cần khóa LLM thật. `pnpm test:db` và hai suite E2E cần Supabase cục bộ đã chạy, không dùng database được liên kết với môi trường triển khai.

## Kiểm tra tĩnh và hợp đồng

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm format:changed
pnpm contracts:export
pnpm check:design-tokens
pnpm build:backend
pnpm build:web
```

`format:changed` kiểm tra file mới hoặc thay đổi nội dung so với HEAD, bỏ qua file chỉ được move với byte content giữ nguyên. `format:check` vẫn kiểm tra toàn repository; baseline cũ có thể làm lệnh này fail và phải được ghi riêng. Sau `contracts:export`, kiểm tra diff của 33 JSON Schema trong `src/contracts/schema`. Việc đổi đường dẫn source không được tự ý đổi hợp đồng JSON. Build web phải dùng cấu hình cục bộ phù hợp với launcher trong `src/frontend/next-with-env.mjs`.

## Unit, integration và PostgreSQL

```powershell
pnpm test
pnpm db:start
pnpm exec supabase migration up --local --workdir src/backend
pnpm test:db
```

`pnpm test` chạy suite gốc tại `tests/`, gồm API, worker, frontend, agent, repository và kiểm thử `postgres.js` qua giao thức PostgreSQL trên PGlite. Fixture chặn provider outbound, kiểm tra JSONB, lease/fence, publication, tenant và SSE replay. `pnpm test:db` chạy pgTAP tại `tests/db/tenant_rls.test.sql` qua Supabase CLI cục bộ. Nếu Supabase chưa chạy hoặc migrations cục bộ chưa được áp dụng, ghi rõ điều kiện môi trường; không xem đó là test pass.

## Trình duyệt và worker

```powershell
pnpm test:e2e
pnpm test:e2e:durable
```

Runner `scripts/run-e2e.mjs` xác nhận URL database và API của Supabase là loopback trước khi khởi động. Nó build web riêng, mở web và worker với provider giả lập, chạy Playwright rồi dừng các process đã mở. Chạy cả hai mode để kiểm tra gửi câu hỏi, quyền truy cập, tiến trình bền vững, refresh và kết quả. Không cấp credential production cho runner.

## Kiểm tra kết quả

- Một lượt gửi có cùng `client_turn_id` chỉ tạo một job/run; scope và ngày dữ liệu của run giữ nguyên đến khi hoàn tất.
- Stream có thể đóng sau thời hạn kết nối. Đọc lại bằng `Last-Event-ID` và xác nhận trạng thái terminal từ dữ liệu đã lưu; ngắt kết nối không hủy worker.
- Artifact và claim phải truy ngược tới đúng run, nguồn và hash. Chỉ review `PASS` đúng revision mới tạo báo cáo chính thức.
- Với lỗi provider hoặc quyền truy cập, không xuất bản draft; mã lỗi công khai không chứa response, prompt hoặc credential.
- Reader vẫn mở được báo cáo lịch sử, kể cả khi không có decision pack mới. Executor `legacy-v1` đã bỏ khỏi codebase; worker chỉ claim `agent-v1`, API source chỉ dùng `/api`.

## Kiểm kê Gate P1 và incident từ xa

`scripts/maintenance/audit-readiness.mjs` chỉ chạy truy vấn read-only. Chỉ định project ref hoặc `local` rõ ràng và đối chiếu URL API với tài khoản database trước khi truy vấn. Ví dụ local: truyền `SUPABASE_DB_URL` và `NEXT_PUBLIC_SUPABASE_URL` từ `supabase status --output env --workdir src/backend`, rồi chạy `node scripts/maintenance/audit-readiness.mjs --expect-project=local`. Với môi trường triển khai, chạy `node --env-file=.env scripts/maintenance/audit-readiness.mjs --expect-project=<project-ref> --run-id=<run-id>` sau khi operator xác minh `.env` đúng môi trường. Không in credential hay nội dung hội thoại. Trước production deployment, Gate P1 yêu cầu kiểm kê mọi project ứng dụng và xác nhận không còn run legacy/missing-version nonterminal, live lease hoặc linked job có thể retry; worker cũ phải dừng hoặc drain trước khi worker canonical được triển khai.
