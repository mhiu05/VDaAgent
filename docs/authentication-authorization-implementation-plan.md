# Plan

> Current implementation note (2026-08-12): VDaAgent uses three roles only:
> `viewer`, `analyst`, and `admin`. The former `owner` role is retired and its
> permissions are included in `admin`; references to owner below are historical.

Triển khai Supabase Auth và workspace-based RBAC cho VDaAgent, đồng thời nâng frontend hiện tại thành ba trải nghiệm trong cùng một Next.js application: Viewer Portal, Analyst Workspace và Admin Console. Viewer chỉ tiêu thụ báo cáo đã publish; analyst thực hiện profiling/phân tích và tạo draft; admin kiểm duyệt, giám sát và quản lý thành viên; owner quản lý chính sách và lifecycle workspace. FastAPI tiếp tục là domain API và authorization boundary duy nhất, còn Supabase đảm nhiệm Auth, PostgreSQL và Storage.

## Scope

- In:
  - Đăng ký, xác nhận email, đăng nhập, đăng xuất, quên/đổi mật khẩu và duy trì/refresh session bằng Supabase Auth.
  - Next.js 15 App Router dùng `@supabase/ssr`; FastAPI xác thực Supabase access token bằng JWKS bất đối xứng.
  - Multi-tenant theo workspace với bốn role `owner`, `admin`, `analyst`, `viewer`, permission catalog tập trung và quản lý thành viên/lời mời.
  - Một frontend/build duy nhất, nhưng dashboard, navigation, route và action thay đổi theo effective permissions của membership hiện tại; không tạo bốn codebase riêng.
  - Published Report domain với draft/review/publish/archive, version bất biến, KPI, biểu đồ, narrative, limitation và evidence liên kết tới bounded execution.
  - Viewer Portal chỉ hiển thị báo cáo đã publish; Analyst Workspace tổ chức work queue từ upload tới draft report; Admin Console tổng hợp activity, review queue, governance, member và audit.
  - Scope toàn bộ dataset, profile, proposal, statistical test, drift, Q&A, Analysis Workspace, audit, retrieval và Storage theo workspace/người dùng.
  - Migration/backfill dữ liệu hiện có, RLS defense-in-depth, kiểm thử backend/frontend/integration, rollout và rollback an toàn.
  - Email/password là phương thức đăng nhập đầu tiên; production mặc định invite-only nhưng có feature flag để mở self-signup.
- Out:
  - Social login, SSO/SAML, phone auth, billing và phân quyền theo từng cột/dataset riêng lẻ trong lần triển khai đầu.
  - Long-term chat memory ở backend. Chat history hiện tại vẫn ở trình duyệt nhưng phải namespace theo user/workspace để không lẫn tài khoản.
  - Bốn frontend/deployment riêng cho từng role. Role chỉ quyết định permission và trải nghiệm trong cùng ứng dụng.
  - Dashboard builder tùy ý, arbitrary chart code, raw SQL, raw-row drill-down hoặc viewer tự tạo aggregate trong lần đầu. Viewer nhận snapshot đã publish; interactive safe filter có thể bổ sung sau.
  - Phân quyền riêng theo từng report/dataset ngoài workspace membership. Bản đầu publish report cho toàn bộ viewer trong workspace; per-resource ACL là phase sau nếu có nhu cầu.
  - Truy cập trực tiếp domain tables từ browser qua Supabase Data API. Frontend chỉ dùng Supabase client cho Auth và gọi nghiệp vụ qua FastAPI.
  - Thay đổi các guardrail compute/PII hiện có, ngoài việc bổ sung tenant scope và actor đã xác thực.

## Action items

[ ] 1. Chốt role responsibilities, permission catalog và publication policy trước khi sửa code.

  - Dùng `sub` trong Supabase JWT làm `user_id`; email/display name chỉ dùng hiển thị, không dùng làm authorization key. Không nhận actor do client tự khai như `confirmed_by`, `requested_by`, `approved_by`; backend tự điền từ `AuthContext`.
  - Dùng workspace làm tenant boundary. Mỗi user có đúng một membership/role trong từng workspace nhưng có thể thuộc nhiều workspace. Request domain gửi `X-Workspace-Id`; nếu user có nhiều membership mà thiếu header thì trả `409 workspace_required`.
  - Định nghĩa trách nhiệm role:
    - `viewer` là người tiêu thụ kết quả: chỉ xem/tải báo cáo đã publish và hỏi trong phạm vi published evidence; không thấy dataset catalog, profile internals, proposal, quality gate, draft hoặc analyst activity.
    - `analyst` là người tạo bằng chứng: upload/profile dataset, review metadata/PII, test/drift, chạy bounded analysis, tạo KPI/chart/narrative, soạn draft và submit report; không tự quản lý member hoặc publish bản cần duyệt.
    - `admin` là người vận hành/kiểm duyệt: kế thừa analyst, xem toàn bộ workspace work queue/activity/governance, review/publish/archive report, xóa dataset, quản lý viewer/analyst/invitation và audit; không được cấp owner hoặc tự nâng ai thành admin, vẫn không có raw-row API.
    - `owner` là chủ workspace: kế thừa admin, quản lý auth/security policy, admin/owner membership, ownership transfer và workspace lifecycle. Owner dùng chung Admin Console, chỉ có thêm Settings; không cần frontend thứ tư.
  - Dùng permission identifiers thay vì kiểm tra role rải rác trong route/component. Permission matrix mục tiêu:

    | Capability | Permission | Viewer | Analyst | Admin | Owner |
    | --- | --- | :---: | :---: | :---: | :---: |
    | Xem published report/KPI/chart/evidence | `report.published.read` | ✓ | ✓ | ✓ | ✓ |
    | Tải PDF/aggregate export của report | `report.published.export` | ✓ | ✓ | ✓ | ✓ |
    | Hỏi Q&A chỉ trên published report | `qa.published.ask` | ✓ | ✓ | ✓ | ✓ |
    | Xem dataset/profile nội bộ | `dataset.read`, `profile.read` | — | ✓ | ✓ | ✓ |
    | Upload và chạy profiling | `dataset.upload`, `profile.run` | — | ✓ | ✓ | ✓ |
    | Review proposal PII/semantic/key | `profile.review` | — | ✓ | ✓ | ✓ |
    | Chạy test, drift và profile Q&A | `stats.run`, `drift.run`, `qa.profile.ask` | — | ✓ | ✓ | ✓ |
    | Tạo context/gate/bounded execution | `analysis.run` | — | ✓ | ✓ | ✓ |
    | Tạo/sửa draft và chart | `report.draft.write` | — | ✓ | ✓ | ✓ |
    | Submit report để duyệt | `report.submit` | — | ✓ | ✓ | ✓ |
    | Review/yêu cầu chỉnh sửa | `report.review` | — | — | ✓ | ✓ |
    | Publish/archive report | `report.publish`, `report.archive` | — | — | ✓ | ✓ |
    | Xóa dataset và cascade artifacts | `dataset.delete` | — | — | ✓ | ✓ |
    | Xem activity/governance/audit | `workspace.activity.read`, `workspace.audit.read` | — | — | ✓ | ✓ |
    | Invite/remove/đổi viewer hoặc analyst | `workspace.members.manage` | — | — | ✓ | ✓ |
    | Quản lý admin/owner, security và lifecycle | `workspace.settings.manage`, `workspace.ownership.manage` | — | — | — | ✓ |

  - Lưu role-to-permission mapping tập trung trong backend và trả `effective_permissions` từ `/api/v1/me`; frontend dùng cùng identifiers qua TypeScript constants. Role có tính kế thừa nhưng permission mới phải được thêm explicit và test, không mặc định cấp cho mọi role cao hơn nếu đó là thao tác security-sensitive.
  - Áp dụng report separation of duties mặc định: analyst submit, admin/owner khác actor review và publish. Admin đã tạo version không tự approve version đó; owner chỉ override khi khẩn cấp và phải nhập lý do được audit. Có workspace setting để nới policy sau, nhưng không mặc định analyst self-publish.
  - Chỉ để `/`, `/health` và UI auth public. `/api/v1/status`, `/api/v1/audit` yêu cầu admin; workspace security/lifecycle yêu cầu owner. Tắt Swagger `/docs` ở production public hoặc đặt sau lớp admin/gateway.
  - Dùng `404` cho resource ID ngoài workspace để tránh enumeration, `403` khi membership hợp lệ nhưng thiếu permission, `401` cho token thiếu/hỏng/hết hạn và `409` cho workflow transition không hợp lệ.
  - Giữ `security.require_api_token`/`API_TOKEN` chỉ làm cầu nối trong `AUTH_MODE=dual`; production đích là `AUTH_MODE=supabase` fail-closed.

[ ] 2. Chuẩn bị Supabase project, biến môi trường và secret handoff rõ ràng.

  - Thêm cấu hình backend trong `.env.example` và `backend/src/config.py`: `AUTH_MODE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_AUTH_ISSUER` (mặc định `${SUPABASE_URL}/auth/v1`), `SUPABASE_AUTH_AUDIENCE=authenticated`, `AUTH_ALLOW_SIGNUP`, `AUTH_REQUIRE_EMAIL_CONFIRMED` và cache TTL cho JWKS.
  - Thêm cấu hình frontend trong `frontend/.env.local.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_AUTH_ALLOW_SIGNUP` và `NEXT_PUBLIC_API_URL`. Không đặt bất kỳ secret nào trong biến có prefix `NEXT_PUBLIC_`.
  - Dùng publishable/secret API key mới thay cho `anon`/`service_role` legacy. Giữ `SUPABASE_SERVICE_ROLE_KEY` làm fallback có cảnh báo trong một release vì code Storage hiện tại đang dùng tên này, rồi xóa fallback sau khi xác minh `SUPABASE_SECRET_KEY` hoạt động. Supabase đã công bố legacy key sẽ bị deprecated vào cuối năm 2026: [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
  - Các giá trị cần chủ dự án tự lấy và nơi lấy:

    | Giá trị | Bí mật | Bắt buộc | Nơi lấy/cấu hình |
    | --- | --- | --- | --- |
    | `SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_URL` | Không | Có | Supabase Dashboard → project → **Connect** → Project URL. Hai biến dùng cùng URL. |
    | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` và backend `SUPABASE_PUBLISHABLE_KEY` | Không | Có | Dashboard → **Connect**, hoặc **Settings → API Keys → Publishable key** (`sb_publishable_...`). |
    | `SUPABASE_SECRET_KEY` | Có, quyền cao | Có cho Storage và invite/member admin | Dashboard → **Settings → API Keys → Secret keys → Create new secret key**; tạo key riêng tên `p170-backend`. Chỉ đặt ở backend `.env`/secret manager. |
    | `DATABASE_URL` | Có vì chứa DB password | Có | Dashboard → **Connect**. Backend lâu dài dùng Direct connection nếu hạ tầng có IPv6, nếu không dùng Supavisor Session mode; luôn bật SSL. Hướng dẫn lựa chọn connection: [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres). |
    | `DATABASE_MIGRATION_URL` | Có | Có khi chạy migration | Dashboard → **Connect** → Direct connection. Dùng cho Alembic/migration job, không đưa vào frontend. Có thể trùng `DATABASE_URL` ở môi trường đơn giản. |
    | `DATABASE_CHECKPOINTER_URL` | Có | Tùy chọn | Dashboard → **Connect**; để trống thì tiếp tục dùng `DATABASE_URL` như hiện tại. |
    | `P170_BOOTSTRAP_OWNER_USER_ID` | Không phải secret | Có một lần khi backfill | Dashboard → **Authentication → Users** sau khi tạo user owner đầu tiên; copy UUID của user. |
    | SMTP password/API key | Có | Có trước khi mở email auth production | Lấy tại Resend/SES/Postmark/SendGrid hoặc SMTP provider, rồi nhập trực tiếp tại Supabase **Authentication → SMTP Settings**. Không lưu trong repo; SMTP mặc định của Supabase chỉ phù hợp thử nghiệm: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). |
    | CAPTCHA site key/secret | Site key public, secret bí mật | Khuyến nghị nếu mở self-signup | Lấy từ Cloudflare Turnstile/hCaptcha; nhập secret tại Supabase **Authentication → Bot and Abuse Protection**, chỉ site key đi vào frontend: [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha). |

  - Không cần và không lấy `JWT_SECRET`: backend xác thực token bằng public JWKS. Trước integration phải kiểm tra project đang dùng asymmetric JWT Signing Key; JWKS ở `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` không phải secret.
  - Secret thật không cần để viết code/unit test. Tại checkpoint integration, chủ dự án tự điền chúng vào `.env`, `frontend/.env.local` và secret manager của môi trường deploy; không gửi `SUPABASE_SECRET_KEY`, database password hoặc SMTP password qua chat, email hay commit.
  - Cấu hình Supabase **Authentication → URL Configuration** với `http://localhost:3000/**`, production Site URL và callback/reset URL chính xác; production không dùng wildcard rộng. Tham khảo [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

[ ] 3. Tạo versioned database migration và mô hình tenant/actor có thể backfill dữ liệu cũ.

  - Bổ sung Alembic (`alembic.ini`, `backend/migrations/`) làm nguồn migration versioned cho SQLAlchemy Core; production chạy `alembic upgrade head` như release job và không còn dựa vào `metadata.create_all()`/migration ad-hoc khi FastAPI start. Local/test có thể bootstrap qua migration fixture.
  - Tạo các bảng:
    - `user_profiles(user_id uuid primary key references auth.users(id) on delete cascade, display_name, created_at, updated_at)`; không sao chép password/token.
    - `workspaces(id uuid primary key, name, slug, created_by_user_id, created_at, updated_at)`.
    - `workspace_memberships(workspace_id, user_id, role, status, created_at, updated_at)` với unique `(workspace_id, user_id)`, index `(user_id, status)` và enum/check constraint cho role/status.
    - `workspace_invitations(id, workspace_id, normalized_email, role, token_hash, expires_at, invited_by_user_id, accepted_by_user_id, status, created_at)`; chỉ lưu hash của invite token và unique invitation còn active.
  - Tạo Published Report domain để viewer có artifact ổn định thay vì xem trực tiếp profile/execution nội bộ:
    - `reports(id, workspace_id, title, slug, status, created_by_user_id, current_published_version_id, created_at, updated_at)`; status cấp report là `draft`, `in_review`, `published`, `archived`.
    - `report_versions(id, report_id, version, status, executive_summary, scope, time_range, submitted_by_user_id, submitted_at, reviewed_by_user_id, reviewed_at, published_by_user_id, published_at, created_at)`; status version là `draft`, `in_review`, `changes_requested`, `approved`, `published`, `rejected`, unique `(report_id, version)`.
    - `report_sections(id, report_version_id, position, kind, title, content_json)` cho narrative, methodology, findings, limitations và recommendations; validate schema theo `kind`.
    - `report_visualizations(id, report_version_id, position, chart_type, title, visualization_spec, query_execution_id, result_hash, result_snapshot, created_at)`; `chart_type` allowlist `kpi`, `bar`, `line`, `table`, không nhận JavaScript/SQL tùy ý.
    - `report_reviews(id, report_version_id, reviewer_user_id, decision, comment, created_at)` cho `approved`, `changes_requested`, `rejected`; giữ đầy đủ lịch sử, không overwrite review cũ.
  - Ràng buộc report version đã `published` là immutable. Khi cần cập nhật dữ liệu/narrative, clone thành draft version mới; viewer cũ vẫn truy được version đã publish cùng `query_execution_id` và `result_hash` làm evidence.
  - Dashboard theo role trong bản đầu là read model/API tổng hợp từ report, profile, analysis và audit tables, không cần bảng dashboard builder. Chỉ thêm persisted dashboard/widget model khi có yêu cầu pin/reorder chart độc lập với report.
  - Thêm `workspace_id` và actor UUID vào các aggregate root cần scope nhanh: `datasets`, `profile_runs`, `analysis_sessions`, `audit_events`; thêm index kết hợp workspace với id/thời gian/trạng thái.
  - Chuyển attribution text hiện có sang UUID có foreign key khi phù hợp: proposal `confirmed_by_user_id`, statistical test `requested_by_user_id`, semantic context `approved_by_user_id`, quality issue `acknowledged_by_user_id`, query execution `created_by_user_id`. Có thể giữ text snapshot nullable một migration để audit cũ không mất dữ liệu.
  - Thêm `workspace_id nullable` cho `retrieval_documents`: external knowledge dùng `NULL` và là corpus global read-only; profile report bắt buộc có workspace. Không cho profile retrieval query thấy document của workspace khác.
  - Backfill theo migration hai pha:
    1. Tạo cột nullable và một `legacy` workspace, chạy script `scripts/backfill_authz.py --owner-user-id <P170_BOOTSTRAP_OWNER_USER_ID>` để tạo membership owner và gắn toàn bộ dữ liệu hiện có.
    2. Chạy validator tìm orphan/cross-workspace reference, sau đó mới đặt `NOT NULL`, foreign key và unique/index constraints.
  - Enable RLS trên mọi bảng trong schema exposed. Vì browser không truy cập domain data trực tiếp, policy mặc định là deny cho `anon`/`authenticated`; FastAPI dùng database connection/secret key có quyền cao và bắt buộc thực thi tenant filter trong application. Secret/service key có thể bypass RLS nên RLS không thay thế authorization của backend: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
  - Giữ Storage bucket `p170-dataset` ở trạng thái private và không tạo policy upload/read trực tiếp cho browser. Mọi object operation tiếp tục qua FastAPI sau authorization.

[ ] 4. Thay bearer token dùng chung bằng authentication dependency xác thực Supabase JWT ở FastAPI.

  - Tạo `backend/src/services/auth.py` với `AuthContext(user_id, email, session_id, aal, raw_claims)` và JWT verifier dùng `PyJWT[crypto]`/`PyJWKClient` hoặc thư viện chuẩn tương đương.
  - Chỉ chấp nhận algorithm bất đối xứng allowlist (`ES256`/`RS256` theo key của project), verify signature, `kid`, `exp`, `nbf`, issuer, audience `authenticated`, `role=authenticated` và `sub` là UUID. Không decode-unverified cho authorization, không chấp nhận `alg=none`, không fallback sang JWT secret.
  - Cache public JWKS có TTL tối đa phù hợp cache rotation của Supabase; khi gặp `kid` mới thì refresh một lần, sau đó fail-closed. Supabase công bố JWKS endpoint và lưu ý về cache/key rotation tại [Verifying a Supabase JWT](https://supabase.com/docs/guides/auth/jwts#verifying-a-jwt-from-supabase).
  - Tạo `backend/src/api/dependencies.py` với `get_current_user`, `get_current_workspace` và `require_permission(...)`; membership phải được đọc từ database ở mỗi request hoặc cache rất ngắn có version/invalidation. Không nhét toàn bộ workspace role vào JWT vì một user có thể thuộc nhiều workspace và role change cần có hiệu lực ngay.
  - Thay `require_token` trong `routes.py` và `analysis_routes.py`; rate limiter dùng `AuthContext.user_id` thay vì prefix token. Không log access/refresh token, Authorization header, invite token hoặc password; audit chỉ lưu actor UUID, workspace UUID, action, resource id, outcome và correlation id.
  - Production startup kiểm tra `AUTH_MODE=supabase`, Supabase URL/audience và JWKS có key; cấu hình sai phải làm health readiness fail. `/health` chỉ trả trạng thái tối thiểu, không lộ issuer/key/config chi tiết.
  - `AUTH_MODE=dual` chỉ tồn tại trong rollout: API token cũ được map cố định vào bootstrap owner/workspace và ghi audit warning. Không cho anonymous fallback ở production.

[ ] 5. Refactor repository, API contract và agent boundary để authorization không thể bị bỏ sót.

  - Mọi repository method đọc/ghi domain data phải nhận `workspace_id` hoặc một `RequestScope`; thêm tenant predicate ngay trong SQL thay vì lấy object theo id rồi kiểm tra sau. Các method nội bộ dùng cho job phải có tên rõ `*_system` và không được gọi từ request route.
  - Sửa `Repository` và `AnalysisRepository` cho các đường dẫn hiện có: dataset list/get/delete, profile get/export/report/review/test/drift, Q&A thường/SSE, audit/status, analysis session/context/gate/issue/execution. Nested resource phải được kiểm tra cùng `workspace_id` và parent id trong một query.
  - Đổi upload/profile contract để loại IDOR qua `dataset_ref`:
    - `POST /datasets/upload` tạo ngay row `datasets` với workspace/creator, lưu object, trả `dataset_id` và metadata an toàn; không trả local path/object path nếu frontend không cần.
    - `POST /profile` nhận `dataset_id`; backend authorize dataset rồi tự resolve `source_ref`. `dataset_ref` chỉ được giữ tạm cho test/local compatibility và bị cấm trong production.
  - Với drift, cả current run và baseline run phải thuộc cùng workspace. Với Analysis Session, source profile phải thuộc workspace và mọi helper như `_session_or_404` phải nhận request scope.
  - Trước khi gọi LangGraph Q&A/profiling, authorize `profile_run_id`; truyền actor/workspace vào graph state/tool context và không cho tool nhận arbitrary run/thread id ngoài scope. Checkpoint thread id chỉ được dựng server-side sau khi resource đã được authorize.
  - Thêm Report API và enforce state machine/permission trong service, không cho route tự đổi status tùy ý:
    - Viewer/common: `GET /api/v1/reports?status=published`, `GET /reports/{report_id}`, `GET /reports/{report_id}/versions/{version_id}`, `GET /reports/{report_id}/export` và `POST /reports/{report_id}/qa`; chỉ resolve published version trong workspace.
    - Analyst: `POST /reports`, `POST /reports/{id}/versions`, `PATCH /report-versions/{id}`, CRUD section/visualization và `POST /report-versions/{id}/submit`; visualization chỉ tham chiếu execution thuộc cùng workspace/context và server tự copy `result_hash`/snapshot.
    - Admin/owner: `POST /report-versions/{id}/reviews`, `POST /report-versions/{id}/publish`, `POST /reports/{id}/archive`; kiểm tra separation of duties, transition hợp lệ và ghi audit.
    - Published report response chỉ chứa aggregate snapshot, public source metadata, limitation và evidence ids an toàn; không trả raw rows, query path, local path, vector hoặc internal prompt.
  - Thêm read-model API phục vụ dashboard mà không để frontend tải toàn bộ bảng rồi tự tổng hợp:
    - `GET /api/v1/dashboard` trả discriminated payload theo role hiện tại: viewer report feed/KPI, analyst work queue, admin/owner operational overview.
    - `GET /api/v1/analyst/work-queue` trả pending proposal, failed/running profile, blocked/warning gate, unfinished analysis và draft/in-review report của actor/workspace.
    - `GET /api/v1/admin/overview` trả counts/trend tổng hợp; `GET /admin/activity`, `/admin/review-queue`, `/admin/governance` và `/admin/members` yêu cầu permission tương ứng, có pagination/time range và không trả raw data.
  - Report Q&A của viewer dùng retrieval scope `(workspace_id, report_id, published_version_id)` và chỉ công bố câu trả lời có citation tới published section/visualization/evidence. Profile Q&A hiện tại chỉ dành analyst trở lên và vẫn authorize `profile_run_id` trước khi vào graph.
  - Thêm API quản lý identity/workspace:
    - `GET /api/v1/me` trả profile, memberships, active/default workspace và effective permissions.
    - `POST /api/v1/me/bootstrap` idempotent tạo user profile/personal workspace khi policy cho phép.
    - `GET/POST /api/v1/workspaces`, `GET /workspaces/{id}/members`.
    - `POST/DELETE /workspaces/{id}/invitations`, `POST /invitations/{token}/accept`.
    - `PATCH/DELETE /workspaces/{id}/members/{user_id}` với invariant owner cuối cùng và target-role rule: admin chỉ quản lý viewer/analyst; owner mới quản lý admin/ownership.
  - Backend invite flow tạo opaque token, chỉ lưu hash/expiry, rồi dùng Supabase Auth Admin `invite_user_by_email` bằng `SUPABASE_SECRET_KEY`; callback sau đăng nhập gọi endpoint accept invitation. Không đặt role/workspace từ query string hoặc `user_metadata` do client sửa được.
  - Thay actor nhập tay trên UI/API (`analyst@local`, `Analyst`, form `confirmed_by`) bằng actor từ JWT và display name từ `/me`; cập nhật Pydantic/TypeScript contract và OpenAPI.

[ ] 6. Scope Supabase Storage, retrieval, audit và lifecycle theo workspace.

  - Đổi object key thành `workspaces/{workspace_id}/datasets/{dataset_id}/{upload_id}-{safe_filename}`. Backend tự dựng key; không tin bucket/object path do client gửi.
  - Sửa `storage.py` dùng `SUPABASE_SECRET_KEY` backend-only, validate bucket/prefix, và chỉ download/delete sau khi repository xác nhận dataset thuộc request workspace. Xóa dataset phải ghi audit trước/sau và xử lý nhất quán khi Storage delete lỗi.
  - Bổ sung workspace metadata khi index profile report; retrieval query cho profile dùng `(workspace_id, profile_run_id)`, còn external knowledge chỉ lấy rows `workspace_id IS NULL`. Không để BM25/dense candidate set trộn profile của tenant khác trước ranking.
  - Khi publish report, index một document riêng mang `knowledge_type=published_report`, `workspace_id`, `report_id` và `report_version_id`; viewer Q&A không được retrieve draft, profile report nội bộ hoặc published report của workspace khác.
  - Export PDF/JSON của published report được render từ immutable version/result snapshot. Nếu cache artifact trong Storage, dùng prefix `workspaces/{workspace_id}/reports/{report_id}/versions/{version_id}/` và signed URL ngắn hạn chỉ sau authorization; không dùng bucket public.
  - Gắn `workspace_id`, `actor_user_id` và resource id thành cột queryable trong audit thay vì chỉ nằm trong JSON; `/audit` chỉ trả workspace hiện tại và yêu cầu `admin` trở lên.
  - Ghi audit cho `report_created`, `report_submitted`, `report_changes_requested`, `report_published`, `report_archived`, member/role change và owner override. Admin activity dashboard đọc các event đã chuẩn hóa thay vì parse narrative log tự do.
  - Khi user bị remove/suspend khỏi workspace, request kế tiếp mất quyền ngay; session Supabase có thể vẫn hợp lệ nhưng membership check phải chặn. Khi workspace bị khóa, mọi compute/Storage/job mới bị từ chối, còn dữ liệu không bị xóa tự động.

[ ] 7. Xây một frontend role-aware gồm Viewer Portal, Analyst Workspace và Admin Console trên codebase Next.js hiện tại.

  - Không tạo frontend/build riêng theo role. Tổ chức một application với route group và layout dùng chung:
    - `(auth)`: `/login`, `/signup` khi được bật, `/forgot-password`, `/auth/confirm`, `/auth/callback`, `/account/update-password`; không render `AppShell`.
    - `(protected)`: server layout verify claims, load `/api/v1/me`, workspace membership và effective permissions; unauthenticated redirect tới login với safe relative `next`.
    - Common: `/dashboard`, `/reports`, `/reports/{reportId}`, `/account`, `/guide`.
    - Analyst Workspace: giữ các route hiện tại `/chat`, `/datasets`, `/profiles/*`, `/analyses/*`, `/compare`; thêm `/reports/new`, `/reports/{id}/edit`, `/reports/{id}/review-status`.
    - Admin Console: `/admin/overview`, `/admin/activity`, `/admin/review-queue`, `/admin/governance`, `/admin/members`, `/admin/audit`.
    - Owner Settings: `/settings/workspace`, `/settings/security`, `/settings/ownership`; owner vẫn dùng Admin Console cho phần vận hành.
  - Thêm `@supabase/supabase-js` và `@supabase/ssr`; tạo browser/server clients và refresh-cookie helper. Với Next.js 15 dùng `frontend/src/middleware.ts`; server dùng `getClaims()` để bảo vệ page, `getSession()` chỉ để lấy token cần forward. Tham khảo [Supabase SSR client](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework).
  - Tạo frontend permission layer tập trung, ví dụ `frontend/src/lib/auth/permissions.ts`, `route-access.ts`, `use-can.ts` và component `Can`. `AppShell`, command/action và route guard đọc permission identifiers từ `/me`; không hard-code so sánh role ở từng page. Backend vẫn kiểm tra lại mọi request.
  - Refactor `frontend/src/lib/api.ts` để gắn `Authorization: Bearer <access_token>` và `X-Workspace-Id` cho mọi fetch, SSE, XHR upload, export/download và Next report route. Khi `401`, refresh và retry đúng một lần; khi `403` hiển thị insufficient-permission; khi đổi workspace/logout thì hủy inflight request, clear TanStack Query cache và reset role-specific state.
  - Đổi `AppShell` thành navigation theo capability:
    - Tất cả role: Dashboard, Báo cáo, Hướng dẫn, Account, workspace switcher và sign-out.
    - Analyst trở lên: Chat, Bộ dữ liệu, Profiling, Phân tích, Drift và Draft reports.
    - Admin/owner: mục Quản trị với Overview, Review queue, Activity, Governance, Members và Audit.
    - Owner: thêm Workspace/Security/Ownership settings.
  - Xây `/dashboard` như role-aware landing page, không phải một page chung nhồi mọi dữ liệu:
    - Viewer landing hiển thị published report feed, report mới/cập nhật, KPI cards được chọn từ current published versions và cảnh báo freshness/approximate/limitation.
    - Analyst landing là work queue: profile running/failed, proposal pending, quality gate blocked/warning, unfinished analysis, draft cần hoàn thiện, report bị yêu cầu sửa và report đang chờ review.
    - Admin/owner landing là operational overview: active datasets/profiles/analyses, pending review, failed jobs, quality risks, report publication trend, recent analyst activity, pending invitation và security/governance alerts.
    - Response dashboard có `kind=viewer|analyst|admin` để TypeScript render discriminated component; admin vẫn có thể mở Analyst Workspace qua navigation.
  - Xây Viewer Portal tại `/reports` và `/reports/{id}`:
    - Chỉ list version `published`; viewer không nhìn thấy draft/in-review/archived nội bộ, dataset/profile ids hoặc analyst work queue.
    - Report detail gồm title, executive summary, scope/time range, freshness, KPI, chart/table, narrative, methodology, limitations, approximate badge, published version/time/author và evidence/source drawer.
    - Q&A phải có report context cố định và hiển thị citation theo published evidence; không cho viewer chuyển sang arbitrary profile run.
    - Export chỉ gồm PDF/JSON/aggregate đã publish và mask; lỗi report bị archive/thu hồi có trang trạng thái rõ ràng.
    - MVP render snapshot bất biến, chưa cho viewer tùy ý đổi dimension/filter; safe interactive filters chỉ thêm sau khi có query-template allowlist và audit.
  - Nâng Analyst Workspace từ tập trang rời thành workflow liên tục:
    - Mỗi work item có next action rõ: tiếp tục profile, review proposal, xử lý quality gate, chạy analysis, lưu insight hoặc mở draft report.
    - Thêm Report Builder cho analyst chọn bounded execution đã lưu, tạo KPI/bar/line/table bằng visualization spec allowlist, viết narrative/limitation, sắp xếp section, preview đúng giao diện viewer và submit review.
    - Không cho nhập SQL, JavaScript chart formatter, local path hoặc chỉnh `result_hash`; backend resolve execution và đóng dấu evidence.
    - Hiển thị trạng thái `draft`, `in_review`, `changes_requested`, `published`, review comments và lịch sử version; report đã publish chỉ đọc, chỉnh sửa tạo version mới.
  - Xây Admin Console theo nhu cầu giám sát và kiểm duyệt, không phải bản sao analyst dashboard:
    - Overview: counts/trends theo time range cho dataset/profile/analysis/report; failure rate/duration, pending backlog, approximate/sample usage và quality gate severity.
    - Activity: timeline và aggregate theo analyst cho upload, profile, review, analysis, submit/publish; filter theo actor/action/resource/time, pagination và link về resource được phép.
    - Review queue: preview report giống viewer, kiểm tra evidence/limitation, comment, request changes, approve/publish; chặn self-approval theo policy và yêu cầu lý do khi owner override.
    - Governance: PII/proposal/quality/drift warnings ở mức metadata/aggregate; không hiển thị raw row.
    - Members: invite, resend/revoke invite, đổi/suspend/remove viewer hoặc analyst cho admin; chỉ owner được promote/demote admin và transfer ownership. UI bảo vệ owner cuối cùng và giải thích impact trước thao tác.
    - Audit: immutable event feed với actor, action, resource, outcome, timestamp/correlation id; không hiển thị secret/token/prompt raw.
  - Xây Owner Settings dùng chung component với Admin Console nhưng chỉ owner truy cập: workspace name/policy, invite-only/self-signup flag, report approval policy, MFA requirement status, owner transfer và lifecycle. UI chỉ hiển thị trạng thái secret/integration, không bao giờ trả giá trị secret.
  - Tạo reusable report components thay vì page-specific chart code: `ReportRenderer`, `KpiCard`, `ChartRenderer`, `EvidenceDrawer`, `ApproximationBadge`, `ReportStatus`, `ReviewPanel`. Chart renderer chỉ nhận typed visualization spec và aggregate snapshot; cùng renderer dùng cho analyst preview, admin review và viewer detail để tránh lệch hiển thị.
  - Namespace `chat-history.ts` theo `{user_id}:{workspace_id}`, sanitize redirect, đặt auth/dynamic response `no-store`, bảo đảm keyboard/focus/empty/loading/error states và responsive layout. UI hide/disable action chỉ là UX; security control luôn ở FastAPI.

[ ] 8. Bổ sung test matrix có hai user/hai workspace và kiểm tra mọi đường IDOR.

  - Backend unit test: token hợp lệ, expired, wrong issuer/audience/role, malformed `sub`, unsupported algorithm, unknown/rotated `kid`, JWKS timeout/cache, thiếu token và không log token. Dùng local JWKS fixture/dependency override nên CI không cần Supabase secret.
  - Authorization test: mỗi role theo permission matrix; user A không list/get/export/delete/review/test/drift/QA/stream hoặc tạo analysis từ resource user B; baseline drift và nested analysis id không được vượt workspace; owner cuối cùng không thể bị remove/demote.
  - Report workflow test: analyst tạo/sửa/submit được nhưng không publish; viewer chỉ thấy current published version; admin khác actor approve/publish được; self-approval, invalid transition, sửa published version, gắn execution khác workspace hoặc giả `result_hash` đều bị chặn.
  - Dashboard contract test: viewer payload không chứa dataset/profile/draft/activity; analyst work queue chỉ chứa workspace hiện tại; admin metrics khớp dữ liệu nguồn và không leak raw rows/PII; role change có hiệu lực ở request kế tiếp.
  - Repository test phải chứng minh tenant predicate có trong list/get/update/delete, kể cả negative case id tồn tại ở workspace khác. Test upload/profile contract mới không nhận arbitrary `dataset_ref` ở production.
  - Storage/retrieval test: object prefix đúng workspace, delete chéo tenant bị chặn trước khi gọi Supabase, external knowledge vẫn global nhưng profile document không leak qua candidate retrieval.
  - Frontend Vitest: auth redirect, safe `next`, token/workspace header injection, single refresh retry, logout/cache cleanup, workspace switch, permission-derived navigation, dashboard discriminated rendering, SSE/XHR/report route đều forward token.
  - Component test dùng cùng fixture cho analyst preview/admin review/viewer report để `ReportRenderer` cho kết quả nhất quán; test visualization spec lạ bị từ chối, approximation/limitation/evidence luôn hiện khi có.
  - Playwright/staging: signup hoặc invite → email confirm → login → refresh/reload → reset password → logout; hai browser contexts xác minh isolation; viewer không truy cập analyst/admin URLs; analyst tạo và submit report; admin review/publish; viewer thấy đúng published version; expired invite/reset link có UX rõ.
  - Integration RLS: dùng publishable key với anonymous/authenticated session thử đọc domain tables trực tiếp và phải bị deny; dùng backend route đúng token phải thành công. Secret scanning/build inspection phải xác nhận `SUPABASE_SECRET_KEY`, DB password và refresh/access token không xuất hiện trong frontend bundle/log.
  - Chạy quality gate hiện có sau thay đổi: `pytest -q`; trong `frontend/` chạy `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, sau đó `pnpm test:e2e` với Supabase test project/local stack.

[ ] 9. Rollout theo pha, có backfill checkpoint, quan sát và rollback không mất dữ liệu.

  - Pha 0: backup database/Storage inventory, tạo Supabase test/staging project, bật asymmetric signing key, cấu hình Site URL/redirect/email template và tạo owner Auth user đầu tiên.
  - Pha 1: deploy additive migration nullable + bảng workspace, chạy backfill/validator và kiểm tra số lượng dataset/profile/analysis/retrieval/audit trước-sau; chưa bật auth bắt buộc.
  - Pha 2: deploy backend/frontend auth và tenant scope ở `AUTH_MODE=dual`, map legacy token vào legacy workspace, mời test users, chạy toàn bộ cross-tenant test và theo dõi `401/403/404`, JWKS/invite/Storage error theo correlation id.
  - Pha 3: bật Analyst Workspace role-aware và Report Builder cho nhóm pilot; tạo một số report draft từ execution hiện có, review evidence/result hash và chỉ sau đó mở publish workflow.
  - Pha 4: mở Admin Console/review queue, publish các version đầu tiên rồi bật Viewer Portal cho viewer pilot; xác minh viewer không còn đường tới dataset/profile/draft trước khi mời rộng hơn.
  - Pha 5: bật `AUTH_MODE=supabase`, `AUTH_ALLOW_SIGNUP=false` production, ép migration constraints, xóa `API_TOKEN` khỏi frontend report proxy/deployment và thu hồi legacy service-role key sau khi xác nhận không còn lượt dùng.
  - Rollback chỉ đổi app về `dual`/release trước và giữ nguyên cột workspace/backfill; không drop auth tables/cột hoặc xóa membership trong rollback khẩn cấp. Legacy path vẫn phải map vào một workspace, tuyệt đối không quay lại unscoped query.
  - Rotation runbook: tạo secret key mới riêng cho backend, deploy song song, xác minh, rồi revoke key cũ; JWT signing key rotation phải chờ JWKS cache hội tụ và test `kid` mới trước revoke.
  - Acceptance criteria:
    - Người chưa đăng nhập không truy cập domain UI/API; session refresh/reload không làm mất đăng nhập bất thường.
    - User không thể đọc/sửa/xóa bất kỳ resource nào ngoài workspace membership, kể cả biết chính xác ID/path.
    - Role matrix được enforce ở backend; mọi actor/audit attribution lấy từ verified JWT.
    - Viewer chỉ thấy published report; analyst hoàn tất luồng evidence → draft → submit; admin hoàn tất review → publish và không tự duyệt version do chính mình tạo khi policy đang bật.
    - Cùng một report version render nhất quán ở analyst preview, admin review và viewer detail; version đã publish bất biến và truy nguyên được tới execution/result hash.
    - Admin dashboard phản ánh activity/work queue/governance đúng workspace mà không trả raw rows hoặc dữ liệu của workspace khác.
    - Browser bundle/network không chứa backend secret; FastAPI không cần `JWT_SECRET` để verify access token.
    - Dữ liệu legacy thuộc bootstrap workspace đầy đủ, không orphan và mọi test hiện có sau khi cập nhật fixture vẫn pass.

[ ] 10. Cập nhật tài liệu vận hành và handoff sau khi implementation hoàn tất.

  - Cập nhật `README.md`, `docs/summary.md`, `.env.example`, `frontend/.env.local.example`, `config.yaml` và OpenAPI với auth flow, role matrix, workspace header, migration commands, local/staging setup và troubleshooting `401/403`.
  - Viết product guide riêng cho Viewer Portal, Analyst Workspace, Admin Console, report lifecycle và meaning của từng status/permission; screenshot/route map phải khớp một frontend role-aware, không mô tả như bốn ứng dụng độc lập.
  - Viết runbook riêng cho tạo owner đầu tiên, invite user, đổi role, khóa/removal user, rotate API/JWT signing key, khôi phục khi SMTP/JWKS/Supabase Auth gián đoạn và kiểm tra audit.
  - Ghi rõ secret placement cho local, CI, backend deploy và frontend deploy; thêm CI secret scan và rule cấm biến `NEXT_PUBLIC_*SECRET*`.
  - Sau rollout, cập nhật giới hạn dự án: chat memory vẫn local, authorization ở mức workspace, viewer report là snapshot chưa có arbitrary filter, direct browser domain access bị deny, MFA/social login chưa bật nếu chưa được chọn trong Open questions.

## Open questions

- Production sẽ invite-only (khuyến nghị cho dữ liệu nhạy cảm) hay cho phép self-signup sau email confirmation/CAPTCHA?
- Có giữ policy mặc định analyst không self-publish và admin không self-approve version do mình tạo (khuyến nghị), hay cho phép workspace owner tắt separation of duties?
- Có bắt buộc MFA/AAL2 cho `owner`/`admin` ngay lần triển khai này không, hay đưa vào hardening phase sau khi email/password ổn định?
