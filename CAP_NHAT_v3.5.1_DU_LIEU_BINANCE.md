# v3.5.1 — trạng thái dữ liệu và chẩn đoán Binance từ Cloudflare

Ảnh lỗi `Cloudflare 24/7 · BTCUSDT · Binance HTTP 403` cho biết API Cloudflare kết nối được, nhưng Binance từ chối yêu cầu dữ liệu của bot. RSI trên điện thoại được lấy trực tiếp theo kết nối riêng, nên vẫn có số dù bot cloud đang lỗi.

**Bản này sửa trạng thái hiển thị, ghi lại thông điệp upstream và giảm gọi lại khi bị chặn. Nó không đảm bảo gỡ được HTTP 403 của Binance.** Theo tài liệu Binance Futures, 403 là WAF, 429 là giới hạn tần suất, 418 là IP bị tạm khóa. Cần đọc đúng thông điệp trả về từ Cloudflare để xác định chi tiết; riêng ảnh 403 không đủ để kết luận nguyên nhân cụ thể của việc chặn.

## Cách cập nhật

1. Giải nén đè nội dung ZIP mới vào thư mục v3.5.0 đã cài thành công, giữ `cloudflare/secrets.json`, `connection.txt` và `node_modules` hiện có. Nếu giải nén sang thư mục mới: chép `cloudflare/secrets.json` cũ sang và chạy `npm ci` trong thư mục `cloudflare` mới trước khi deploy.
2. Trong thư mục `cloudflare`, chạy:

```powershell
npm run deploy
```

3. Cập nhật các file frontend ở gốc GitHub Pages:

```
index.html
styles.css
app.js
sw.js
remote-paper.js
paper-ui.js
```

Giữ các file còn lại từ v3.5.0. Nếu cần, gói FULL chứa toàn bộ frontend. File mới `binance-market.js` phải có ở **thư mục gốc trên máy tính khi deploy**, vì backend Cloudflare nhập module đó để đóng gói. Frontend không tải module transport này nên không cần thêm nó vào GitHub Pages.

4. Đợi Pages cập nhật, đóng/mở lại app. Kiểm tra phiên bản **v3.5.1 · RSI v4.1 · BTC**, và `/health` của Worker trả phiên bản `3.5.1`.
5. Vào **Paper Trading → Cài đặt & thông báo → Chạy 24/7 & thông báo đẩy → Kiểm tra Binance từ cloud**. Gửi lại ảnh phần kết quả nếu vẫn lỗi. Không gửi `secrets.json`, mã kết nối hoặc khóa push.

## Những gì thay đổi

- Đèn cloud đỏ khi dữ liệu bot lỗi, vàng khi khởi động/khôi phục hoặc auto tắt, xanh khi API kết nối, dữ liệu bot đang hoạt động và auto bật. Realtime ở đầu trang vẫn thể hiện kết nối thị trường của điện thoại.
- Ghi HTTP status, nhóm lỗi, endpoint công khai và thông điệp trả về từ Binance. Thông điệp có giới hạn độ dài, hiển thị như văn bản, không thực thi HTML. Chỉ người có mã kết nối mới xem được chẩn đoán.
- Khi kiểm tra 5 khung, gọi một khung trước. Nếu bị chặn ngay thì không tiếp tục gửi cả bốn yêu cầu còn lại.
- HTTP 403 hoặc IP bị khóa: chờ ít nhất 15 phút. HTTP 429: ít nhất 60 giây. Thông điệp hạn chế điều kiện truy cập/HTTP 451: ít nhất một giờ. Tôn trọng `Retry-After` dài hơn các mức trên. Đây là lịch thử lại của ứng dụng, không phải thời gian Binance cam kết gỡ chặn.
- Nút kiểm tra lấy nến BTC 15m ngay từ Durable Object; dùng lại phản hồi lỗi đang trong thời gian chờ để tránh gọi dồn. Nó không thay số dư, lịch sử hay tùy chọn auto. Một nến thử thành công chưa chứng minh đủ cả 5 khung; bot phải đồng bộ và kiểm tra lại trước khi tiếp tục.
- Không thay nguồn Futures bằng Spot, testnet, proxy hoặc nhà cung cấp khác; không đổi chiến lược RSI v4.1, SL/TP, số tiền lệnh, khóa, vị thế hay lịch sử. Không tạo lệnh hoặc giá thoát khi thiếu dữ liệu.

## Đọc kết quả

| Kết quả | Ý nghĩa / bước tiếp |
|---|---|
| 200, lấy được nến thử | Đợi bot kiểm tra đủ dữ liệu rồi xác nhận trạng thái đang chạy; kiểm tra thông báo thử |
| 403 / WAF_BLOCK | Binance đang từ chối yêu cầu từ bot. Đọc thông điệp chi tiết, chờ lịch thử lại; nếu kéo dài, liên hệ Binance về truy cập API từ hạ tầng này |
| 451 hoặc ACCESS_RESTRICTED | Binance nêu hạn chế điều kiện truy cập. Không tự xoay miền/IP; cần phương án nguồn dữ liệu hoặc hạ tầng được nhà cung cấp cho phép |
| 429 / RATE_LIMIT hoặc 418 / IP_BANNED | Dừng gọi dồn, tôn trọng thời gian chờ; kiểm tra các ứng dụng khác dùng chung nguồn truy cập |
| Lỗi DNS/TLS/timeout | Kiểm tra kết nối máy chủ; chưa có bằng chứng dữ liệu thị trường hoạt động |

Không cần đổi bộ RSI hoặc tạo Binance API key để giải quyết một lỗi WAF trên endpoint nến công khai. Cập nhật ứng dụng không có quyền gỡ chặn phía nhà cung cấp.

## Kiểm thử

32 kiểm thử lõi/API Node/transport, 11 kiểm thử runner Cloudflare, kiểm thử workerd/SQLite/alarm/push và kiểm tra giao diện đều đạt. Kiểm tra 403/451/429/418, `Retry-After`, giới hạn đọc thông điệp, không đổi miền, không sửa sổ khi lỗi và chống gọi kiểm tra dồn. Workerd sử dụng nhà cung cấp dữ liệu/push mô phỏng; chưa kiểm chứng quyền truy cập Binance từ tài khoản Cloudflare của bạn sau khi nâng cấp.

Tài liệu chính thức: https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info
