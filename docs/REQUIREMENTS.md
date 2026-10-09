# Đối chiếu yêu cầu demo

Nguồn nghiệp vụ: **[LTW] Demo bài TH.docx**, chức năng “Gửi tin nhắn realtime trong kênh”. Backend chọn phương án Node.js, Express, ws và PostgreSQL.

Bản **1.3.0** bổ sung cấu hình mặc định **một máy, hai cổng** theo yêu cầu trong trao đổi.

## Địa chỉ cần dùng

| Người dùng | URL |
| --- | --- |
| An | [http://localhost:3001/?user=An](http://localhost:3001/?user=An) |
| Bình | [http://localhost:3002/?user=Binh](http://localhost:3002/?user=Binh) |

## Yêu cầu và triển khai

| Yêu cầu | Phần thực hiện | Cách kiểm tra |
| --- | --- | --- |
| Demo một máy, An 3001 và Bình 3002 | compose.yml mặc định publish hai cổng; Node trực tiếp có PORTS=3001,3002 | Hai URL trên và hai request WS khác cổng |
| Một backend chung cho hai người | Một process, ChatService, Map cache và WebSocketServer | Gửi hai chiều; HTTP hai cổng đọc cùng lịch sử |
| Đọc user từ query | public/app.js và tham số WS; server gắn user vào socket | An/Bình hiện đúng tên |
| HTTP GET /api/channels/alpha/messages | Express route, ChatService.history | Network và X-Cache |
| CACHE MISS lần đầu, đọc DB | Map ban đầu rỗng, SELECT PostgreSQL | Đóng tab cũ, restart app, mở An trước |
| HTTP Upgrade → WebSocket 101 | Upgrade handler dùng chung và ws.handleUpgrade | Headers WS trên 3001/3002 |
| Gửi frame JSON message.send | Client gửi text frame qua /ws | Messages trong DevTools |
| PostgreSQL lưu tin | Driver pg, bảng messages, service db | SELECT bản ghi sau khi gửi |
| Cache bằng Map trong RAM | ChatService.cache | Log MISS/HIT/UPDATE |
| Lưu DB → cache → broadcast trong kênh | chat.save hoàn tất trước broadcast | Log pipeline và trang nhận |
| Broadcast có type, channel, ts, user, text | Event message.new | Frame nhận, cả An và Bình |
| Bảng có id, channel_id, user, text, ts | sql/schema.sql | Schema và response history |
| F5 dùng CACHE HIT, giữ lịch sử | Đọc Map sau gửi | F5 Bình ở 3002 |
| Reconnect và lấy tin bị lỡ, tùy chọn | Backoff, HTTP after, đệm frame khi đồng bộ | Offline/online riêng Bình |
| Một frontend HTML có ô chat | public/index.html, CSS và JavaScript | Cùng giao diện trên hai URL |

`ts` là cột generated được PostgreSQL lưu, dạng giây.microgiây từ `created_at` theo UTC. ID làm cursor đồng bộ; client không tự tạo timestamp của tin đã lưu.

## Bổ sung trong gói

Kênh beta để kiểm tra tách phòng, danh sách online, tìm kiếm, đổi tên, ACK và chống trùng, reconnect, Docker/Node, integration test và GitHub Actions.

History dùng HTTP; tin mới dùng WebSocket. sessionStorage chỉ giữ bản nháp. Tin đã xác nhận nằm trong PostgreSQL.

Xem [kịch bản demo](DEMO_SCRIPT.md), [kiến trúc](ARCHITECTURE.md) và [kiểm thử](TESTING.md).
