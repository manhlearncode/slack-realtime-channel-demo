# Kiểm thử bản 1.3.0

Ngày kiểm tra: **09/10/2026**. Môi trường: **Linux, Node.js v24.19.0, PostgreSQL 17.10, Chromium 153.0.8010.0**.

Ứng dụng được chạy với PostgreSQL native qua TCP và WebSocket thật. Browser context riêng cho An, Bình và Khách. Đã mở đúng hai URL [An 3001](http://localhost:3001/?user=An) và [Bình 3002](http://localhost:3002/?user=Binh) trên cùng máy kiểm tra.

## Kết quả tổng hợp

| Nhóm | Kết quả |
| --- | --- |
| Cú pháp JavaScript, npm run check | Đạt |
| Integration test backend | **12/12 đạt**, không skip |
| Kiểm tra trình duyệt | **11/11 nhóm đạt**, không có lỗi JS/console |
| Kiểm tra khởi động CLI | **2/2 cấu hình đạt** |
| Cấu trúc Compose, phiên bản, liên kết Markdown và URL | Đạt |

## 12 integration test backend

Các test được đóng gói trong `test/realtime.test.js`:

| Kiểm tra | Kết quả |
| --- | --- |
| History lần đầu CACHE MISS, lần tiếp theo HIT | Đạt |
| Upgrade 101, An/Bình trao đổi, DB → Map → broadcast, beta không nhận alpha | Đạt |
| Đọc lại history tương đương F5 giữ tin | Đạt |
| Cùng client_msg_id chỉ lưu/broadcast một lần | Đạt |
| Reconnect, cursor after lấy đủ tin bị lỡ | Đạt |
| 24 lượt ghi/đọc đồng thời, Map khớp DB | Đạt |
| Ghi lúc Map rỗng vẫn nạp lại lịch sử cũ | Đạt |
| Từ chối JSON lỗi, giả tên, sai kênh, text/ID không hợp lệ | Đạt |
| Từ chối kênh/cursor không hợp lệ, health hoạt động | Đạt |
| Presence đếm tên duy nhất khi mở nhiều tab | Đạt |
| Server restart xóa Map và giữ history PostgreSQL | Đạt |
| Hai listener chia sẻ cache/history/broadcast; dừng app đóng cả hai listener | Đạt |

Test cuối dùng hai cổng trống do hệ điều hành cấp để tránh xung đột trong CI. Browser/CLI được kiểm tra riêng tại **3001/3002**.

Các test tạo schema tạm riêng trong database rồi xóa sau khi xong. Chạy lại khi DB sẵn sàng:

```powershell
npm ci
npm run check
npm test
```

Hoặc:

```powershell
docker compose --profile test run --build --rm tests
```

Lệnh Docker được cung cấp để bạn chạy tại máy có Engine; nó chưa được chạy trong môi trường chuẩn bị này.

## 11 nhóm kiểm tra trình duyệt

| Kiểm tra | Kết quả |
| --- | --- |
| Các client độc lập tải HTTP history và mở WS | Đạt |
| HTTP thường ngoài localhost không có randomUUID, vẫn gửi được qua fallback getRandomValues | Đạt |
| Hai listener native 3001/3002 chia sẻ cùng backend | Đạt |
| An → Bình → An, frame send/new thật, tách alpha/beta | Đạt |
| Hai URL localhost:3001/?user=An và localhost:3002/?user=Binh mở đúng frontend/WS, cùng history | Đạt |
| F5 giữ hai tin và có CACHE HIT | Đạt |
| Bình offline 5 giây; An online; reconnect không sót/trùng khi HTTP/WS đến đồng thời | Đạt |
| Giao diện 1440 px và 375 px không tràn ngang | Đạt |
| HTML được hiển thị như text, không thực thi | Đạt |
| Tìm kiếm không dấu, Enter gửi và Shift+Enter xuống dòng | Đạt |
| Đổi tên qua hộp thoại và reconnect | Đạt |

URL WS đã quan sát:

- `ws://localhost:3001/ws?user=An&channel=C_alpha`.
- `ws://localhost:3002/ws?user=Binh&channel=C_alpha`.

Trong lượt HTTP thường, browser dùng domain thử nghiệm qua proxy nội bộ, trỏ tới hai listener native. Đã xác nhận `isSecureContext=false` và `crypto.randomUUID` không có. Lượt localhost dùng hai URL chính của README, với secure context của loopback.

Ảnh `docs/screenshot.png` được chụp lại từ ứng dụng bản 1.3.0 sau reconnect, múi giờ Asia/Ho_Chi_Minh. Các kiểm tra browser/CLI là công việc xác minh lúc chuẩn bị gói; `npm test` chỉ chạy 12 integration test backend.

## Hai cấu hình khởi động CLI

1. **Node trực tiếp:** không đặt PORT/PORTS, CLI mặc định mở 3001 và 3002; cả hai health thành công, READY hiển thị đúng hai URL. SIGTERM dừng app.
2. **Nhánh cấu hình dùng trong Docker:** chạy Node với PORT=3000 và hai URL public 3001/3002; health listener nội bộ và log READY đúng. Đây là kiểm tra logic khởi động bằng Node, không phải chạy container.

## Kiểm tra tài liệu và cấu hình

Đã kiểm tra 9 file Markdown, liên kết/anchor nội bộ, code fence, version package/lock và hai URL frontend. Hướng dẫn hiện hành không dùng localhost:3000 làm URL của An/Bình.

Đã kiểm tra cấu trúc YAML: compose.yml và compose.two-ports.yml có cùng cấu hình app/db/tests; app publish 3001 và 3002 tới target 3000; DB publish 5432 trên localhost; cả hai cấu hình có service tests. Hai URL READY trong Compose khớp README.

## Giới hạn xác minh

Môi trường chuẩn bị không có Docker daemon, nên **chưa chạy image Docker, docker compose build/up hoặc docker compose config**. Chưa chạy lệnh PowerShell/Windows firewall trên máy của bạn, chưa kiểm tra hai máy vật lý hoặc Wi-Fi/LAN thực tế.

GitHub Actions được cung cấp nhưng chưa xác minh lượt workflow trên repo GitHub của bạn. Chưa đánh giá tải lớn, nhiều backend process hay đăng nhập/phân quyền vì ngoài phạm vi demo.

Dùng [DEMO_SCRIPT.md](DEMO_SCRIPT.md) để kiểm tra thủ công sau khi chạy; dùng [UPDATING.md](UPDATING.md) để cập nhật repo hiện tại.
