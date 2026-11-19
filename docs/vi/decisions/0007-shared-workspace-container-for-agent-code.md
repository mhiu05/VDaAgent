# 0007 · Một container `workspace` dùng chung chạy mọi code của agent

- **Bối cảnh.** Mọi hành động là `cd AGENT_FOLDER && python -c CODE`. Code của agent cần credentials của miền nhưng không được sửa chúng.
- **Quyết định.**
  - Mọi thư mục người dùng × agent nằm trong một container `workspace`, và `execd` chạy code với `cwd` là thư mục đích.
  - `/domains` được mount chỉ đọc.
  - Quy tắc agent không được đọc hay in `.env.d/` **chỉ được cưỡng chế bằng system prompt**. Điều này được ghi lại là việc sau này.
  - `workspace` không có đường tới Postgres hay Langfuse.
- **Đã loại.**
  - bubblewrap cho mỗi lần chạy: cần user namespace và chỉnh seccomp trên máy Docker; đáng làm sau.
  - Container cho mỗi agent qua Docker socket: socket tương đương quyền root, và cần code quản lý vòng đời và dọn dẹp.
- **Hệ quả.** Không có cô lập filesystem giữa các agent hay người dùng. Xem [11](../11-sandbox.md) và [99](../99-risks-and-future-work.md).
