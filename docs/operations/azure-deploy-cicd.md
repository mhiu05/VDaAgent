# Triển khai Azure và CI/CD

> Trang tương thích cho liên kết cũ, đã đối chiếu ngày 2026-09-15. Runbook hiện hành là [Triển khai Azure](deployment.md) và workflow `.github/workflows/azure-container-deploy.yml`; không duy trì một contract triển khai song song ở đây.

File này được giữ để không làm hỏng liên kết cũ, nhưng không còn duy trì bản sao trigger, quality gate, secret list hoặc rollback contract. Xem [runbook triển khai](deployment.md) cho topology, thứ tự release, key datasource vẫn bắt buộc sau purge, bước CLI rollout riêng và kiểm tra sau deploy. Workflow trong repository là nguồn sự thật cho điều kiện `push`/PR/manual và path filter; health HTTP 200 không thay thế synthetic nghiệp vụ.
