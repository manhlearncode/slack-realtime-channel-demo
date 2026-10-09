# Kịch bản demo realtime — An 3001, Bình 3002

Demo mặc định trên **một máy**, hai cửa sổ trình duyệt và một terminal log. Giữ 7 bước chức năng trong **[LTW] Demo bài TH.docx**, với hai địa chỉ riêng:

- An: [http://localhost:3001/?user=An](http://localhost:3001/?user=An).
- Bình: [http://localhost:3002/?user=Binh](http://localhost:3002/?user=Binh).

## Chuẩn bị trước khi trình bày

Bật Docker Desktop, chạy trong thư mục có `compose.yml`:

```powershell
$env:APP_BIND_IP = "127.0.0.1"
docker compose up --build -d
docker compose logs -f app
```

Để quan sát lần đọc CACHE MISS, đóng các trang demo cũ, chạy `docker compose restart app`, rồi mở An trước. Restart app xóa Map và giữ lịch sử PostgreSQL. Nếu cần lịch sử rỗng, reset theo [README](../README.md#dừng-mở-lại-và-reset-lịch-sử) trước buổi demo.

Mở F12 → Network trước khi tải trang. Bật Preserve log và chuẩn bị bộ lọc WS.

## Bảy bước

| Bước | Thao tác | Minh chứng | Lời dẫn |
| --- | --- | --- | --- |
| 1 | An mở 3001; sau đó Bình mở 3002, theo hai URL ở trên | GET `/api/channels/alpha/messages`; GET đầu của An có CACHE MISS | “Hai client tải lịch sử từ cùng backend. Cache rỗng thì server đọc PostgreSQL.” |
| 2 | Chọn request WS trên cả hai cửa sổ | An dùng 3001, Bình dùng 3002; status 101 | “Mỗi client mở một kết nối WebSocket riêng để trao đổi liên tục.” |
| 3 | An nhập `Chào cả nhóm!` rồi Enter | Socket An gửi frame `message.send` | “An gửi tin qua WebSocket.” |
| 4 | Chỉ sang Bình và terminal | Bình thấy tin ngay; log DB INSERT → CACHE UPDATE → WS BROADCAST | “Backend lưu DB, cập nhật cache rồi phát tin tới các socket trong kênh.” |
| 5 | Bình nhập `Đã nhận!` rồi Enter | An thấy trả lời; socket Bình gửi message.send và An nhận message.new | “Hai kết nối trao đổi theo hai chiều qua cùng backend.” |
| 6 | Bình F5 | Lịch sử còn; HTTP có X-Cache: HIT, log CACHE HIT | “Lịch sử đã được lưu, lần đọc này lấy từ cache.” |
| 7, tùy chọn | Cho riêng trang Bình offline khoảng 5 giây, An gửi thêm tin, rồi cho Bình online | Bình reconnect và nhận tin bị lỡ | “Khi kết nối trở lại, client đồng bộ các tin sau ID cuối đã nhận.” |

Sau mỗi lần WS mở, client đọc thêm HTTP history với cursor `after` để tránh khoảng trống giữa tải lịch sử và kết nối realtime. Vì vậy log có thể có thêm CACHE HIT xen giữa các bước.

## Quan sát hai socket

| Trang | Request URL cần quan sát |
| --- | --- |
| An | `ws://localhost:3001/ws?user=An&channel=C_alpha` |
| Bình | `ws://localhost:3002/ws?user=Binh&channel=C_alpha` |

Trong Headers, tìm **101 Switching Protocols**. Trong Messages/Frames, tìm `message.send`, `message.new`, `message.ack`. Các frame `connection.ready` và `presence` là thông tin kết nối/online.

Khung gửi minh họa từ An:

```json
{
  "type": "message.send",
  "channel": "C_alpha",
  "user": "An",
  "text": "Chào cả nhóm!",
  "client_msg_id": "c-demo-an-001"
}
```

ID trên chỉ minh họa cấu trúc; frontend thực tế sinh ID mới cho từng tin. ID và thời gian của message.new do backend/DB cung cấp.

## Offline trên một máy

Ở DevTools **của riêng Bình**, mở Network conditions và chọn Offline. Giữ An online; chờ Bình hiện **Mất kết nối**, cho An gửi tin, rồi sau khoảng 5 giây đưa Bình về No throttling/Online.

Một số phiên bản DevTools giữ WS cũ khi đổi throttling. Nếu trang Bình vẫn báo đã kết nối, giữ chế độ Offline và chạy `socket.close()` trong Console của Bình để đóng WS hiện tại. Đây là thao tác hỗ trợ demo; dùng đúng cửa sổ Bình. Khi trở lại Online, client tự kết nối và đồng bộ. Không tải lại trang trong lúc đang offline.

Nếu trình duyệt không mô phỏng được việc ngắt riêng trang, bỏ bước tùy chọn này; sáu bước đầu vẫn là demo đầy đủ cho HTTP history, WS và cache. Các kiểm tra tự động có xác minh reconnect bằng browser context riêng; xem [TESTING.md](TESTING.md).

## Kiểm tra bổ sung

- Mở [Khách ở beta](http://localhost:3001/?user=Khach&channel=beta), An/Bình gửi trong alpha; Khách không nhận tin alpha.
- Restart app: hai trang tự reconnect, DB vẫn giữ lịch sử.
- Mở psql theo [README](../README.md#kịch-bản-và-minh-chứng-demo) để chỉ ra bản ghi messages.

Giải thích backend chung và hai cổng: [TWO_PORTS_DEMO.md](TWO_PORTS_DEMO.md).
