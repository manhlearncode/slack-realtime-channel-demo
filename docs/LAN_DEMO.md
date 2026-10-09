# Tùy chọn: hai máy trong LAN, vẫn dùng cổng 3001/3002

Demo chính trong [README](../README.md) chạy **một máy**. Tài liệu này dành cho lúc cần chuyển sang hai máy; địa chỉ truy cập vẫn là **An 3001, Bình 3002**.

| Máy | Vai trò |
| --- | --- |
| A | Chạy backend/DB, đồng thời mở trình duyệt An |
| B | Mở trình duyệt Bình tới server A |

Hai máy cần cùng mạng có route tới nhau. Ví dụ IPv4 của A là **192.168.1.10**; thay bằng IPv4 Wi-Fi/Ethernet thực tế của A.

## Chạy server trên A

Bật Docker Desktop. Trong PowerShell tại thư mục dự án:

```powershell
docker info
$env:APP_BIND_IP = "0.0.0.0"
docker compose up --build -d
docker compose ps
ipconfig
```

Compose publish hai cổng 3001/3002 trên các interface của A. Lấy IP ở adapter Wi-Fi/Ethernet đang kết nối mạng chung. APP_BIND_IP chỉ có hiệu lực trong terminal hiện tại; có thể lưu giá trị vào .env nếu muốn giữ cấu hình.

Mở PowerShell **Run as administrator** trên A, tạo rule một lần:

```powershell
New-NetFirewallRule -Name "SlackRealtimeDemoTwoPorts" -DisplayName "Slack Realtime Demo TCP 3001 3002" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001,3002 -RemoteAddress LocalSubnet -Profile Any
```

Nếu rule đã tồn tại: `Enable-NetFirewallRule -Name "SlackRealtimeDemoTwoPorts"`. Database 5432 vẫn publish trên localhost của A.

## Mở trình duyệt

| Người dùng | URL minh họa |
| --- | --- |
| An trên A | [http://192.168.1.10:3001/?user=An](http://192.168.1.10:3001/?user=An) |
| Bình trên B | [http://192.168.1.10:3002/?user=Binh](http://192.168.1.10:3002/?user=Binh) |

IP client của hai máy có thể khác nhau; cả hai URL dùng IP server A, với hai cổng riêng. `localhost` trên B trỏ tới B. Bình dùng trình duyệt, không chạy thêm backend độc lập.

Trên B Windows:

```powershell
Test-NetConnection 192.168.1.10 -Port 3002
```

Cần thấy `TcpTestSucceeded : True`. Trên A kiểm tra /health ở cổng 3001/3002. Giao diện HTTP qua IP dùng getRandomValues để sinh ID nếu randomUUID không có.

## Node.js trực tiếp

Chạy DB và cài dependency theo README, dừng app Docker trước. Đặt `HOST=0.0.0.0` và `PORTS=3001,3002`, sau đó chạy `npm start`. Dùng cùng rule firewall và hai URL IP ở trên.

## Thao tác và xử lý lỗi

Gửi An → Bình → An, F5 Bình rồi kiểm tra WS 101 như [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Để thử reconnect, ngắt mạng chỉ trên B; An vẫn gửi. B nối mạng lại sẽ đồng bộ tin.

| Hiện tượng | Kiểm tra |
| --- | --- |
| A không vào được localhost:3001/3002 | Engine, compose ps, log app/db, cổng bị chiếm |
| A vào được, B không vào được | APP_BIND_IP, IP của A, firewall, route giữa hai máy |
| Test-NetConnection False | IP/cổng, VPN hoặc Wi-Fi có client isolation |
| Trang mở nhưng WS không kết nối | Network WS, log app, proxy Upgrade |
| Hai người không thấy tin nhau | Cùng server A, cùng alpha; kiểm tra WS BROADCAST |
| IP của A đổi | Cập nhật hai URL bằng IP mới |

Khi trở về demo một máy:

```powershell
$env:APP_BIND_IP = "127.0.0.1"
docker compose up -d app
```

Nếu lưu APP_BIND_IP trong .env, sửa về 127.0.0.1. Có thể tắt rule bằng PowerShell admin: `Disable-NetFirewallRule -Name "SlackRealtimeDemoTwoPorts"`.

Hai mạng Internet khác nhau cần server mà cả hai truy cập được hoặc mạng riêng có route phù hợp.

Tham khảo: [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), [Windows firewall](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule), [MDN getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).
