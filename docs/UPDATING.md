# Cập nhật repo GitHub cũ lên bản 1.3.0

Sau cập nhật, lệnh `docker compose up --build -d` mặc định mở:

- An: [http://localhost:3001/?user=An](http://localhost:3001/?user=An).
- Bình: [http://localhost:3002/?user=Binh](http://localhost:3002/?user=Binh).

Repo GitHub và lịch sử commit được giữ bằng cách chép source mới vào **thư mục repo cũ** có .git, rồi commit/push.

## 1. Xác định thư mục repo

Trong PowerShell tại repo cũ:

```powershell
git status
git remote -v
git branch --show-current
```

Xem các thay đổi riêng đang có trước khi ghi đè; lưu/commit phần cần giữ. Nếu thư mục chưa phải Git repo, clone đúng repo đã đăng bằng `git clone URL_REPO_CU`, rồi dùng thư mục clone làm đích.

## 2. Chép nội dung bản mới

Giải nén ZIP mới vào một thư mục tạm. Mở thư mục bên trong có package.json, compose.yml và README.md. Chép **nội dung** của thư mục đó vào repo cũ, chọn Replace files khi cần.

| Vị trí sau khi chép | Nội dung cần có |
| --- | --- |
| Gốc repo cũ | package.json, compose.yml, compose.two-ports.yml, README.md, CHANGELOG.md |
| src/ và public/ | Source bản mới |
| docs/ | Tài liệu bản mới |
| .git/ | Metadata Git của repo cũ |
| .env | Cấu hình riêng đang dùng |

Cách tự động trên Windows, sửa hai đường dẫn cho đúng máy bạn:

```powershell
$repoPath = "C:/Projects/slack-realtime-channel-demo"
$updatePath = "C:/Downloads/slack-realtime-channel-demo-v1.3.0/slack-realtime-channel-demo"
robocopy $updatePath $repoPath /E /R:1 /W:1 /XD .git node_modules /XF .env
```

Lệnh copy thêm/ghi đè source và giữ .git, node_modules, .env ở đích. Robocopy có mã trả về 0–7 cho các trạng thái không có lỗi copy; từ 8 trở lên có lỗi cần xử lý. Tham khảo [Microsoft Robocopy](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy).

## 3. Kiểm tra và chạy bản mới

Quay về repo cũ. Bật Docker Desktop:

```powershell
docker info
$env:APP_BIND_IP = "127.0.0.1"
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Đây là lệnh build từ source vừa cập nhật và đổi mapping app sang 3001/3002. Volume DB được giữ nếu chạy cùng thư mục/tên project Compose và không xóa volume. Chờ hai dòng READY đúng URL, mở An/Bình và thử gửi hai chiều.

Có thể dùng `docker compose config` để xem cấu hình đã resolve. Cổng app phải có host port 3001 và 3002, cùng target 3000.

Nếu chạy Node trực tiếp, dừng app Docker và process Node cũ; giữ DATABASE_URL, thêm/sửa `PORTS=3001,3002` và `HOST=127.0.0.1` trong .env. Chạy `npm ci`, rồi `npm start`. Không cần tạo lại database để đổi cổng.

## 4. Commit và push vào repo hiện tại

Trong một terminal tại repo cũ:

```powershell
git status
git add .
git diff --cached --stat
git diff --cached
git commit -m "Update demo to An 3001 and Binh 3002"
git push
```

Kiểm tra diff để chỉ đưa các thay đổi mong muốn vào commit. .gitignore loại .env, node_modules và log. Nếu push báo chưa có upstream, dùng `git push -u origin TEN_NHANH` với tên nhánh từ bước 1. Nếu remote có commit mới, đồng bộ bằng `git pull --rebase`, xử lý conflict theo git status rồi push lại.

Mở repo GitHub, kiểm tra README đầu trang có hai URL mới, package.json là **1.3.0** và compose.yml có hai mapping. GitHub Actions sẽ kiểm tra khi workflow được kích hoạt trong repo.

## Khác biệt cần nhớ

| Bản cũ | Bản 1.3.0 |
| --- | --- |
| compose.yml chỉ dùng cổng 3000 | compose.yml mặc định có 3001/3002 |
| Phải chọn compose.two-ports.yml cho hai cổng | Lệnh docker compose thông thường đã dùng hai cổng |
| Node mặc định một listener | Node mặc định hai listener, cùng backend |
| README/kịch bản có URL 3000 xen kẽ | Tài liệu thống nhất An 3001, Bình 3002 |

Xem [README](../README.md) và [CHANGELOG](../CHANGELOG.md).
