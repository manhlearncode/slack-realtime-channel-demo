# Demo một máy, An cổng 3001 và Bình cổng 3002

Bản **1.3.0** mặc định dùng hai cổng. Mở hai cửa sổ trên cùng máy:

| Người dùng | Frontend | WebSocket tự mở |
| --- | --- | --- |
| An | [http://localhost:3001/?user=An](http://localhost:3001/?user=An) | `ws://localhost:3001/ws?user=An&channel=C_alpha` |
| Bình | [http://localhost:3002/?user=Binh](http://localhost:3002/?user=Binh) | `ws://localhost:3002/ws?user=Binh&channel=C_alpha` |

Cả hai mặc định ở alpha. Tên `Binh` trong URL là tên dùng cho phiên demo của Bình.

## Chạy bằng Docker

Bật Docker Desktop. Trong PowerShell tại thư mục có `compose.yml`:

```powershell
docker info
$env:APP_BIND_IP = "127.0.0.1"
docker compose up --build -d
docker compose ps
```

Mở hai URL trên sau khi app sẵn sàng. Xem log bằng `docker compose logs -f app`.

Compose publish 3001 và 3002 của máy host tới cổng 3000 trong **cùng container app**. Vì vậy hai trang dùng cùng DB, Map cache và danh sách socket của backend.

File `compose.two-ports.yml` vẫn được giữ để tương thích:

```powershell
docker compose -f compose.two-ports.yml up --build -d
```

Nếu chọn file tương thích, thêm cùng `-f compose.two-ports.yml` khi xem log, restart hoặc down. `compose.yml` là cấu hình chính và đã có hai cổng; hướng dẫn hiện tại không yêu cầu thêm `-f`.

## Chạy bằng Node.js

Làm theo [README](../README.md#chạy-bằng-nodejs-để-sửa-code). `PORTS=3001,3002` mở hai HTTP listener trong cùng process Node.js. Hai listener dùng cùng Express app và WebSocketServer; chỉ có một ChatService kết nối database và giữ cache.

Một trang mở ở cổng 3001 và trang còn lại ở 3002 vẫn gửi/nhận được tin vì backend broadcast theo kênh, không chia phòng theo cổng.

## Luồng giao tiếp

1. An GET history qua 3001, Bình GET history qua 3002.
2. Mỗi trang mở WebSocket tại `/ws` trên đúng host/cổng đang truy cập.
3. An gửi `message.send` qua socket của An.
4. Backend kiểm tra, lưu DB, cập nhật cache rồi broadcast `message.new` tới mọi socket trong alpha, gồm Bình và An.
5. Backend gửi `message.ack` về người gửi. Bình trả lời theo cùng luồng.

**Socket An → backend chung → socket Bình.** Cổng 3001/3002 là cổng server mà trình duyệt truy cập; mỗi trình duyệt là một client với kết nối riêng.

## Minh chứng khi thuyết trình

1. Mở F12 → Network → WS trên cả hai cửa sổ, tải lại trang.
2. An có request WS cổng **3001**, Bình có request WS cổng **3002**, cùng status **101 Switching Protocols**.
3. An gửi `Chào Bình!`: frame `message.send` ở An, `message.new` ở Bình; Bình thấy tin ngay.
4. Bình gửi `Chào An!`: An thấy tin ngay.
5. F5 trên Bình: history còn, header `X-Cache: HIT`.
6. Terminal có `WS BROADCAST ... recipients=2` khi chỉ mở đúng hai socket trong alpha.

Kịch bản đầy đủ: [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Hai máy trong LAN là tùy chọn: [LAN_DEMO.md](LAN_DEMO.md).

## Dừng và cập nhật

```powershell
docker compose down
```

Volume DB được giữ khi down không kèm `-v`. Để cập nhật repo đã đăng GitHub, làm theo [UPDATING.md](UPDATING.md).
