# Lịch sử thay đổi

## 1.3.0 — 09/10/2026

- Chuẩn hóa demo mặc định **một máy, An cổng 3001 và Bình cổng 3002**.
- compose.yml publish cả hai cổng tới cùng backend trong container; giữ compose.two-ports.yml để tương thích lệnh đã dùng.
- Node.js trực tiếp hỗ trợ PORTS=3001,3002, chia sẻ Express app, WebSocketServer, PostgreSQL và Map cache trong một process.
- Log READY hiển thị đúng hai URL frontend.
- Viết lại README, kịch bản, đối chiếu yêu cầu, kiến trúc, hai cổng và LAN theo cùng cấu hình.
- Thêm hướng dẫn cập nhật repository GitHub cũ.
- Bổ sung integration test cho broadcast/cache/history qua hai listener và giải phóng cả hai cổng khi dừng.

## 1.2.0 — 09/10/2026

- Thêm cấu hình compose.two-ports.yml cho An 3001/Bình 3002.
- Hỗ trợ HTTP qua IP LAN bằng fallback getRandomValues khi randomUUID không có.
- Thêm hướng dẫn LAN và kiểm tra hai cổng; cấu hình compose.yml chính vẫn dùng một cổng.

## 1.0.0 — 08/10/2026

- Demo HTTP history, WebSocket realtime theo kênh, PostgreSQL, Map cache, ACK/chống trùng và reconnect.
- Giao diện responsive, kịch bản yêu cầu Word, Docker Compose, integration test và GitHub Actions.

Hướng dẫn chạy: [README](README.md). Nâng cấp repo hiện tại: [UPDATING](docs/UPDATING.md).
