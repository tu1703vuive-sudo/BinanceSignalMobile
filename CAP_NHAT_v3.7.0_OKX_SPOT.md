# v3.7.0 — chuyển sang OKX Spot

Chart, Watchlist, RSI 5 khung và lệnh paper mới cùng dùng **OKX Spot**. Bot vẫn chỉ giao dịch giả BTC, tối đa một lệnh mở, dùng **RSI 14 v4.1** với Reversal/Momentum/Breakout. Bộ quy tắc RSI được giữ nguyên.

`BTCUSDT` trong giao diện tương ứng `BTC-USDT` Spot trên OKX. Các khung là 15m, 1H, 4H, **1Dutc và 1Mutc**; `1M` là tháng, mở lúc 00:00 UTC. Giá/RSI OKX có thể khác Binance. LONG/SHORT đều là mô phỏng 1× theo giá Spot; không gửi lệnh thật hoặc cần API key sàn.

## 1. Cập nhật Cloudflare hiện có

1. Giải nén gói FULL vào thư mục mới. Giữ đủ các file ở thư mục gốc và thư mục `cloudflare`; backend cần các module ở thư mục cha.
2. Chép **`cloudflare/secrets.json` của bản đang chạy** sang đúng vị trí trong bản mới. Giữ nguyên khóa để duy trì mã kết nối và đăng ký push.
3. Mở PowerShell trong thư mục **`cloudflare` mới**, chạy:

```powershell
npm ci
npm run deploy
```

Không cần chạy setup tạo khóa mới. Nếu Wrangler yêu cầu đăng nhập lại, chạy `npm run login` rồi deploy. Worker vẫn tên `binance-signal-paper` và giữ nguyên URL, Durable Object, sổ lệnh. Không xóa Worker hoặc đổi tên/binding/migrations.

Deploy xong, script kiểm tra nến OKX từ **chính Durable Object của bạn**, rồi chờ bot đồng bộ đủ năm khung RSI. Nếu in thông báo chưa đủ dữ liệu, xem trạng thái trong app; upload thành công riêng lẻ chưa xác nhận dữ liệu thị trường hoạt động. Có thể bấm **Kiểm tra OKX từ cloud** khi hết thời gian chờ. `/health` có `version: 3.7.0`, `exchange: okx`, `priceSource: okx-spot`; endpoint này chỉ xác nhận phiên bản backend.

## 2. Cập nhật GitHub Pages

Tải đè **12 file** sau vào thư mục gốc repository `tu1703vuive-sudo/BinanceSignalMobile`, giữ thư mục `icons` hiện có:

```text
index.html
styles.css
app.js
sw.js
manifest.webmanifest
binance-market.js
market-data.js
rsi-mtf.js
paper-trading.js
remote-paper.js
paper-ui.js
mobile-ui.js
```

Hai file `binance-market.js` và `market-data.js` bắt buộc phải có. File Binance được giữ để quản lý đúng nguồn của lệnh cũ; mọi dữ liệu và lệnh mới dùng OKX.

Đợi Pages triển khai xong, đóng và mở lại app. Đầu trang phải ghi **OKX SPOT WORKSPACE**, cài đặt **v3.7.0**, Paper **OKX SPOT**. Giữ URL/mã kết nối hiện có. Cập nhật cả frontend và backend. Không xóa dữ liệu trình duyệt để làm mới cache.

Không tải `secrets.json`, `connection.txt`, `.env`, `.dev.vars`, `node_modules`, `.wrangler`, `dist`, SQLite hoặc `server/data` lên GitHub. Các file backend không chạy bằng GitHub Pages; cần deploy riêng bằng lệnh ở bước 1.

## 3. Dữ liệu cũ được giữ thế nào?

- Giữ vốn, cấu hình phí/SL/TP/giá trị lệnh, lịch sử, trạng thái auto và đăng ký push. Nếu bạn từng tắt auto, bản mới tiếp tục giữ TẮT; cloud mới mặc định BẬT.
- Giữ Watchlist, favorite và coin đang chọn khi chuyển nguồn. Coin không được OKX hỗ trợ sẽ không có dữ liệu; có thể quản lý trong Watchlist.
- Lệnh mới ghi nhãn **OKX Spot** trong lịch sử, CSV và thông báo. Lệnh Binance Spot/Futures cũ giữ nhãn và nguồn tương ứng.
- Vị thế Binance cũ đang mở tiếp tục dùng dữ liệu Binance cho TP/SL và đóng tay. Không lấy giá OKX để đóng, sửa PnL hay xóa vị thế đó. Nếu Binance vẫn từ chối, bot giữ lệnh, báo lỗi và chưa mở thêm OKX vì chỉ cho phép một vị thế.
- Sổ trình duyệt có vị thế khác nguồn cần đóng đúng nguồn trước khi nhập lên cloud trống. Cloud đã có lịch sử sẽ từ chối ghi đè.
- Cache RSI và thời gian chờ lỗi Binance cũ được xóa một lần khi chuyển nguồn, không xóa sổ. Bot chờ tín hiệu xác nhận mới; không vào lại tín hiệu cũ đang hiển thị.

## 4. Giá, lịch chạy và thông báo

REST chính: `https://openapi.okx.com/api/v5/market/`. WebSocket ticker: `wss://ws.okx.com/ws/v5/public`; nến: `wss://ws.okx.com/ws/v5/business`. Chỉ dùng API dữ liệu công khai; không tự đổi nguồn khi có lỗi.

Nến OKX được sắp từ cũ đến mới, phân trang tối đa 300 nến/lần. Khung tháng theo lịch UTC; nến đã hết thời gian nhưng chưa được OKX xác nhận sẽ chặn tín hiệu. Giá vào/đóng tay và tick thực thi phải có timestamp còn mới. Message nến WebSocket không có timestamp của giá nên chỉ cập nhật biểu đồ/RSI, không tự dùng làm giá thực thi.

Cloudflare tiếp tục quản lý TP/SL bằng **nến đóng 1 phút**, khôi phục lịch sử theo từng đoạn, bảo thủ tính SL trước nếu cả SL/TP cùng chạm trong một nến. Không có lệnh: kiểm tra khi nến 15m đóng; có lệnh: kiểm tra sau phút đóng. Cron watchdog mỗi 5 phút. App đồng bộ sổ khi đang mở; bot đã deploy vẫn chạy khi đóng app. Lỗi upstream/hạn mức vẫn có thể làm gián đoạn; không bảo đảm hoạt động liên tục cả tháng.

Giữ khóa VAPID giúp giữ đăng ký push. Mở app kiểm tra thông báo thử; iPhone cần mở từ Màn hình chính và cấp quyền. Quyền hệ điều hành cần người dùng cho phép một lần.

## Kiểm thử trước bàn giao

- Nguồn OKX thật từ môi trường phát triển: đủ 107 nến tháng, 450 nến mỗi khung còn lại, giá BTC có timestamp và đoạn lịch sử 350 phút liên tục. Đã kiểm tra header CORS cho origin GitHub Pages của bạn.
- Kiểm thử tự động: phân trang 450/1.000 nến, UTC, trạng thái xác nhận nến, API error code dù HTTP 200, timestamp giá, không trộn nguồn Binance cũ với OKX mới, BTC-only và giữ auto/sổ.
- workerd/SQLite: alarm hoạt động không cần điện thoại hỏi API, lưu sau eviction, API xác thực/CORS và mã hóa push. Dữ liệu/push trong bài kiểm thử runtime được mô phỏng.
- Chưa triển khai vào tài khoản Cloudflare của bạn. Bước kiểm tra sau deploy mới xác nhận đường kết nối OKX từ Worker thực tế và cần kiểm tra thông báo trên điện thoại của bạn.

Tài liệu chính thức: [OKX API v5](https://www.okx.com/docs-v5/en/).
