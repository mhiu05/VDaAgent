# 0014 · Kho kỹ năng trong DB, dùng trình cài đặt riêng

- **Bối cảnh.** Người dùng chọn kỹ năng từ một nguồn trực tuyến nổi tiếng, như một marketplace plugin. Kỹ năng là thư mục có `SKILL.md`, nằm trong các repo GitHub. API của skills.sh chỉ nhận token Vercel OIDC, nên một stack compose không triển khai trên Vercel không gọi được nó.
- **Quyết định.**
  - Một bảng `skill_catalog` được chọn lọc, seed từ YAML (toàn cục cộng theo miền, `domain_id` null nghĩa là toàn cục), chứa tag và `install_cmd` dạng argv.
  - Cài đặt nghĩa là chạy lệnh đó qua `execd`: `python -m contoso.skills install <repo> <path> --ref <sha>`, một trình cài chỉ dùng thư viện chuẩn, giải nén đúng một thư mục từ tarball GitHub vào `skills/<name>/`.
  - Chỉ có một thư mục kỹ năng, không có file ghi nguồn gốc. Tác giả trong git phân biệt kỹ năng được cài với kỹ năng agent tự viết.
- **Đã loại.**
  - CLI của skills.sh (`npx skills add`): cần Node, cài vào thư mục riêng của từng loại agent, gửi telemetry, và mặc định không ghim phiên bản.
  - Lệnh shell tuỳ ý: không đảm bảo kết quả nằm ở `skills/<name>/`.
  - Bản sao trực tiếp của skills.sh (`mastra-ai/skills-api`): thêm một service, và hàng chục nghìn kỹ năng lập trình sẽ làm người dùng Sales Ops rối.
- **Hệ quả.** Cài đặt được ghim và tái lập được. Code bên thứ ba cần được tin cậy ([99](../99-risks-and-future-work.md)). Xem [05](../05-agent-builder.md#kỹ-năng).
