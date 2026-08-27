# Hướng dẫn kết nối MongoDB Atlas với VDaAgent

Tài liệu này hướng dẫn tạo một MongoDB Atlas database user chỉ đọc và kết nối
cluster đó với VDaAgent qua trang `/connectors`.

## 1. Kiến trúc kết nối

Trình duyệt không kết nối trực tiếp tới MongoDB. Luồng kết nối là:

```text
Browser /connectors
        |
        | POST /api/v1/connectors/datasource/test hoặc /datasource
        v
VDaAgent API hoặc profiling worker
        |
        | MongoDB URI qua PyMongo
        v
MongoDB Atlas cluster
```

Điều này có nghĩa là IP cần được allowlist trong Atlas là IP outbound của máy
chạy backend/worker, không phải IP của trình duyệt khi ứng dụng đã deploy lên
Azure.

Connector hiện tại chỉ đọc dữ liệu:

- Kiểm tra `ping` tới cluster.
- Liệt kê collection trong database.
- Đọc document bằng `find(filter)`.
- Giới hạn materialize tối đa 1.000.000 document cho mỗi lần profiling.
- Không thực hiện insert, update, delete, drop hoặc thao tác ghi khác.

Chi tiết implementation nằm trong
[`backend/src/services/datasource.py`](../backend/src/services/datasource.py)
và form nằm trong
[`frontend/src/components/datasource-connector.tsx`](../frontend/src/components/datasource-connector.tsx).

## 2. Điều kiện cần có

Chuẩn bị các thông tin sau trước khi mở VDaAgent:

| Thành phần | Giá trị cần có |
| --- | --- |
| Atlas organization/project | Project đang chứa cluster |
| Cluster | Cluster đã provision xong |
| Database user | User xác thực bằng password/SCRAM |
| Quyền | Tối thiểu role `read` trên database dữ liệu |
| Network access | IP outbound của môi trường chạy backend được thêm vào Atlas |
| Database | Tên database cần đọc |
| Collection | Tên collection cần profiling |
| Connection string | URI `mongodb+srv://...` hoặc `mongodb://...` |

Trong project, backend đã có dependency `pymongo` trong
[`requirements.txt`](../requirements.txt) và
[`requirements.azure.txt`](../requirements.azure.txt). Production cũng cần
`DATASOURCE_ENCRYPTION_KEY` để mã hóa URI và credential trước khi lưu vào
metadata database. Không đưa MongoDB URI vào frontend hoặc commit vào Git.

## 3. Tạo MongoDB Atlas project và cluster

Nếu đã có project và cluster, chuyển sang bước 4.

1. Đăng nhập [MongoDB Atlas](https://cloud.mongodb.com/).
2. Chọn organization hiện có hoặc tạo organization mới.
3. Tạo project riêng cho môi trường cần dùng, ví dụ `p170-dev` hoặc `p170-prod`.
4. Mở khu vực tạo deployment/cluster.
5. Chọn tier phù hợp với dữ liệu. Có thể dùng tier miễn phí hoặc Flex cho thử
   nghiệm; production nên chọn tier có tài nguyên và SLA phù hợp.
6. Chọn cloud provider và region gần môi trường chạy backend. Với Azure, ưu tiên
   region gần Azure App Service để giảm latency.
7. Đặt tên cluster, ví dụ `p170-prod`.
8. Tạo cluster và chờ trạng thái chuyển sang sẵn sàng trước khi kết nối.

Atlas có hướng dẫn chính thức tại
[Create and Connect to Clusters](https://www.mongodb.com/docs/atlas/create-connect-deployments/).

## 4. Tạo database user chỉ đọc

Atlas user đăng nhập vào giao diện Atlas khác với MongoDB database user dùng
trong connection string. VDaAgent cần database user.

### 4.1. Tạo user trong Atlas UI

1. Trong project, mở **Security → Database & Network Access**.
2. Chọn tab **Database Users**.
3. Chọn **Add New Database User**.
4. Chọn phương thức xác thực bằng password/SCRAM.
5. Đặt username, ví dụ:

   ```text
   p170_reader
   ```

6. Sinh password dài, ngẫu nhiên và lưu trong password manager.
7. Ở phần quyền database, chọn role built-in **Read** cho database cần đọc,
   ví dụ `analytics`.
8. Không dùng **Project Owner**, **Atlas Admin**, `readWriteAnyDatabase` hoặc
   `readWrite` cho connector này.
9. Nếu Atlas cho phép giới hạn cluster, chỉ cấp user vào cluster cần dùng.
10. Lưu user.

Role `read` đã bao gồm các thao tác cần cho connector như `find` và
`listCollections`. VDaAgent không cần quyền ghi.

### 4.2. Ví dụ tạo user bằng mongosh

Nếu đang quản trị self-managed MongoDB hoặc dùng mongosh với quyền quản trị,
có thể tạo user tương đương bằng:

```javascript
use admin

db.createUser({
  user: "p170_reader",
  pwd: passwordPrompt(),
  roles: [
    { role: "read", db: "analytics" }
  ]
})
```

Trong ví dụ này, user được tạo trên database `admin`, còn quyền đọc áp dụng cho
database `analytics`. Khi đó nên chỉ rõ `authSource=admin` trong URI.

MongoDB hướng dẫn quản lý database users tại
[Configure Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)
và danh sách quyền tại
[Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/).

## 5. Cấu hình Network Access

Atlas chỉ nhận kết nối client đến từ địa chỉ nằm trong IP access list.

### 5.1. Kết nối từ máy local

Dùng cho trường hợp backend VDaAgent chạy trực tiếp trên laptop/desktop:

1. Mở **Security → Database & Network Access → IP Access List**.
2. Chọn **Add IP Address**.
3. Chọn **Add My Current IP Address**.
4. Đặt mô tả, ví dụ `developer-local`.
5. Lưu thay đổi.

Nếu mạng internet dùng IP động, IP có thể thay đổi khi đổi Wi-Fi hoặc ISP.
Khi đó cần cập nhật lại access list.

### 5.2. Kết nối từ Azure App Service

Với deployment hiện tại, MongoDB được truy cập bởi hai app khác nhau:

- Backend API.
- Profiling worker.

Vì vậy cần lấy và thêm outbound IP của cả hai App Service:

1. Mở Azure Portal → **App Services**.
2. Chọn app backend.
3. Mở **Networking** và tìm phần **Outbound addresses**.
4. Sao chép các địa chỉ outbound.
5. Lặp lại với app profiling worker.
6. Trong Atlas, mở **Security → Database & Network Access → IP Access List**.
7. Thêm từng IP dưới dạng IP đơn hoặc CIDR `/32`, với mô tả rõ ràng, ví dụ:

   ```text
   p170-api-azure
   p170-worker-azure
   ```

> Không cần allowlist IP của frontend App Service vì frontend không mở kết nối
> MongoDB; backend và worker mới là client của Atlas.

Azure có thể thay đổi outbound IP sau một số thay đổi hạ tầng. Khi đó cần cập
nhật Atlas access list trước khi xóa IP cũ để tránh gián đoạn. Xem thêm
[Azure App Service outbound IP addresses](https://learn.microsoft.com/en-us/azure/app-service/overview-inbound-outbound-traffic#outbound-addresses).

### 5.3. Không nên dùng `0.0.0.0/0` trong production

`0.0.0.0/0` cho phép mọi địa chỉ IPv4 thử kết nối tới cluster. Chỉ dùng tạm
thời cho debug ngắn hạn trong môi trường không có dữ liệu nhạy cảm, sau đó
xóa ngay và thay bằng IP outbound cụ thể.

Nếu backend Azure nằm trong mạng riêng, có thể dùng VNet integration, Private
Endpoint hoặc network architecture phù hợp thay vì mở Atlas qua public IP.

## 6. Lấy connection string từ Atlas

1. Mở **Database → Clusters**.
2. Chọn cluster cần dùng.
3. Chọn **Connect**.
4. Chọn **Drivers**.
5. Chọn driver Python hoặc lấy URI chuẩn của Atlas.
6. Sao chép connection string.
7. Thay các placeholder username/password bằng database user vừa tạo.

Ưu tiên URI dạng SRV:

```text
mongodb+srv://p170_reader:<encoded-password>@p170-prod.xxxxx.mongodb.net/?authSource=admin
```

Nếu Atlas đã cung cấp các option như `retryWrites=true&w=majority` thì giữ lại:

```text
mongodb+srv://p170_reader:<encoded-password>@p170-prod.xxxxx.mongodb.net/?retryWrites=true&w=majority&authSource=admin
```

Trong đó:

- `p170_reader` là MongoDB database user, không phải email Atlas.
- `<encoded-password>` là password đã URL-encode.
- `authSource=admin` phải khớp database nơi user được tạo.
- `analytics` không nhất thiết phải đặt trong URI vì VDaAgent nhận database ở
  field riêng trên form.

Nếu password chứa ký tự đặc biệt như `@`, `:`, `/`, `?`, `#`, `[`, `]` hoặc
`$`, cần percent-encode trước khi đưa vào URI. Xem
[MongoDB Connection String Options](https://www.mongodb.com/docs/manual/reference/connection-string-options/).

Ví dụ password:

```text
mY@pass/2026
```

phải được encode trước khi dùng trong URI, thay vì copy nguyên chuỗi vào giữa
username và hostname.

## 7. Tạo database và collection mẫu

MongoDB tạo database/collection khi có dữ liệu đầu tiên. Có thể tạo dữ liệu
mẫu bằng Atlas Data Explorer hoặc mongosh với user có quyền ghi quản trị.

Ví dụ document phù hợp để thử profiling:

```javascript
use analytics

db.orders.insertMany([
  {
    order_id: "ORD-001",
    customer_id: "CUS-001",
    status: "paid",
    amount: 125.5,
    created_at: ISODate("2026-08-01T10:00:00Z")
  },
  {
    order_id: "ORD-002",
    customer_id: "CUS-002",
    status: "pending",
    amount: 80,
    created_at: ISODate("2026-08-02T11:30:00Z")
  }
])
```

Sau khi tạo dữ liệu, xác nhận đúng tên:

```text
Database: analytics
Collection: orders
```

Database user `p170_reader` chỉ cần quyền đọc; không dùng user quản trị để
cấu hình connector trong VDaAgent.

## 8. Nhập thông tin trong VDaAgent

### 8.1. Mở form

Local:

```text
http://localhost:3000/connectors
```

Sau đó:

1. Đăng nhập và chọn workspace có quyền sử dụng datasource.
   API yêu cầu workspace permission `dataset.upload`; nếu nút connector không
   xuất hiện hoặc API trả `insufficient_permission`, hãy dùng tài khoản Analyst
   đang active trong workspace.
2. Trong phần **Lưu connector datasource**, chọn **MongoDB**.
3. Nhập các field sau:

| Field trên UI | Giá trị mẫu | Ghi chú |
| --- | --- | --- |
| Tên connector | `Mongo Atlas Analytics` | Tên hiển thị trong workspace |
| MongoDB URI | `mongodb+srv://...` | Có username/password và `authSource` nếu cần |
| Database | `analytics` | Bắt buộc, phân biệt hoa thường |
| Collection | `orders` | Bắt buộc, phân biệt hoa thường |
| Filter JSON | `{}` | Đọc toàn bộ document |

`Database` và `Collection` phải nhập riêng ngay cả khi database đã xuất hiện
trong URI. Backend hiện bắt buộc cả ba giá trị: URI, database và collection.

### 8.2. Filter JSON

Filter phải là một JSON object, không phải array hoặc chuỗi tự do:

Đọc tất cả:

```json
{}
```

Chỉ đọc đơn hàng đã thanh toán:

```json
{
  "status": "paid"
}
```

Lọc theo số tiền:

```json
{
  "amount": {
    "$gte": 100
  }
}
```

Form hiện gửi filter qua `json.loads`, nên các giá trị nâng cao như
`ObjectId(...)` hoặc `ISODate(...)` không được nhập dưới dạng biểu thức
mongosh. Nếu cần lọc theo BSON `ObjectId` hoặc BSON Date, nên kiểm tra kỹ kiểu
dữ liệu; filter dạng string có thể không khớp với BSON type trong collection.

### 8.3. Test và lưu

1. Nhấn **Kiểm tra kết nối**.
2. Nếu thành công, UI sẽ nhận danh sách collection từ Atlas.
3. Chọn đúng collection cần profiling.
4. Nhấn **Lưu connector**.
5. Vào `/datasets/new`, chọn datasource đã lưu để tạo dataset và bắt đầu
   profiling.

Nút kiểm tra gọi endpoint `POST /api/v1/datasets/datasource/test`. Nút lưu gọi
`POST /api/v1/connectors/datasource`; backend sẽ test lại, mã hóa cấu hình rồi
lưu connector. Vì vậy test thành công không chỉ phụ thuộc vào form mà còn phụ
thuộc vào network của backend.

## 9. Cấu hình production/Azure trong project

### 9.1. `DATASOURCE_ENCRYPTION_KEY`

Production bắt buộc có secret:

```text
DATASOURCE_ENCRYPTION_KEY=<Fernet key cố định>
```

Sinh key một lần:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Giữ nguyên key trong suốt vòng đời các connector đã lưu. Không tạo key mới mỗi
lần deploy. Nếu đổi key, các URI đã mã hóa trước đó không thể giải mã và phải
nhập lại/recreate connector.

Workflow Azure hiện truyền secret này cho backend và profiling worker. Kiểm tra
[`azure-container-deploy.yml`](../.github/workflows/azure-container-deploy.yml)
trước khi deploy, đặc biệt phần GitHub Secret và Azure App Settings.

### 9.2. Không tạo `MONGO_URI` trong frontend

Thiết kế hiện tại không yêu cầu `MONGO_URI` trong `.env` hoặc
`NEXT_PUBLIC_*`. URI được nhập một lần trong UI, backend normalize rồi mã hóa
trong PostgreSQL metadata.

Không đặt các giá trị sau vào frontend hoặc Git:

```text
MONGO_URI
MongoDB username/password
DATASOURCE_ENCRYPTION_KEY
```

### 9.3. Phân biệt local và Azure

| Môi trường chạy backend | URI host nên dùng |
| --- | --- |
| Backend chạy trực tiếp trên máy có Mongo local | `127.0.0.1` hoặc `localhost` |
| Backend chạy trong Docker Compose | Tên service Mongo, ví dụ `mongodb` |
| Backend container trên Windows kết nối Mongo trên host | `host.docker.internal` |
| Backend/worker trên Azure kết nối Atlas | Hostname Atlas trong `mongodb+srv://` |

`localhost` luôn được hiểu từ nơi chạy Python backend. Khi backend chạy trên
Azure, `mongodb://localhost:27017` trỏ tới chính container Azure, không trỏ tới
laptop của developer.

## 10. Kiểm tra theo từng lớp

### 10.1. Kiểm tra Atlas

- Cluster đã provision xong.
- Database user đang active.
- Role là `read` trên đúng database.
- IP access list chứa IP outbound đúng môi trường.
- Cluster không bị pause hoặc đang provisioning.

### 10.2. Kiểm tra kết nối ngoài ứng dụng

Có thể dùng mongosh với cùng URI để tách lỗi Atlas/network khỏi lỗi VDaAgent:

```bash
mongosh "mongodb+srv://p170_reader:<encoded-password>@p170-prod.xxxxx.mongodb.net/?authSource=admin" \
  --eval "db.getSiblingDB('admin').runCommand({ ping: 1 })"
```

Sau đó kiểm tra quyền đọc:

```bash
mongosh "mongodb+srv://p170_reader:<encoded-password>@p170-prod.xxxxx.mongodb.net/?authSource=admin" \
  --eval "db.getSiblingDB('analytics').getCollectionNames()"
```

Các lệnh này nên được chạy từ đúng môi trường client. Chạy được trên laptop
không chứng minh Azure backend/worker cũng chạy được.

### 10.3. Kiểm tra VDaAgent

1. Mở `/connectors`.
2. Chọn MongoDB.
3. Nhập URI, database, collection và `{}`.
4. Nhấn **Kiểm tra kết nối**.
5. Xác nhận collection cần dùng xuất hiện trong danh sách.
6. Nhấn **Lưu connector**.
7. Tạo dataset mới từ connector đã lưu.
8. Theo dõi profiling job đến trạng thái hoàn tất.

## 11. Xử lý lỗi thường gặp

### `ServerSelectionTimeoutError` hoặc `No suitable servers found`

Nguyên nhân thường gặp:

- IP backend/worker chưa có trong Atlas IP Access List.
- Azure firewall hoặc network outbound chặn kết nối.
- DNS không phân giải được hostname `mongodb+srv`.
- URI sai hostname, thiếu option hoặc cluster chưa sẵn sàng.
- Đang dùng `localhost` từ Azure/container.

Cách xử lý: kiểm tra IP outbound của đúng API/worker, thử URI từ cùng môi
trường chạy backend và kiểm tra Atlas connection log.

### `Authentication failed`

Kiểm tra:

- Đang dùng Database User, không phải Atlas account.
- Username/password đúng.
- Password đã URL-encode.
- `authSource` đúng database nơi user được tạo, thường là `admin`.
- User chưa bị disabled hoặc password chưa bị rotate.

### `not authorized ... listCollections`

User đã kết nối được nhưng thiếu quyền đọc metadata. Gán role `read` cho đúng
database chứa collection. Việc cấp quyền ở database khác với field `Database`
trên form sẽ không đủ.

### Test kết nối thành công nhưng profiling không có dữ liệu

Kiểm tra:

- Collection nhập đúng tên và đúng chữ hoa/thường.
- Collection có document.
- Filter `{}` có trả về document hay không.
- Filter có dùng string để so sánh với BSON Date/ObjectId hay không.

Connector hiện test `ping` và liệt kê collection; việc test chưa đảm bảo
collection đã chọn có document phù hợp với filter.

### Kết nối local được nhưng Azure không kết nối được

Đây gần như luôn là vấn đề network:

- Atlas đang allowlist IP laptop thay vì IP Azure.
- Chỉ allowlist backend mà quên profiling worker.
- Azure App Service outbound IP đã thay đổi.
- Private network/VNet chưa có route hoặc DNS phù hợp.

### Không lưu được connector với lỗi encryption

Kiểm tra `DATASOURCE_ENCRYPTION_KEY` trong Azure App Settings và GitHub Secrets.
Key phải là Fernet key hợp lệ và phải giống key đã dùng để mã hóa các connector
cũ.

## 12. Checklist production

- [ ] Cluster Atlas đã provision xong.
- [ ] Đã tạo database user riêng cho VDaAgent.
- [ ] User chỉ có role `read` trên database cần đọc.
- [ ] Đã tạo/kiểm tra collection và document mẫu.
- [ ] Đã lấy URI `mongodb+srv://` từ Atlas.
- [ ] Password trong URI đã URL-encode.
- [ ] Local IP hoặc Azure API/worker outbound IP đã có trong Atlas access list.
- [ ] Không dùng `0.0.0.0/0` trong production.
- [ ] `DATASOURCE_ENCRYPTION_KEY` đã cấu hình cố định ở backend và worker.
- [ ] URI không nằm trong frontend bundle, Git hoặc log.
- [ ] Đã test từ đúng môi trường chạy backend.
- [ ] Người dùng có workspace permission `dataset.upload`.
- [ ] Đã test cả bước tạo dataset/profiling sau khi lưu connector.

## 13. Tài liệu tham khảo chính thức

- [MongoDB Atlas: Create and Connect to Clusters](https://www.mongodb.com/docs/atlas/create-connect-deployments/)
- [MongoDB Atlas: Configure Database Users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)
- [MongoDB Atlas: Manage the IP Access List](https://www.mongodb.com/docs/atlas/security/add-ip-address-to-list/)
- [MongoDB Atlas: Configure Security Features for Clusters](https://www.mongodb.com/docs/atlas/setup-cluster-security/)
- [MongoDB: Connection Strings](https://www.mongodb.com/docs/manual/reference/connection-string/)
- [MongoDB: Connection String Options](https://www.mongodb.com/docs/manual/reference/connection-string-options/)
- [MongoDB: Built-In Roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/)
- [Azure App Service: Outbound addresses](https://learn.microsoft.com/en-us/azure/app-service/overview-inbound-outbound-traffic#outbound-addresses)
