# v3.6.0 — Binance Spot, RSI v4.1, paper BTC

Chart, Watchlist, RSI 5 khung và mọi lệnh paper mới đều dùng **Binance Spot công khai**. Giữ nguyên bộ RSI 14 v4.1, ba nhóm Reversal/Momentum/Breakout, chỉ BTCUSDT và tối đa một lệnh mở. `1M` là một tháng.

REST dùng `https://data-api.binance.vision/api/v3/klines` và `/api/v3/ticker/24hr`; WebSocket dùng `wss://data-stream.binance.vision/stream`. Không cần Binance API key. Giá đóng tay/vào lệnh phải có thời gian hợp lệ; cloud quản lý TP/SL bằng nến Spot 1 phút đã đóng. SHORT vẫn là **mô phỏng theo biến động giá Spot**, không phải bán khống Spot thật.

## Cập nhật bản Cloudflare bạn đang dùng

1. Giải nén gói FULL vào một thư mục mới. Giữ đủ thư mục gốc và thư mục `cloudflare`, vì backend nhập các module ở thư mục cha.
2. Chép **`cloudflare/secrets.json` từ bản đang chạy** sang `cloudflare/secrets.json` của bản mới. Giữ nguyên file; không chạy setup để tạo lại khóa. Không đăng file này lên GitHub.
3. Mở PowerShell trong thư mục **`cloudflare` của bản mới**, chạy:

```powershell
npm ci
npm run deploy
```

Nếu đã chép đè toàn bộ mã mới vào thư mục cũ, giữ nguyên `secrets.json` và `node_modules`, có thể chạy thẳng `npm run deploy`. Chỉ đăng nhập lại bằng `npm run login` nếu Wrangler yêu cầu.

Tên Worker vẫn là `binance-signal-paper`, URL và Durable Object giữ nguyên. Không xóa Worker, không đổi tên/binding/migrations. Số dư, cấu hình, lịch sử, auto và đăng ký push trên cloud được giữ lại. Auto cũ đang TẮT vẫn giữ TẮT; cloud mới mặc định BẬT.

Deploy xong, script kiểm tra nến Spot từ **chính Durable Object trên Cloudflare**, rồi chờ đủ năm khung RSI. Thông báo tải Worker thành công riêng lẻ chưa xác nhận bot lấy được dữ liệu. Nếu chưa đủ dữ liệu, xem trạng thái app hoặc bấm **Kiểm tra Binance từ cloud**. Public `/health` phải có `version: 3.6.0`, `market: spot`; endpoint này chỉ xác nhận phiên bản API.

## Cập nhật GitHub Pages

Tải đè các file sau vào thư mục gốc repository, giữ thư mục `icons` hiện có:

```text
index.html
styles.css
app.js
sw.js
manifest.webmanifest
rsi-mtf.js
paper-trading.js
remote-paper.js
paper-ui.js
mobile-ui.js
```

Đợi Pages triển khai, đóng và mở lại app. Cài đặt phải hiện **v3.6.0**, đầu trang **SPOT WORKSPACE**, phần Paper ghi **SPOT**. Không xóa dữ liệu trình duyệt để làm mới cache. Nếu đã kết nối Worker cũ, giữ URL/mã kết nối. Cập nhật cả frontend và backend để nguồn giá thống nhất.

Nếu muốn lưu toàn bộ mã nguồn trên GitHub, có thể thêm `cloudflare`, `server`, `binance-market.js`, tests và các tài liệu. Tuyệt đối không tải `secrets.json`, `connection.txt`, `.env`, `.dev.vars`, `node_modules`, `.wrangler`, `dist` hoặc `server/data`. Các file backend không chạy bằng GitHub Pages; phải deploy Worker riêng bằng lệnh trên.

## Sổ cũ khi chuyển nguồn

- Vốn và lịch sử không bị reset. Watchlist/favorite/coin đang chọn được giữ khi chuyển từ Futures sang Spot.
- Lệnh cũ chưa có nhãn nguồn được đánh dấu **Futures (cũ)**; lệnh mới có nhãn **Spot** trong sổ, lịch sử và CSV.
- Nếu đang có vị thế Futures cũ, bot tiếp tục quản lý bằng dữ liệu Futures đến khi đóng. Không lấy giá Spot để đóng hoặc sửa PnL của vị thế đó. Nếu nguồn Futures vẫn bị chặn, vị thế giữ nguyên và báo lỗi; tối đa một lệnh mở nên chưa mở Spot mới. Không tự xóa vị thế để vượt qua lỗi.
- Nếu muốn chuyển sổ trình duyệt lên cloud trống, cần đóng vị thế Futures cũ trước. Lịch sử đã đóng vẫn nhập được. Cloud đã có lịch sử sẽ từ chối ghi đè.
- Cache RSI và thời gian chờ lỗi Futures cũ được làm mới một lần khi chuyển sang nguồn Spot; bot chờ tín hiệu xác nhận mới, không vào lại tín hiệu cũ.

## Chạy khi tắt điện thoại

Sau khi deploy thành công, kết nối app tới Worker hiện tại và kiểm tra trạng thái **Spot · đang chạy**. Đăng ký thông báo thiết bị và gửi thử một lần; iPhone cần mở app từ Màn hình chính và cho phép thông báo. Giữ nguyên khóa VAPID giúp duy trì đăng ký cũ. Quyền thông báo hệ điều hành cần người dùng cấp.

Spot công khai đã trả nến/giá khi kiểm tra từ môi trường phát triển. Khả năng lấy dữ liệu từ tài khoản Cloudflare của bạn được xác nhận bằng bước kiểm tra sau deploy. Nếu Spot cũng bị từ chối, bot giữ sổ, báo lỗi, lùi lịch thử; không tự đổi thị trường hoặc nguồn khác.

## Kiểm thử

Đã kiểm tra RSI/sổ lệnh, chuyển nguồn và giữ số dư/lịch sử, tách giá Futures cũ khỏi Spot mới, REST/WebSocket trên giao diện, BTC-only, auto lưu qua lần mở lại, đóng tay, catch-up TP/SL, API/cloud client và build Worker. Kiểm thử workerd/SQLite xác nhận alarm hoạt động không cần điện thoại polling, lưu qua eviction và mã hóa push; dữ liệu và dịch vụ push ở bài kiểm thử này được mô phỏng.

Tài liệu nguồn dữ liệu chính thức: [Binance Spot Market Data Only](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only).
