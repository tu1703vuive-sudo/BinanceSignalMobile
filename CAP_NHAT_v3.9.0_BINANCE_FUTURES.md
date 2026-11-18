# Signal v3.9.0 — Binance Futures

Đã bỏ Paper Trading, sổ lệnh, tự vào lệnh, thông báo lệnh và phần kết nối máy chủ khỏi app. Còn Watchlist, Chart, RSI 14 năm khung và phân tích Short/Swing nâng cao. Dữ liệu lấy trực tiếp từ Binance USDⓈ-M Futures USDT. App không cần API key, tài khoản giao dịch, Vercel hay Cloudflare để xem dữ liệu.

## Cập nhật GitHub Pages

1. Giải nén gói FULL. Mở thư mục **GITHUB_UPLOAD**.
2. Vào repo `tu1703vuive-sudo/BinanceSignalMobile` → **Add file → Upload files**. Kéo **nội dung bên trong GITHUB_UPLOAD** vào gốc repo, chọn **Commit changes**. Không tải cả thư mục thành `repo/GITHUB_UPLOAD`.
3. Đợi GitHub Pages build xong. Đóng/mở app trên điện thoại, hoặc mở trang trong Safari rồi làm mới. Cài đặt cần hiện **v3.9.0 · Binance Futures · RSI v4.1**.
4. Thanh dưới chỉ còn **Watchlist / Chart / RSI**. Cài đặt không còn phần kết nối bot. Không phải chạy `npm ci` hay deploy backend cho app mới.

Service worker mới đổi cache, bỏ tài nguyên bot khỏi app và hủy đăng ký push cũ trên thiết bị sau khi bản mới được kích hoạt. Watchlist, yêu thích và coin đang chọn được chuyển sang namespace Futures; không trộn cache nến Spot với Futures. Dữ liệu sổ cũ trong trình duyệt không bị xóa; bản mới không đọc hoặc chạy sổ đó.

## Dừng bot Cloudflare đã deploy trước đây

**Chỉ cập nhật GitHub Pages không dừng Worker cũ.** App mới không điều khiển Worker đó nữa.

Trong gói FULL có **DUNG_BOT_CU_WINDOWS.cmd**. Chạy file này một lần trên máy Windows đã đăng nhập Wrangler trước đây. Script triển khai bản dừng vào đúng Worker **binance-signal-paper**, gỡ cron, hủy alarm của tài khoản hiện có và bỏ mọi đường chạy tính lệnh/gửi push/gọi Vercel. Giữ nguyên namespace và dữ liệu lịch sử cũ, không tạo bot mới. Cần máy có Node/npm như lúc deploy bản v3.8.0.

Nếu Wrangler yêu cầu đăng nhập, dùng `npx wrangler@4.163.0 login`, đăng nhập đúng tài khoản Cloudflare cũ, rồi chạy lại file CMD.

Khi script báo **DA XAC NHAN**, hoặc mở `https://binance-signal-paper.tu1703vuive.workers.dev/health` thấy `stopped: true`, bot cũ đã dừng. Nếu script lỗi trước khi deploy thành công thì chưa thể xác nhận dừng bot. Không tải các file secrets lên GitHub.

Vercel executor cũ không có cron hoặc daemon riêng. Khi Worker đã dừng, nó không được gọi nữa. Có thể giữ project hoặc xóa trong Vercel Dashboard nếu không dùng.

## Dọn file backend cũ trên repo

Ghi đè file giao diện đã đủ để bản mới không nạp bot. Để repo gọn, có thể xóa các thư mục cũ `api/`, `vercel/`, `cloudflare/`, `server/` và các file `paper-trading.js`, `paper-ui.js`, `remote-paper.js`, `market-data.js`, `binance-market.js`, `hybrid-protocol.mjs`, `vercel.json`, `.vercelignore`, `compose.yaml`, các hướng dẫn deploy cũ. Gói mới không chứa backend giao dịch cũ. Thư mục `dung-bot-cu` chỉ là công cụ dừng Worker trên máy, không cần tải lên Pages.

## Dữ liệu và tín hiệu

- REST nến: `https://fapi.binance.com/fapi/v1/klines`.
- REST giá và % 24h: `https://fapi.binance.com/fapi/v1/ticker/24hr`.
- Realtime ticker/nến: `wss://fstream.binance.com/market/stream`.
- Cả chart, watchlist, RSI và Short/Swing dùng cùng nguồn Futures. RSI tính từ giá đóng cửa nến giao dịch, không dùng Mark Price.
- Giữ nguyên bộ RSI v4.1: Reversal / Momentum / Breakout, các bộ lọc và xử lý xung đột. **1M = tháng lịch UTC**, còn phút được viết `m`. Năm khung là **1M, 1D, 4H, 1H, 15M**.
- Không suy diễn tín hiệu khi thiếu lịch sử, nến lỗi, cache cũ hoặc mất WebSocket. Với coin mới, tháng chưa đủ 30 nến đóng sẽ hiện chờ.
- Khi mất mạng rồi mở lại, app đồng bộ dữ liệu đã bỏ lỡ. Khi đóng app, app không chạy bot nền; tính năng này đã được bỏ theo yêu cầu.
- 403/418/429/451 được báo rõ và giữ thời gian chờ, không xoay endpoint hay đổi nguồn tự động. Dữ liệu trực tiếp vẫn phụ thuộc Binance và mạng trên điện thoại.

## Kiểm thử

`npm test` chạy kiểm tra RSI và bộ nhận dữ liệu Futures. `npm run test:parity` so sánh RSI v4.1 với bản Python gốc (cần Python). Kiểm tra giao diện chạy `npm run test:ui` khi đã có jsdom. Không cần cài các công cụ này để dùng GitHub Pages.

Nguồn API: [Binance Futures REST Market Data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data), [WebSocket Market Streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market).
