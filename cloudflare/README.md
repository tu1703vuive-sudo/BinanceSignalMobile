**Bản hiện tại v3.8.0 kết hợp Vercel.** [Cài theo thứ tự](../CAP_NHAT_v3.8.0_VERCEL_CLOUDFLARE.md): giữ secrets cũ → npm run hybrid → deploy Vercel với EXECUTOR_TOKEN → npm run hybrid -- URL → npm run deploy. Worker giữ sổ/lịch/push; không lấy dữ liệu thị trường trực tiếp trong mode hybrid.

**Hiện tại v3.7.1:** [giảm lượt gọi và xử lý OKX 429](../CAP_NHAT_v3.7.1_GIAM_LOI_429.md). Giữ thời gian chờ và sổ hiện có khi deploy. Các ghi chú phiên bản phía dưới là lịch sử.

**Bản hiện tại v3.7.0 dùng OKX Spot.** [Cập nhật giữ khóa và sổ cũ](../CAP_NHAT_v3.7.0_OKX_SPOT.md). Build cần `../market-data.js`, `../binance-market.js`, `../rsi-mtf.js`, `../paper-trading.js`. Các ghi chú phiên bản dưới đây là lịch sử.

**Bản hiện tại v3.6.0 dùng giá Spot.** [Cập nhật giữ khóa và sổ cũ](../CAP_NHAT_v3.6.0_SPOT.md). Giữ module `../binance-market.js`; `deploy.mjs` kiểm tra nguồn Spot từ chính Durable Object sau khi upload. Các ghi chú phiên bản dưới đây là lịch sử.

**v3.5.1:** [trạng thái dữ liệu và chẩn đoán Binance](../CAP_NHAT_v3.5.1_DU_LIEU_BINANCE.md). Module ../binance-market.js cần có khi build/deploy.

**v3.5.0 dùng RSI v4.1.** [Hướng dẫn nâng cấp](../CAP_NHAT_v3.5.0_RSI_V41.md). Giữ khóa và sổ cũ; không tạo bot mới.

**Đã cài bản cũ?** Đọc [cập nhật BTC-only](../CAP_NHAT_v3.4.1_BTC.md), giữ secrets và sổ cũ.

# Cloudflare paper backend v3.5.0

Đọc [BAT_DAU_CLOUDFLARE.md](../BAT_DAU_CLOUDFLARE.md) để cài và kết nối điện thoại.

```sh
npm ci
npm run setup
npm run login
npm run deploy
```

Node.js 24 LTS. Một Worker, một SQLite Durable Object, alarm chủ động và cron watchdog mỗi 5 phút. Giao diện GitHub Pages dùng API tương thích với backend Node hiện có. Chỉ paper 1×, chỉ BTCUSDT và tối đa một vị thế. Tín hiệu dùng RSI 5 khung trên nến đóng; TP/SL dùng nến đóng 1m. Không có timer giữ Worker chạy trong bộ nhớ khi nhàn rỗi.

`store.mjs`: SQLite và outbox; `engine.mjs`: runner dùng chung `../rsi-mtf.js`, `../paper-trading.js`; `worker.mjs`: API, lịch và Web Push. Mọi API ghi và alarm được tuần tự hóa trong cùng một object. Sổ và outbox ghi cùng transaction. Tối đa một trang 1.000 nến mỗi alarm khi khôi phục; tiến độ được lưu và tiếp tục sau 5 giây. Không tải toàn bộ lịch sử vào một alarm dài.

VAPID dùng thư viện `@block65/webcrypto-web-push` 2.0.0 (RFC 8291/8292). Endpoint push phải thuộc nhà cung cấp đã cho phép, HTTPS, không chuyển hướng. Subscription hết hạn được loại bỏ; lỗi tạm được retry tối đa 6 lần. Mỗi sự kiện có tag cố định; giao thức push có thể gửi lại khi lỗi mạng, không đảm bảo exactly-once.

Không đổi `name`, `PaperAccount`, `paper-account-v1` hoặc bỏ migrations khi nâng cấp. Không commit secrets, connection.txt, .wrangler, node_modules.

Kiểm tra:

```sh
npm test
npm run test:runtime
```

Runtime test chạy trên workerd/SQLite thật ở máy cục bộ, mô phỏng dữ liệu thị trường và push service. Không cần tài khoản Cloudflare để chạy test/build. `npm run build` chỉ đóng gói, không triển khai. Môi trường mô phỏng này không đo quota hoặc độ trễ thật trên cloud.
