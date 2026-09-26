# Kế hoạch thiết kế lại giao diện VDaAgent

**Trạng thái:** Chỉ lập kế hoạch, chưa triển khai. **Ngày rà soát:** 2026-09-26. Tài liệu này dựa trên mã nguồn hiện có; chưa phải kết quả kiểm thử trực quan trên một phiên đăng nhập thật. Phạm vi triển khai sau này chỉ gồm giao diện và tương tác. Giữ nguyên logic nghiệp vụ, API, quyền truy cập, dữ liệu phân tích, nguồn bằng chứng và các route đang hoạt động.

> Implementation update: the `agent-v1` runtime/workspace extension is documented
> in [agent-runtime-upgrade.md](agent-runtime-upgrade.md), including tests and
> migration requirements. This UI plan remains the original design baseline.

## 1. Kiểm kê giao diện hiện tại

### Kiến trúc frontend

| Hạng mục | Hiện trạng trong mã nguồn | Hệ quả cho thiết kế |
| --- | --- | --- |
| Nền tảng | `src/frontend` dùng Next.js 16.3.5 App Router, React 19.3, TypeScript; chạy trong monorepo pnpm. Các `app/**/page.tsx` chuyển sang `src/frontend/src/features/workspace/workspace.tsx`. | Giữ cấu trúc route và luồng khởi tạo phiên; thay đổi theo từng bề mặt thay vì viết lại ứng dụng. |
| Route | `src/frontend/src/components/shell/routes.ts` định nghĩa `/workspace`, `/chat`, `/chat/[conversationId]`, `/runs`, `/runs/[runId]`, `/reports`, `/reports/[reportId]`, `/data/imports`, `/automations`; `/` chuyển hướng tới workspace. | Không đặt tên route mới cho những màn hình chưa có. Chi tiết run dùng bề mặt phân tích; chi tiết report dùng bề mặt báo cáo. |
| Vỏ ứng dụng | `components/shell/app-shell.tsx` chứa sidebar, điều hướng, chọn tổ chức, thông tin tài khoản, topbar, skip link và hộp thoại điều hướng di động. `features/workspace/workspace.tsx` giữ trạng thái route, phiên, quyền và lựa chọn nội dung. | Giữ nguyên phạm vi tổ chức, quyền owner/analyst/viewer, deep link và hành vi bàn phím. |
| Không gian chính | `features/grok-workspace/components/grok-workspace.tsx` ghép thanh ngữ cảnh, cuộc hội thoại và inspector. `features/agent-chat/agent-chat.tsx` là giao diện dự phòng, dùng chung phần điều khiển chat. Cờ `grok_workspace_enabled` quyết định giao diện chính. | Ưu tiên Grok Workspace nhưng hai giao diện còn truy cập được phải nhất quán. |
| Dữ liệu và báo cáo | Dashboard tại `features/workspace/dashboard/`; báo cáo tại `features/reports/`; biểu đồ tại `components/visualization/chart-renderer.tsx`; bằng chứng tại `features/evidence/`. | Số liệu, đơn vị, chú giải, liên kết nguồn, in và xuất báo cáo phải luôn là nội dung chính. |
| CSS | `app/globals.css` nhập Tailwind CSS 4, song hệ thống thực tế dựa chủ yếu vào biến CSS trong `styles/tokens.css`, CSS toàn cục trong `legacy-components.css`, `theme-overrides.css`, `contextual-workspace.css`, cùng CSS module theo tính năng. Có `scripts/check-design-tokens.mjs`. | Mở rộng token và module sẵn có; kiểm kê thứ tự cascade trước khi đổi màu diện rộng. |
| Theme | `app/layout.tsx` gắn `data-theme="sakura-signal"`; `styles/tokens.css` đặt `color-scheme: light`; chưa thấy bộ chuyển dark/light cho người dùng. | Cần một dark theme mặc định hoàn chỉnh, gồm trình duyệt, biểu mẫu, tooltip, biểu đồ và bản in. Bộ chuyển theme là việc tùy chọn về sau. |
| Chữ và biểu tượng | `app/layout.tsx` dùng Be Vietnam Pro, Bricolage Grotesque, IBM Plex Mono qua `next/font`; biểu tượng dùng `lucide-react`. `components/agents/agent-identity.ts` đã gắn tên, màu nhấn và icon với các agent có thật. | Giữ bộ chữ hỗ trợ tiếng Việt và Lucide; chỉnh cấp bậc, cỡ chữ, độ dài dòng và căn số. |
| Hình ảnh | Runtime có `public/brand/mascot/navigator-hero.webp` và `navigator-avatar.webp`; nguồn và xuất xứ ở `brand/mascot/README.md`. Login và dashboard đã dùng VDa Navigator. `components/assistant/` có chín trạng thái kèm nhãn chữ. | Phát triển nhân vật hiện có làm trục nhận diện; thêm hình mới theo trạng thái sử dụng thật. |
| Chuyển động | `gsap` và `@gsap/react` **đã có** trong `src/frontend/package.json`. `components/motion/motion-reveal.tsx` dùng `useGSAP()`, `gsap.matchMedia()`, ref giới hạn phạm vi và cleanup cho dashboard. CSS có hover, focus, spinner và nhịp trạng thái mascot. Chưa thấy ScrollTrigger hoặc bộ điều khiển chuyển route. | Không cài GSAP trong việc này. Chỉ dùng thêm GSAP sau này nếu một chuỗi chuyển động phối hợp thực sự có ích. |
| Responsive | `theme-overrides.css` có mốc 1024/720/420px; Grok Workspace có mốc 1279/1024/720px và drawer dạng `<dialog>`. Có quy tắc tràn bảng và in. | Kiểm tra lại nhiều bề rộng; giữ focus, Escape, vùng chạm, bảng cuộn và bản in. |

`docs/PRODUCT.md` xác định sản phẩm là công cụ phân tích tồn kho bất động sản có thể truy vết từ dữ liệu đến báo cáo. `docs/DESIGN.md` hiện mô tả “Sakura Signal”: sidebar indigo, nền giấy ấm, điểm nhấn coral/aqua, nhân vật cel-shaded và vùng dữ liệu yên tĩnh. `docs/specs/multi-agent-workspace-redesign-spec.md`, `docs/plans/multi-agent-workspace-redesign-plan.md` và ảnh `docs/ui-reference/multi-agent-workspace.png` là ngữ cảnh thiết kế trước đó, không phải ảnh chụp trạng thái đang chạy.

### Hệ thống thiết kế cần giữ

- `styles/tokens.css` đã có màu ngữ nghĩa, sáu màu chuỗi biểu đồ, khoảng cách, ba bán kính chính, bóng, z-index, cỡ chữ, hai thời lượng và easing. Giữ cách gọi theo ngữ nghĩa thay vì viết mã màu rải rác.
- `components/ui/primitives.tsx` đã có button, badge, status, alert, panel, field, skeleton, tooltip và dialog/drawer. Giữ hành vi các phần tử này; chỉ bổ sung biến thể khi bố cục thật sự cần.
- `AppShell` đã có điều hướng dễ hiểu, skip link và hộp thoại di động; các trạng thái assistant đi kèm chữ và icon; biểu đồ dùng thêm hình dạng/đường nét ngoài màu; báo cáo có in/xuất. Đây là các điểm mạnh cần bảo toàn.
- Giữ tiếng Việt ngắn gọn, sự thật từ dữ liệu, nhãn trạng thái, chuỗi bằng chứng và cách phân quyền. Không biến các agent hoặc bước reviewer thành “nhân vật đang nói” nếu dữ liệu thực không có sự kiện đó.

### Vấn đề hiện tại

| Nhóm | Quan sát từ mã nguồn | Hướng xử lý |
| --- | --- | --- |
| Nhận diện | Canvas màu giấy và dark sidebar không đáp ứng hướng dark-first; mascot chủ yếu xuất hiện ở login/dashboard. | Chuyển thành studio đêm có chiều sâu vừa đủ, với VDa Navigator xuất hiện tại các thời điểm hữu ích. |
| Bố cục và phân cấp | Shell, tiêu đề, banner, rail, hội thoại, inspector và nhiều khung số liệu cùng tranh sự chú ý. Một số vùng được bọc card lồng nhau. | Chọn một vùng chính theo từng route; dùng khoảng trắng, đường phân cách và chữ thay cho khung không cần thiết. |
| Chữ | Bộ font phù hợp nhưng một số nhãn trong `legacy-components.css` rất nhỏ; các module có thang chữ không hoàn toàn thống nhất. | Chuẩn hóa cỡ nhãn tối thiểu, line-height, phân cấp tiêu đề và số liệu. |
| Màu | Token hiện được cân cho nền sáng; đổi nền mà không kiểm tra sẽ làm nhạt chữ phụ, viền, trạng thái và trục biểu đồ. | Thiết kế lại cặp foreground/background theo độ tương phản thực tế. |
| Thành phần | Primitive dùng chung tồn tại nhưng `Panel` luôn là card; global CSS và CSS theo tính năng cùng chi phối button/card. | Giảm xung đột cascade theo từng bề mặt; không tạo hệ thành phần thứ hai. |
| Minh họa | Mới có một chân dung nguồn, hai bản xuất; chưa đủ pose và trạng thái cho toàn sản phẩm. | Xây dựng bộ hình nhỏ, nhất quán, có quy tắc đặt và ẩn. |
| Chuyển động | Dashboard có hiệu ứng khi mount, song chưa có thứ bậc chuyển động hay cách chuyển trạng thái chung. | Chuẩn hóa token và chỉ thêm chuyển động phục vụ phản hồi, phân cấp hoặc dẫn hướng. |
| Nhất quán UX | Grok Workspace và Agent Chat dự phòng khác bố cục; nhiều breakpoint tồn tại song song. | Căn chỉnh trạng thái chọn, composer, inspector và drawer ở các độ rộng. |
| Accessibility | Có focus, skip link, nhãn trạng thái và reduced-motion; dark theme mới có thể làm chúng yếu đi. | Đo tương phản, kiểm tra bàn phím/screen reader và nhánh không chuyển động trên giao diện thật. |
| Hiệu năng | Báo cáo/biểu đồ nhiều nội dung, chat cập nhật liên tục và CSS global lớn; đây là nguy cơ cần đo, chưa phải lỗi đã xác nhận. | Giới hạn ảnh/animation và đo trên hội thoại dài, thiết bị di động. |

## 2. Hướng thị giác: “Mysterious Anime AI Platform”

Giao diện là một **studio phân tích về đêm**: indigo tối hơi nhuốm màu, ánh sáng mềm, nhịp bố cục biên tập, chữ rõ và nhân vật anime nguyên bản, dễ mến nhưng điềm tĩnh. Cảm giác bí ẩn đến từ độ sâu và cách hé lộ thông tin, không đến từ neon dày, viền phát sáng khắp nơi, nền hoạt họa ồn ào hay bảng điều khiển kiểu trò chơi. Nội dung phân tích vẫn giữ dáng vẻ của một phần mềm chuyên nghiệp.

### Dark theme và token

Phát triển `styles/tokens.css` theo thứ bậc: canvas tối có sắc indigo; navigation tối hơn; nền thứ cấp sáng lên một bậc; mặt phẳng chứa báo cáo/biểu đồ sáng hơn nữa; panel nổi có ranh giới và bóng rõ. Đường phân cách phải thấy được nhưng không đóng khung mọi hàng. Chữ chính gần trắng ấm, chữ phụ sáng vừa đủ, chữ muted chỉ cho metadata thật sự thứ yếu. Coral là hành động/chọn; aqua là tín hiệu hoạt động hoặc xác thực; amber/crimson giữ cảnh báo/lỗi. Ánh trăng xanh tím chỉ dùng rất ít ở hero, không thay màu ngữ nghĩa.

Cần token cho: nền chính/phụ/nâng/nổi/nav; chữ chính/phụ/muted/trên accent; viền nhẹ/mạnh; hành động, tín hiệu, semantic; biểu đồ/trục/lưới/tooltip; bóng, glow, opacity, blur; spacing, font, radius, z-index; duration và easing. Tái sử dụng tên `--color-*` nếu có thể; lập bảng ánh xạ khi đổi tên. Đồng bộ `color-scheme`, `viewport.themeColor` trong `app/layout.tsx`, control gốc của trình duyệt, selection, focus, màn hình loading/error và `@media print`. Không tạo công tắc light/dark khi chưa có yêu cầu sản phẩm; giữ bản màu sáng cũ làm tài liệu đối chiếu nếu cần.

Thời lượng chuyển động đề xuất theo vai trò: **instant** cho phản hồi tức thời; **fast** cho nút/tab; **normal** cho panel; **slow** cho nhóm reveal; **cinematic** chỉ cho khoảnh khắc hero. Easing gồm standard, entrance, exit, cinematic. CSS và GSAP nên dùng cùng định nghĩa, tránh mỗi module tự chọn một nhịp.

### Chữ và không khí

Giữ Be Vietnam Pro cho UI và báo cáo; Bricolage Grotesque cho tiêu đề; IBM Plex Mono cho ID, hash và mã. Dùng số tabular trong KPI, căn thẳng cột so sánh, độ dài dòng đọc được cho tiếng Việt. Tránh nhãn viết hoa quá nhỏ. Với nền, chỉ dùng **một** thủ pháp chính cho từng nơi: radial light/vignette rất nhẹ ở login hoặc hero dashboard; lớp màu tĩnh phía sau shell; một góc minh họa ở empty state. Báo cáo, bảng, đồ thị, form, inspector và đoạn hội thoại dài dùng nền phẳng. Grain, hạt, blur blob và parallax là thử nghiệm tùy chọn sau khi đo hiệu năng; không chồng tất cả cùng lúc.

## 3. Hệ thống nhân vật và tài sản ảnh

VDa Navigator là nhân vật chủ đạo. Giữ mô hình trạng thái trong `components/assistant/assistant-state.ts` và nhãn chữ tại `assistant-presence.tsx`: hình chỉ hỗ trợ ý nghĩa, không thay thế văn bản. Bộ ảnh tương lai nên có ít pose/biểu cảm cho chào mừng, chưa có dữ liệu/hội thoại, đang phân tích, báo cáo sẵn sàng và lỗi có thể phục hồi. Nhân vật trưởng thành, trang phục phù hợp công việc, cùng nét cel-shaded và bảng màu. `components/agents/agent-identity.ts` tiếp tục dùng icon/màu theo agent thật. Chân dung chuyên gia khác chỉ là **tùy chọn** khi có ích cho việc nhận diện một `AgentKey` có thật; không gợi ý hội thoại hoặc duyệt báo cáo chưa xảy ra.

| Mức hiện diện | Quy tắc | Ví dụ |
| --- | --- | --- |
| Chủ đạo | Một nhân vật lớn trong vùng giới thiệu ít dữ liệu. | Login, hero chào mừng dashboard. |
| Hỗ trợ | Chân dung/crop nhỏ, nằm ngoài cột đọc chính. | Empty chat, empty import, trạng thái báo cáo hoặc lỗi. |
| Phông nền | Silhouette rất nhẹ trong khoảng trống, trang trí và ẩn khỏi screen reader. | Mép workspace rộng khi inspector đóng. |
| Ẩn | Không đặt nhân vật khi dữ liệu hoặc màn hình hẹp cần toàn bộ diện tích. | Chart, bảng, bằng chứng, nội dung báo cáo, form nhập liệu, bản in. |

Đường dẫn đề xuất dưới `src/frontend/public/brand/`: `characters/navigator/`, `characters/specialists/` (tùy chọn), `illustrations/states/`, `backgrounds/`, `effects/`. Giữ file nguồn và nhật ký xuất xứ ở `src/frontend/brand/`, theo mẫu `brand/mascot/README.md`. Dùng AVIF/WebP cho bản phù hợp, PNG trong suốt khi cần; xuất crop desktop/mobile và avatar nhỏ; khai báo kích thước, dùng `next/image`, ưu tiên tải ảnh trong màn đầu và lazy-load phần còn lại. Mục tiêu hiện có: hero dưới khoảng 250 KB, ảnh nhỏ dưới 50 KB, trừ ngoại lệ đã đo. Ghi tác giả, quyền dùng, nguồn tham chiếu/prompt, vị trí sử dụng, alt hoặc tính trang trí. Không tải fan art hay hình nhân vật có bản quyền.

Hiện **không có route onboarding, settings hoặc help/docs**; minh họa cho chúng thuộc phạm vi tương lai. Imports và automations chỉ cần hình hỗ trợ empty/error nếu trạng thái đó có thật. Success phải có chữ và icon, không dựa vào nét mặt nhân vật.

## 4. Quy tắc và kiến trúc chuyển động

Chuyển động chỉ được giữ nếu làm rõ phân cấp, trạng thái, hướng chú ý, phản hồi, chiều sâu hoặc tính cách trợ lý. Không chặn nhập liệu, mở bằng chứng, đổi route hay xuất báo cáo.

| Cấp | Trường hợp | Công nghệ ưu tiên | Giới hạn |
| --- | --- | --- | --- |
| 1 — vi tương tác | Hover/press, focus, tab, toggle, tooltip, nút trong card. | CSS trong `styles/primitives.css` và CSS module. | Nhanh, ít dịch chuyển, dùng được bằng bàn phím; không chỉ dựa vào hover. |
| 2 — thành phần | Drawer, modal, inspector, mục mở rộng, tin nhắn mới, đổi trạng thái. | CSS cho một phần tử/thuộc tính; GSAP chỉ khi nhiều phần tử phải phối hợp. | `<dialog>` vẫn giữ Escape, focus và thứ tự thao tác; không phát lại hiệu ứng mỗi lần polling. |
| 3 — bố cục trang | Hero dashboard, nhóm số liệu đầu tiên, đổi chế độ workspace hiếm gặp. | `gsap.timeline()` trong component/hook có phạm vi; xem lại `MotionReveal`. | Nội dung hiện ngay và thao tác được; không fade toàn bộ route hoặc gây nháy hydration. |
| 4 — ambient | Mascot thở nhẹ, ánh sáng/lớp nền chậm. | CSS opacity/transform; GSAP nếu cần chuỗi nhiều lớp. | Tắt với reduced motion, màn hình nhỏ, tab ẩn và vùng đọc dày; giới hạn vòng lặp đồng thời. |

**Khuyến nghị GSAP:** giữ thư viện đã cài, dùng có chọn lọc cho timeline phối hợp và trạng thái cần đảo/cleanup; CSS đủ cho nút, focus, panel đơn giản và tín hiệu trạng thái. Đặt preset và helper tương lai trong `src/frontend/src/components/motion/`, không rải timeline vào nhiều page. Với React client component, dùng `@gsap/react`/`useGSAP()` cùng ref giới hạn, cleanup, `revertOnUpdate` khi phụ thuộc đổi, và `contextSafe` nếu thêm callback chạy muộn. Không truy cập DOM trong server render; chỉ đăng ký plugin ở client. `gsap.matchMedia()` kết hợp breakpoint và `prefers-reduced-motion`; nhánh giảm chuyển động phải hiển thị trạng thái cuối ngay lập tức.

ScrollTrigger **chưa cần** cho chat, report hoặc inspector có vùng cuộn riêng; không pin hay chiếm cuộn của người dùng. Chỉ đánh giá lại cho một trang hướng dẫn dài trong tương lai. Parallax, SVG motion, particle, vòng lặp nhân vật và chuyển route toàn màn hình đều là tùy chọn cần kiểm chứng. Tham khảo [GSAP React](https://gsap.com/resources/React/), [matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia%28%29/) và [ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/).

## 5. Kế hoạch theo route và bề mặt

Login/loading/error bên dưới là **trạng thái** của route hiện có, không phải URL mới.

| Bề mặt | Hiện tại | Hướng thiết kế | Anime | Chuyển động | Thành phần chính | Ưu tiên |
| --- | --- | --- | --- | --- | --- | --- |
| Login/loading/error | `auth/components/login.tsx`, `app/loading.tsx`, `app/error.tsx`; login/loading đã có mascot. | Cảnh giới thiệu tối, form rõ, lỗi có đường phục hồi. | Navigator lớn ở login, nhỏ ở trạng thái khác. | Một lần xuất hiện nhẹ; phản hồi CSS. | Login, assistant, token. | Bắt buộc P1 |
| `/workspace` | Hero, KPI, run/report/import/schedule gần đây tại `workspace/dashboard/`. | Hero có một hành động chính; dải vận hành và nội dung gần đây ít khung lặp hơn. | Navigator chủ đạo trong hero; ẩn cạnh số liệu. | Rà soát `MotionReveal`; một timeline nếu tăng khả năng định hướng. | Dashboard TSX/CSS module. | Bắt buộc P1 |
| `/chat`, `/chat/[conversationId]` | Grok Workspace ba cột và Agent Chat dự phòng; composer, tin nhắn lưu bền. | Hội thoại là tâm điểm; scope/trạng thái/bằng chứng dễ quét; rail và inspector yên tĩnh. | Avatar Navigator nhỏ, hình empty state nếu cần; không đặt sau tin nhắn. | CSS cho tin mới/trạng thái; GSAP chỉ cho chuyển chế độ phối hợp. | Grok modules, agent-chat modules, composer, thread. | Bắt buộc P1 |
| `/runs`, `/runs/[runId]` | Danh sách lịch sử hoặc bề mặt phân tích với DAG, task và bằng chứng. | Phân biệt rõ đang chạy/hoàn tất/lỗi, giữ DAG trung thực và mở nguồn trực tiếp. | Avatar trạng thái rất nhỏ nếu hữu ích. | Chỉ theo trạng thái đã lưu, không giả lập hoạt động agent. | History, run-progress, workflow-graph, inspector. | Bắt buộc P1 |
| `/reports`, `/reports/[reportId]` | Lịch sử hoặc báo cáo/biểu đồ với liên kết bằng chứng, CSV/JSON và in. | Mặt phẳng đọc ổn định; tiêu đề, số, chart, bảng và nguồn rõ. Giữ bản in nền sáng. | Ẩn trong nội dung; có thể có callout “sẵn sàng” nhỏ. | Phản hồi chọn bằng CSS, không che dữ liệu. | Report detail/dashboard, chart-renderer. | Bắt buộc P1 |
| `/data/imports` | `imports/components/imports-panel.tsx` quản lý snapshot CSV. | Yêu cầu tệp, tiến độ, kiểm tra và lịch sử nguồn rõ trên form tối. | Hình empty state hỗ trợ. | CSS cho upload/trạng thái. | Imports panel, field/alert. | Bắt buộc P2 |
| `/automations` | `schedules/components/schedules-panel.tsx` quản lý lịch báo cáo. | Trạng thái lịch, lần chạy kế tiếp, quyền và thao tác xóa tách bạch. | Hình empty state nhỏ. | CSS cho menu/toggle/trạng thái. | Schedules panel, status/dialog. | Bắt buộc P2 |
| Onboarding/help/settings | Chưa có route tương ứng. | Chỉ đề xuất sau khi kiểm chứng nhu cầu sản phẩm. | Có thể dùng tranh dẫn chuyện. | Xét ScrollTrigger nếu có bài dài phù hợp. | Công việc riêng. | Tùy chọn |

## 6. Bản đồ thành phần và file ảnh hưởng

| Đường dẫn | Vai trò hiện tại | Thay đổi dự kiến | Rủi ro |
| --- | --- | --- | --- |
| `src/frontend/src/styles/tokens.css` | Token màu, chữ, khoảng cách, biểu đồ. | Thêm phân cấp tối và token chuyển động/không khí. | Cao: mọi route. |
| `src/frontend/src/app/layout.tsx`, `styles/primitives.css`, `styles/theme-overrides.css` | Theme gốc, metadata, control, shell/surface toàn cục. | Dark-first, focus, selection, trạng thái và print. | Cao: tương phản, hydration, bản in. |
| `src/frontend/src/styles/legacy-components.css`, `styles/contextual-workspace.css` | CSS cũ và shell phân tích. | Kiểm kê selector; sửa tập trung, hợp nhất quy tắc trùng khi từng tính năng được chuyển. | Cao: xung đột cascade. |
| `src/frontend/src/components/shell/app-shell.tsx`, `components/shell/routes.ts` | Điều hướng, chọn tổ chức, dialog di động, tên route. | Đổi hình thức shell; giữ route và hành vi. | Cao: mọi luồng. |
| `src/frontend/src/components/ui/primitives.tsx` | Button, form, status, panel, tooltip, dialog. | Giữ logic; chỉ thêm ít biến thể hiển thị có lý do. | Trung bình. |
| `src/frontend/src/features/workspace/workspace.tsx`, `context.ts` | Phiên, quyền, route, lựa chọn nội dung. | Giữ logic; chỉ đổi phần bố cục nếu cần. | Cao: tenant/quyền. |
| `src/frontend/src/features/workspace/dashboard/*` | Tổng quan và reveal GSAP hiện có. | Hero, nhịp nội dung, responsive và chuyển động tiết chế. | Trung bình: LCP/bố cục. |
| `src/frontend/src/features/grok-workspace/components/*`, `features/agent-chat/*` | Workspace ba cột, chat, composer, DAG. | Màu, phân cấp, drawer, tin nhắn và trạng thái nhất quán. | Cao: màn hẹp/polling. |
| `src/frontend/src/features/reports/*`, `components/visualization/chart-renderer.tsx` | Báo cáo, chọn dữ liệu, biểu đồ/xuất. | Màu chart, tooltip, bảng, bản in và liên kết nguồn. | Cao: ý nghĩa dữ liệu. |
| `src/frontend/src/features/evidence/components/*` | Inspector, lineage, dialog bằng chứng. | Nền tối dễ đọc cho ID/JSON/link; focus rõ. | Cao: khả năng kiểm chứng. |
| `src/frontend/src/features/imports/components/imports-panel.tsx`, `features/schedules/components/schedules-panel.tsx` | Form và điều khiển dữ liệu/lịch. | Restyle form, trạng thái, empty/error. | Trung bình. |
| `src/frontend/src/components/assistant/*`, `components/agents/agent-identity.ts`, `public/brand/*`, `brand/mascot/README.md` | Nhân vật, trạng thái, asset và xuất xứ. | Bộ pose và quy tắc sử dụng; không đổi ý nghĩa workflow. | Trung bình: bản quyền/kích thước. |
| `src/frontend/src/components/motion/*`, `styles/motion.css` | Reveal GSAP và reduced-motion CSS. | Preset, cleanup và nhánh ít chuyển động. | Trung bình: nháy giao diện/hiệu năng. |
| `docs/DESIGN.md`, `docs/PRODUCT.md` | Hợp đồng thiết kế và sự thật sản phẩm. | Khi triển khai sau này, cập nhật thiết kế; giữ nguyên sự thật sản phẩm. | Thấp: tài liệu lệch mã. |

**Quyết định thành phần:** giữ `Button`, field, `Status`, `Dialog`/`Drawer`, `ChartRenderer`, `ReportDashboard`, thành phần evidence, `WorkspaceContext` và nhãn assistant. Restyle `AppShell`, dashboard, Grok panes, chat, history, form và report. Hợp nhất CSS trùng lặp từng phần; chỉ tách component nếu trách nhiệm độc lập hoặc file hiện tại gây khó kiểm tra. Card vẫn hợp lý khi nhóm một biểu đồ, bộ điều khiển hoặc bằng chứng; bỏ khung khi chỉ dùng để trang trí.

## 7. Giới hạn UX, accessibility và hiệu năng

- Kiểm tra cặp màu trên màn hình thật: chữ thường tối thiểu 4.5:1, chữ lớn và ranh giới điều khiển có ý nghĩa tối thiểu 3:1; gồm tooltip, biểu đồ, hover, disabled, focus, lỗi và trạng thái.
- Giữ skip link, heading/landmark, điều hướng bàn phím, focus nhìn rõ, Escape/trả focus của dialog, vùng chạm ít nhất 44px, thông báo trạng thái và nhãn text/icon bên cạnh màu. Ảnh trang trí dùng alt rỗng và ẩn khỏi screen reader; trạng thái quan trọng luôn bằng chữ.
- Tôn trọng `prefers-reduced-motion` trong CSS **và JavaScript**, kể cả lần vẽ đầu và khi người dùng đổi cài đặt. Không mã hóa thông tin chỉ bằng màu, chuyển động hoặc biểu cảm nhân vật.
- Báo cáo, chart, bảng, hội thoại dài, bằng chứng, ID và form ở trên bề mặt ổn định. Hiệu ứng nền biến mất trên màn hẹp và bản in. Giữ CSV/JSON/print và cách đọc run cũ.
- Không sửa API, tenant scope, quyền owner/analyst/viewer, số liệu, đơn vị, nguồn, provenance hoặc trạng thái đã lưu. Chuyển động theo dữ liệu thật; không tạo cảm giác agent đang làm việc khi không có sự kiện tương ứng.
- Ảnh có kích thước/format phù hợp và lazy-load; chỉ ưu tiên ảnh màn đầu. Đo LCP, CLS, độ trễ nhập và kích thước JS trước/sau; kiểm tra chat dài và GPU di động. Animate transform/opacity; tránh layout thrash, blur lớn, vòng lặp nhiều lớp và `will-change` thường trực. Cleanup GSAP khi unmount hoặc đổi route.

## 8. Quyết định dependency

| Thành phần | Nhu cầu | Thay thế sẵn có | Quyết định |
| --- | --- | --- | --- |
| `gsap`, `@gsap/react` | Timeline phối hợp và cleanup React. | CSS cho hiệu ứng đơn giản. | **Đã cài; giữ và dùng chọn lọc.** Không sửa package trong task này. |
| ScrollTrigger | Trang dẫn chuyện dài có thể cần sau này. | Cuộn gốc, CSS, IntersectionObserver. | **Chưa dùng** cho route hiện tại. |
| Tailwind CSS 4 | Đã được nhập trong global CSS. | Token CSS/module đang là hệ chính. | Không thêm framework khác. |
| `next/image` | Ảnh nhân vật responsive/lazy-load. | Đã dùng ở login/dashboard/assistant. | Tái sử dụng. |
| Bộ icon/animation/ảnh mới | Tăng sự đa dạng. | Lucide, CSS, GSAP và asset nội bộ. | Không thêm nếu chưa chứng minh được nhu cầu. |

## 9. Lộ trình triển khai sau này

1. **Giai đoạn 0 — nền tảng, bắt buộc:** chụp giao diện thật đã đăng nhập ở các route chính; kiểm kê màu cứng/cascade; chốt cặp token tối, tiêu chuẩn tương phản, art brief, ngân sách asset và nguyên tắc motion.
2. **Giai đoạn 1 — shell và primitive, bắt buộc:** đổi token, control, metadata, focus, semantic và print; restyle `AppShell`. Kiểm tra mọi route, chọn tổ chức và quyền trước khi tiếp tục.
3. **Giai đoạn 2 — luồng sản phẩm, bắt buộc:** làm `/workspace`, Grok chat/run detail, report, chart/evidence trước; sau đó imports, automations và Agent Chat dự phòng. Giữ controller, contract và deep link.
4. **Giai đoạn 3 — nhân vật, bắt buộc ở quy mô nhỏ:** bổ sung pose Navigator cho welcome/empty/progress/result/error, bản xuất mobile và nhật ký xuất xứ. Chân dung agent chuyên biệt là tùy chọn.
5. **Giai đoạn 4 — motion, bắt buộc ở quy mô nhỏ:** chuẩn hóa CSS micro-interaction, rà soát `MotionReveal`, thêm một hoặc hai timeline GSAP thật sự hữu ích; kiểm tra cleanup và reduced-motion. Ambient/parallax là tùy chọn.
6. **Giai đoạn 5 — hoàn thiện, bắt buộc:** theo tinh thần [Impeccable](https://github.com/pbakaus/impeccable), critique phân cấp, audit accessibility/responsive/hiệu năng, bỏ card thừa, chỉnh typography, kiểm tra trạng thái lỗi và tối ưu ảnh. Dùng như phương pháp rà soát, không sao chép hoặc cài thêm công cụ.

### Rủi ro và cách giảm

| Rủi ro | Cách giảm |
| --- | --- |
| Các lớp tối hòa vào nhau; dữ liệu khó đọc | Chốt từng bậc sáng tối và đo trực tiếp chart, tooltip, bảng, disabled, focus. |
| Anime lấn át tính chuyên nghiệp hoặc không thống nhất nét vẽ | Một art brief, Navigator làm trục chính; hình lớn chỉ ở vùng ít dữ liệu; ghi quyền dùng và nguồn gốc. |
| Nhiều khung và hiệu ứng che bằng chứng | Một điểm nhấn nội dung theo route; giảm khung thừa; giữ vùng đọc phẳng. |
| Chuyển động gây lag, chóng mặt hoặc phát lại sai lúc polling | CSS mặc định, timeline ngắn, reduced-motion, không animate lại mọi lần cập nhật, đo trên di động. |
| Dark theme đụng selector cũ | Chuyển theo từng bề mặt; so ảnh trước/sau; đọc `legacy-components.css` cùng override. |
| Bundle/asset tăng và memory leak | Tận dụng thư viện đã có, import theo route, tối ưu ảnh, cleanup và đặt ngưỡng đo. |
| Hỏng route/quyền/bằng chứng/in/xuất | Giữ business hook/API; kiểm tra owner/analyst/viewer, deep link, run cũ, export và print. |

### Tiêu chí nghiệm thu cho đợt triển khai

- Mọi route hiện có và trạng thái login/loading/error có phân cấp tối nhất quán; control gốc và thanh trình duyệt hợp theme; bản in báo cáo vẫn đọc tốt trên nền trắng.
- Chữ, metadata, control, trạng thái, focus, trục/tooltip chart và link bằng chứng đạt mục tiêu tương phản ở trên; có thể hiểu trạng thái mà không cần màu hay hình nhân vật.
- Dashboard, chat, run progress, report và evidence có vùng chính rõ ràng; trang trí không che dữ liệu; không phải card lồng nhau mới hiểu nội dung.
- Navigator nhận diện được ít nhất ở welcome, empty, progress và result/recovery; mỗi asset có nguồn, quyền dùng, quy tắc mobile/ẩn và kiểm tra kích thước.
- `/chat` và `/runs/[runId]` chỉ hiện trạng thái agent/task/report đã lưu; hội thoại cũ, đổi tổ chức, quyền viewer, xuất báo cáo và lineage không đổi.
- Ở 320px, 720px, tablet và desktop, nav, composer, dialog, bảng và tiếng Việt dài dùng được, không tràn ngang toàn trang; vùng chạm ít nhất 44px.
- Người dùng reduced-motion thấy trạng thái cuối ngay; focus và screen reader vẫn đúng; animation không chặn nhập và không chạy lại theo từng lần polling.
- Có ảnh đối chiếu và số đo trước/sau cho LCP, CLS, độ trễ tương tác, kích thước JS/ảnh; không có hồi quy đáng kể hoặc ngoại lệ phải được giải thích bằng số liệu.

## 10. Checklist triển khai

**Bắt buộc**

- [ ] Chụp baseline đã đăng nhập cho login, dashboard, chat, run detail, report, imports, automations, mobile và print.
- [ ] Lập bản đồ cascade và màu viết cứng; định nghĩa token tối và ma trận tương phản trong `styles/tokens.css`; cập nhật `docs/DESIGN.md` khi hướng thiết kế được chốt.
- [ ] Đổi root theme, `color-scheme`, browser theme color, control/focus/selection và palette print.
- [ ] Restyle `AppShell`, điều hướng, chọn tổ chức, topbar, dialog di động và primitive mà không đổi route/quyền.
- [ ] Thiết kế lại hero/tổng quan `/workspace`, giữ số liệu, hành động và hoạt động gần đây dễ quét.
- [ ] Restyle Grok conversation/rail/inspector/composer/message/task progress/drawer; căn chỉnh Agent Chat dự phòng.
- [ ] Restyle report/dashboard, màu và tooltip chart, evidence/lineage, bảng và bản in/xuất.
- [ ] Restyle form, empty/error và trạng thái của imports và automations.
- [ ] Tạo bộ ảnh Navigator nhỏ, nguyên bản, có bản xuất responsive, quyền dùng và quy tắc placement.
- [ ] Chuẩn hóa CSS motion; rà soát `MotionReveal`; chỉ thêm timeline GSAP được duyệt, có cleanup và reduced-motion.
- [ ] Kiểm tra bàn phím, screen reader, tương phản, các mốc màn hình, tiếng Việt dài, run lịch sử và quyền owner/analyst/viewer.
- [ ] Đo ảnh, JS theo route, LCP/CLS/độ trễ và cuộn chat dài; hoàn tất critique, audit, polish, harden, optimize.

**Tùy chọn sau khi phần chính đạt chuẩn**

- [ ] Thử một lớp ambient rất nhẹ trên vùng rộng, ít dữ liệu; chỉ giữ nếu đạt kiểm tra đọc/hiệu năng.
- [ ] Đánh giá chân dung agent chuyên biệt khi vai trò và trạng thái thực sự cần.
- [ ] Cân nhắc onboarding/help/settings và ScrollTrigger trong một phạm vi sản phẩm riêng.
