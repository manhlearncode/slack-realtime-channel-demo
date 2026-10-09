# Demo tin nhắn realtime trong kênh — An 3001, Bình 3002

**Bản 1.3.0.** Demo trên **một máy**, mở hai cửa sổ trình duyệt:

| Người dùng | Địa chỉ frontend |
| --- | --- |
| An | [http://localhost:3001/?user=An](http://localhost:3001/?user=An) |
| Bình | [http://localhost:3002/?user=Binh](http://localhost:3002/?user=Binh) |

Hai trang mặc định vào kênh **alpha**. Mỗi trang mở một WebSocket riêng; tin đi từ người gửi tới **backend chung**, được lưu vào PostgreSQL, cập nhật Map cache rồi broadcast tới các kết nối trong kênh. Cùng mã frontend, một backend process, một database và một cache.

**Công nghệ:** Node.js 24, Express, `ws`, PostgreSQL, HTML/CSS/JavaScript. Kịch bản dựa trên **[LTW] Demo bài TH.docx** và yêu cầu bổ sung dùng hai cổng riêng.

![Giao diện ứng dụng](docs/screenshot.png)

## Chạy nhanh trên Windows bằng Docker

Mở Docker Desktop và chờ Engine sẵn sàng. Mở PowerShell **tại thư mục chứa `compose.yml` và `package.json`**:

```powershell
docker info
$env:APP_BIND_IP = "127.0.0.1"
docker compose up --build -d
docker compose ps
```

`docker info` cần có phần **Server** và không báo lỗi kết nối. Lần đầu cần Internet để tải image và dependency. Khi app sẵn sàng, mở hai URL An/Bình ở đầu README.

Xem log trong một terminal riêng:

```powershell
docker compose logs -f app
```

Log khởi động hiển thị đúng hai URL:

```text
[READY] http://localhost:3001/?user=An
[READY] http://localhost:3002/?user=Binh
```

Nhấn **Enter** để gửi, **Shift + Enter** để xuống dòng. An gửi `Chào cả nhóm!`, Bình trả lời `Đã nhận!`. Hai người thấy tin ngay. F5 trên Bình vẫn còn lịch sử.

Kiểm tra ứng dụng và DB bằng [health cổng 3001](http://localhost:3001/health) hoặc [health cổng 3002](http://localhost:3002/health). Response sẵn sàng có `"status": "ok"`.

Trên Linux, Kali hoặc Git Bash, dùng `export APP_BIND_IP=127.0.0.1` thay dòng `$env:APP_BIND_IP`, rồi chạy các lệnh Compose như trên.

## Hai cổng hoạt động như thế nào?

| Cách chạy | Cổng An | Cổng Bình | Backend |
| --- | --- | --- | --- |
| Docker Compose | 3001 trên máy host | 3002 trên máy host | Cả hai được publish tới 3000 trong cùng container app |
| Node.js trực tiếp | Listener HTTP/WS 3001 | Listener HTTP/WS 3002 | Cùng process, Express app, WebSocketServer, DB và Map |

Frontend lấy địa chỉ WebSocket từ `location.host`, nên An kết nối qua 3001 và Bình qua 3002. Các trang giao tiếp qua backend chung.

`compose.yml` **đã mặc định dùng hai cổng**. `compose.two-ports.yml` được giữ để tương thích lệnh của bản cũ và cũng dùng hai cổng này. Hướng dẫn chính dùng `docker compose`; nếu chọn file tương thích, thêm `-f compose.two-ports.yml` vào mọi lệnh Compose của phiên đó.

Xem [giải thích hai socket](docs/TWO_PORTS_DEMO.md) và [kiến trúc, API, event](docs/ARCHITECTURE.md).

## Chạy bằng Node.js để sửa code

Cần Node.js 24 và PostgreSQL. Nếu dùng DB từ Docker, dừng app Docker trước để nhường cổng 3001/3002:

```powershell
docker compose stop app
docker compose up -d db
npm ci
if (-not (Test-Path ".env")) { Copy-Item .env.example .env }
$env:HOST = "127.0.0.1"
$env:PORTS = "3001,3002"
npm start
```

Mở đúng hai URL An/Bình ở đầu README. Một process Node.js mở cả hai listener và chia sẻ backend. `npm run dev` chạy tương tự, có tự khởi động lại khi sửa file.

Cấu hình mẫu trong `.env.example`:

```dotenv
DATABASE_URL=postgresql://chatdemo:chatdemo_local@127.0.0.1:5432/chatdemo
PORTS=3001,3002
HOST=127.0.0.1
APP_BIND_IP=127.0.0.1
```

`PORTS` và `HOST` dùng cho Node.js trực tiếp. `APP_BIND_IP` điều khiển địa chỉ publish của Docker. Compose đặt `PORT=3000` và `HOST=0.0.0.0` bên trong container; cổng người dùng vẫn là 3001/3002.

Nếu có `.env` cũ, giữ DATABASE_URL đang hoạt động và thêm/sửa `PORTS=3001,3002`. PORTS được ưu tiên hơn PORT. Khi dùng PostgreSQL riêng, tài khoản cần quyền tạo bảng; chạy integration test cần thêm quyền tạo schema.

## Kịch bản và minh chứng demo

Làm theo [kịch bản 7 bước](docs/DEMO_SCRIPT.md): HTTP lịch sử → WebSocket Upgrade 101 → An gửi → DB/Cache/broadcast → Bình trả lời → F5/cache HIT → reconnect tùy chọn.

Mở F12 → Network → WS trên cả hai cửa sổ. Request của An dùng 3001, của Bình dùng 3002; status **101 Switching Protocols**. Trong Messages có `message.send`, `message.new` và `message.ack`.

Log ghi lại pipeline thực tế:

```text
[CACHE MISS] channel=C_alpha after=0 total=0
[DB INSERT] channel=C_alpha id=1 user=An
[CACHE UPDATE] channel=C_alpha total=1
[WS BROADCAST] channel=C_alpha id=1 recipients=2
[CACHE HIT] channel=C_alpha after=0 total=2
```

ID và số lượng phụ thuộc dữ liệu đang có. Client đọc thêm history sau khi WS mở để tránh bỏ sót tin, nên có thể thấy thêm CACHE HIT với cursor `after`.

Để xem dữ liệu bằng PowerShell:

```powershell
docker compose exec db psql -U chatdemo -d chatdemo
```

Sau đó nhập trong psql:

```sql
SELECT id, channel_id, "user", text, ts, created_at FROM messages ORDER BY id;
\q
```

[Kênh beta](http://localhost:3001/?user=Khach&channel=beta) dùng để chứng minh tin alpha chỉ broadcast trong alpha. [Đối chiếu yêu cầu](docs/REQUIREMENTS.md) liệt kê phần triển khai tương ứng.

## Kiểm thử

Nếu đã có Node.js và DB sẵn sàng:

```powershell
npm ci
npm run check
npm test
```

Hoặc dùng Docker:

```powershell
docker compose --profile test run --build --rm tests
```

12 integration test dùng PostgreSQL và WebSocket thật. Test tạo schema tạm riêng rồi xóa; bao gồm trao đổi qua hai listener cùng backend và đóng cả hai listener khi dừng. GitHub Actions chạy kiểm tra cú pháp và integration test khi push/PR. Kết quả thực hiện và giới hạn kiểm tra nằm trong [TESTING.md](docs/TESTING.md).

## Dừng, mở lại và reset lịch sử

```powershell
docker compose down
docker compose up -d
```

Volume `chatdemo-data` giữ lịch sử qua các lần dừng/mở. `down -v` xóa volume.

Để **xóa toàn bộ tin demo** và diễn lại từ đầu:

```powershell
docker compose stop app
docker compose exec db psql -U chatdemo -d chatdemo -c "TRUNCATE TABLE messages RESTART IDENTITY;"
docker compose up -d app
```

Dừng Node.js bằng Ctrl+C trước khi reset nếu đang chạy trực tiếp. Đóng các tab demo cũ, khởi động lại app rồi mở An trước để quan sát CACHE MISS. Restart app chỉ xóa Map, giữ dữ liệu DB.

## Cập nhật repo GitHub đã có

Dùng [UPDATING.md](docs/UPDATING.md) để chép bản mới vào repo cũ, giữ `.git`, `.env` và lịch sử dữ liệu, rồi commit/push. [CHANGELOG.md](CHANGELOG.md) ghi những thay đổi của bản 1.3.0.

Nếu tạo repository mới, chạy tại thư mục dự án:

```powershell
git init -b main
git add .
git commit -m "Add realtime channel demo on ports 3001 and 3002"
git remote add origin https://github.com/YOUR_USERNAME/slack-realtime-channel-demo.git
git push -u origin main
```

Thay YOUR_USERNAME bằng tài khoản của bạn. Repo mới trên GitHub nên để trống khi dùng chuỗi lệnh này. `.gitignore` loại `.env`, node_modules và log. GitHub lưu source; backend được chạy bằng Node.js hoặc Docker. GitHub Pages phục vụ file tĩnh nên không chạy backend của gói này.

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Lỗi `dockerDesktopLinuxEngine` / không kết nối daemon | Mở Docker Desktop, chờ `docker info` có phần Server; dùng Linux containers |
| Cổng 3001/3002 đã được dùng | Xem `Get-NetTCPConnection -LocalPort 3001,3002 -ErrorAction SilentlyContinue`; dừng ứng dụng chiếm cổng hoặc dừng app Docker trước khi chạy Node |
| Mở URL cũ không thấy app | Dùng 3001 cho An và 3002 cho Bình như bảng đầu README |
| Không thấy mapping hai cổng | Kiểm tra đã chép `compose.yml` mới, rồi chạy `docker compose up --build -d` |
| START FAILED / ECONNREFUSED | Xem log app/db, DATABASE_URL và trạng thái DB |
| DB sai mật khẩu | Đối chiếu cấu hình với tài khoản đã khởi tạo volume DB |
| Hai trang kết nối nhưng không thấy tin nhau | Cùng kênh alpha, dùng cùng backend của gói này; kiểm tra log WS BROADCAST |
| JS cũ sau khi cập nhật | Build lại app và nhấn Ctrl+F5 trên hai trang |
| Chưa thấy CACHE MISS | Đóng tab cũ, restart app, mở An trước |
| Node vẫn chạy theo PORT cũ | Đặt `PORTS=3001,3002` rồi dừng/mở lại process |
| Reconnect qua proxy không hoạt động | Kiểm tra chuyển tiếp WebSocket Upgrade; HTTPS dùng wss |
| Cần mở trên máy khác | Dùng [LAN_DEMO.md](docs/LAN_DEMO.md), vẫn giữ An 3001/Bình 3002 |

## Cấu trúc và phạm vi

| File/thư mục | Vai trò |
| --- | --- |
| `src/server.js` | HTTP, nhiều listener, WebSocket, broadcast, heartbeat |
| `src/chat-service.js`, `src/config.js` | PostgreSQL, Map cache, hàng đợi theo kênh, validation |
| `public/` | Giao diện chat và client HTTP/WS |
| `sql/schema.sql` | Bảng messages và unique constraint |
| `test/realtime.test.js` | Integration test |
| `compose.yml`, `Dockerfile` | Cấu hình chạy mặc định hai cổng |
| `compose.two-ports.yml` | Tương thích lệnh Compose hai cổng của bản 1.2.0 |
| `docs/` | Kịch bản, yêu cầu, kiến trúc, kiểm thử, LAN và cập nhật repo |
| `.github/workflows/ci.yml` | Kiểm tra tự động trên GitHub |

Gói minh họa chức năng chat kênh của Slack, chạy một backend process với hai kênh mẫu. Tên từ query là danh tính demo; chưa có đăng nhập/phân quyền. Map giữ toàn bộ lịch sử đã tải, không có TTL và không chia sẻ giữa nhiều process. Bản nháp dùng sessionStorage, tin đã xác nhận nằm trong PostgreSQL. Phạm vi chưa gồm DM, thread hay upload file.

Source được phát hành theo [MIT License](LICENSE).
