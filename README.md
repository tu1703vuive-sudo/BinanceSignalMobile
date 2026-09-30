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
