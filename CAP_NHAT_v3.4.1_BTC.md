# v3.4.1 — Paper Trading chỉ BTCUSDT

Paper chỉ mở lệnh BTCUSDT. Các coin khác vẫn có Watchlist, chart và RSI để xem. Chọn ETH/SOL hoặc xóa BTC khỏi Watchlist không đổi coin của bot, không đặt lại thời điểm bật bot. Bộ RSI vẫn là Momentum 5 khung hiện tại; bản này không chuyển sang v5.5.

## Nâng cấp bản Cloudflare đã cài

1. Giải nén **đè nội dung gói mới vào thư mục v3.4.0 đang dùng** trên máy Windows, nơi đang có `cloudflare/secrets.json`. Giữ nguyên `secrets.json` và `connection.txt`; gói mới không chứa và không ghi đè hai file này. Không xóa Worker, Durable Object hoặc tạo account/bot mới.
2. Mở PowerShell trong thư mục `cloudflare` đó, chạy:

```powershell
npm run deploy
```

Không cần chạy setup/login lại nếu đăng nhập cũ còn hiệu lực. Nếu giải nén sang thư mục khác, chép `cloudflare/secrets.json` từ thư mục cũ vào trước khi deploy để giữ mã kết nối và khóa push. Không đưa secrets lên GitHub.

3. Trên GitHub, cập nhật các file frontend ở thư mục gốc:

```
index.html
app.js
sw.js
paper-trading.js
paper-ui.js
```

Giữ các file frontend còn lại của v3.4.0. Gói FULL cũng có đủ toàn bộ frontend nếu cần tải đè. Chờ Pages deploy xong, đóng/mở lại app cho tới khi thấy **v3.4.1 · BTC Paper** trong Cài đặt. Không xóa dữ liệu trình duyệt.

4. Giữ URL `https://binance-signal-paper.tu1703vuive.workers.dev` và mã kết nối hiện có. Kiểm tra `/health` phải trả phiên bản `3.4.1`. Chuyển chart sang ETH/SOL và kiểm tra Paper vẫn hiển thị **Chỉ BTCUSDT**.

## Sổ và lệnh cũ

- Lịch sử, số dư, cấu hình phí/SL/TP, tùy chọn auto và đăng ký push được giữ lại.
- Nếu trạng thái cũ đang theo dõi coin khác, máy chủ tự chuyển mục tiêu lệnh mới sang BTC khi nâng cấp. Bot chờ tín hiệu BTC mới sau thời điểm chuyển, không vào lại tín hiệu cũ.
- Nếu đã có vị thế coin khác từ trước, bot giữ và quản lý vị thế đó đến khi đóng, hoặc bạn đóng tay. Nó không xóa lệnh, hoàn tiền hoặc đổi tên lệnh thành BTC. Sau đó chỉ mở BTC. Giao diện ghi rõ trường hợp này.
- Chuyển sổ cục bộ lên cloud: sổ có lệnh coin khác đang mở sẽ bị từ chối; đóng vị thế ở sổ cũ trước. Lịch sử coin khác đã đóng vẫn được giữ nguyên.

## Phạm vi thực thi và kiểm tra

Chính sách BTC được kiểm tra trong module sổ lệnh dùng chung, API máy chủ Node và API Cloudflare. API đổi coin sang ETH/SOL bị từ chối ngay cả khi dùng frontend cũ. Frontend mới không gửi yêu cầu đổi coin khi chọn chart.

Ở chế độ trình duyệt, BTC luôn có luồng ticker và đủ 5 khung nến riêng khi bạn xem chart coin khác; dữ liệu/ảnh chart vẫn theo coin đang chọn. Khi kết nối cloud, cloud là nơi thực hiện paper.

Đã kiểm tra: BTC mở/đóng lệnh khi đang xem ETH và đã xóa BTC khỏi Watchlist; tín hiệu ETH không mở lệnh hoặc đổi số dư; đổi chart không đổi mục tiêu/arming của máy chủ; API chặn coin khác; chuyển trạng thái cũ sang BTC không mất sổ; alarm, SQLite và push trên workerd cục bộ. Chưa triển khai bản v3.4.1 vào tài khoản của bạn; thực hiện bước nâng cấp trên để áp dụng.
