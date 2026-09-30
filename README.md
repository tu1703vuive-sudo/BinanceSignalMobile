## v3.2.4 - RSI 14 Chart Panel

- Thêm panel RSI (14) ngay dưới Mini Chart V2.
- Mốc 70 / 50 / 30 hiển thị trực quan; vùng >70 và <30 được tô rất nhẹ.
- RSI đổi theo timeframe đang xem và dùng chính candle cache v3.2.3, không gọi thêm Binance API.
- Crosshair RSI đồng bộ với candle đang rê/chạm ở price chart; có thể rê trực tiếp trên RSI panel.
- Giá trị RSI hiện tại luôn hiển thị ở header panel và trên scale bên phải.
- Render chung nhịp requestAnimationFrame với chart để giữ độ mượt.
- RSI panel chỉ để quan sát; không thay đổi Short V2.2, Swing, Support/Resistance, Entry/SL/TP hay Data Integrity Guard.

---

## v3.2.3 - Data Integrity Guard

- Phát hiện nến lỗi, trùng, sai thứ tự và khoảng trống trong chuỗi nến.
- Tự chuẩn hóa duplicate/out-of-order trước khi cache.
- Nếu WebSocket bỏ lỡ nến, tự REST resync timeframe bị lỗi.
- Khi tab ngủ/nền rồi quay lại, kiểm tra cache và resync nếu stale.
- REST có timeout 8 giây + tối đa 3 lần retry với exponential backoff cho timeout/408/418/429/5xx.
- Tạm chặn LONG/SHORT/WATCH khi dữ liệu phân tích không toàn vẹn; hiển thị WAIT thay vì dùng dữ liệu lỗi.
- Badge dữ liệu: LIVE / RESYNCING / STALE / SYNC.
- Giữ nguyên Short V2.2, Swing, Support/Resistance và Mini Chart V2 của v3.2.2.

---

## v3.2.2 - Mini Chart V2 + UI Polish

- Giữ nguyên Short V2.2, Swing Engine và Support/Resistance của v3.2.1.
- Mini chart dùng candle cache/WebSocket hiện có, không thêm REST request riêng.
- Throttle chart render ~90 ms và chỉ resize backing canvas khi kích thước thật sự thay đổi.
- Bỏ shadowBlur trên từng nến để giảm GPU/CPU khi WebSocket cập nhật liên tục.
- Thêm volume strip, current-price line, Entry/Watch zone, SL, TP1-TP3 và S/R trực tiếp trên chart.
- Thêm crosshair + OHLC khi rê/chạm chart.
- Timeframe selector gọn một hàng 7 nút, chart cao hơn và rõ hơn trên mobile.
- Thêm LIVE/SYNC badge + số nến cache realtime.
- Asset/cache bumped lên v3.2.2 để GitHub Pages/PWA nhận UI mới.


## v3.2.1 - WebSocket / Candle Cache

- Giữ nguyên Short V2.2 và Support/Resistance của v3.2.0.
- Kline WebSocket cập nhật trực tiếp candle cache trong RAM.
- Khi nến phân tích đóng, engine tính lại từ cache thay vì tải lại toàn bộ 260 nến mỗi timeframe.
- REST dùng cho initial hydrate, cache stale, manual refresh và reconnect resync.
- Chống request trùng cùng symbol/timeframe.
- Batch render ticker để giảm DOM churn/CPU.
- Reconnect WebSocket theo exponential backoff.

# BinanceSignalMobile v3.2.0 — Short Engine V2.2

Bản này được nâng cấp trực tiếp từ source production hiện tại, giữ nguyên giao diện và cấu trúc GitHub Pages/PWA.

## Nâng cấp v3.2.0

- Short Engine canonical: `15m + 1h + 4h`.
- Trọng số tín hiệu: `15m 20% + 1h 35% + 4h 45%`.
- Loại hoàn toàn `5m` khỏi dữ liệu phân tích Short và Support/Resistance.
- Short S/R chỉ còn: `4H + 1H + 15m`.
- Giữ nguyên Swing Engine.
- Giữ nguyên watchlist, favorite, coin đang chọn và localStorage hiện tại.
- Giữ nguyên UI.
- Bump asset/cache version để GitHub Pages/PWA lấy `app.js` mới thay vì giữ cache cũ.
- Version code:
  - `APP_VERSION = 3.2.0`
  - `ENGINE_VERSION = short-v2.2`

> Upload toàn bộ nội dung thư mục/ZIP này vào ROOT branch đang publish GitHub Pages.

---

# BinanceSignalMobile V2.12 — Mobile Original

Bản này khôi phục đúng cấu trúc/chức năng WebPWA V2.12 từ file người dùng cung cấp.

Giữ nguyên:
- Thêm coin / xóa coin
- Favorite
- Watchlist realtime
- MiniTicker
- Mini chart/candlestick canvas
- Chọn 15m, 1h, 4h, 12h, 1d, 1w, 1M
- Dài hạn / Ngắn hạn
- Entry, SL, TP1-TP3
- Support / Resistance
- Toàn bộ engine trong app.js gốc

Chỉ thay:
- CSS để khóa giao diện tối đa 430px
- Watchlist chuyển sang thanh cuộn ngang trên mobile
- Chart responsive theo đúng khung điện thoại
- Cache version/service worker để tránh giữ UI cũ

Upload toàn bộ file trong thư mục này vào ROOT của GitHub Pages.


## Watchlist Rows update

Watchlist đã được chuyển về dạng danh sách dọc:
- 1 coin = 1 hàng
- không cuộn ngang
- giữ nguyên thêm/xóa coin, favorite, realtime
- giữ nguyên mini chart và toàn bộ app.js


## Watch + Plan Inline

Đã gộp card Kế hoạch vào ngay dưới tín hiệu:
- WATCH LONG → `WATCH LONG · KẾ HOẠCH`
- WATCH SHORT → `WATCH SHORT · KẾ HOẠCH`
- LONG / SHORT tương tự
- Entry/Vùng canh nằm đầu tiên
- SL và TP nằm ngay bên dưới
- Không còn card Kế hoạch riêng phía dưới chart
- Không thay đổi engine tín hiệu


## SPOT + FUTURES

Đã thêm công tắc dữ liệu:
- SPOT: Binance Spot public REST/WebSocket
- FUTURES: Binance USDⓈ-M Futures public REST/WebSocket

Khi chuyển thị trường, toàn bộ dữ liệu chuyển đồng bộ:
- giá realtime
- watchlist
- mini chart
- nến phân tích
- Support / Resistance
- LONG / SHORT / WATCH
- Entry / SL / TP

Mỗi thị trường lưu riêng:
- danh sách coin
- favorite
- coin đang chọn

Không cần API key vì chỉ dùng public market data.


## FUTURES ONLY + SHORT DEFAULT

Thay đổi:
- Bỏ hoàn toàn SPOT khỏi giao diện và code chạy chính.
- Tất cả dữ liệu chỉ lấy từ Binance USDⓈ-M Futures.
- REST:
  - `/fapi/v1/klines`
  - `/fapi/v1/ticker/24hr`
- WebSocket:
  - `wss://fstream.binance.com/market/stream`
- Ngắn hạn là chế độ mặc định khi mở bản này lần đầu.
- Người dùng vẫn có thể chuyển thủ công sang Dài hạn.
- Watchlist/favorite/coin đang chọn dùng bộ nhớ Futures riêng.

## v3.2.5 — Indicator Settings
- Adds a gear icon on the mini chart for visual layer controls.
- Toggle RSI 14, Volume, S/R, Entry/SL/TP and Crosshair/OHLC.
- Includes Tối giản / Trading / Đầy đủ presets.
- Settings are remembered locally and do not modify the signal engine.
