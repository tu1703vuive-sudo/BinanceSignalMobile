BINANCE SIGNAL MOBILE - BẢN WEBSITE / PWA
========================================

MỤC TIÊU
- Không App Store.
- Không cần Mac/Xcode.
- Không cần IPA.
- Chạy trực tiếp bằng GitHub Pages.
- Trên iPhone: Safari > Chia sẻ > Thêm vào Màn hình chính.

REPO CỦA BẠN
https://github.com/tu1703vuive-sudo/BinanceSignalMobile

CÁCH ĐƯA LÊN GITHUB BẰNG TRÌNH DUYỆT
1. Mở repo trên GitHub.
2. Nếu repo đang có source iOS cũ và bạn chỉ muốn dùng web, có thể tạo branch mới hoặc xóa file cũ trước.
3. Chọn Add file > Upload files.
4. Kéo TOÀN BỘ nội dung của thư mục này vào. Quan trọng: index.html phải nằm ở thư mục gốc repo.
5. Commit changes.
6. Vào Settings > Pages.
7. Source: Deploy from a branch.
8. Branch: main, Folder: /(root), bấm Save.
9. Chờ GitHub Pages triển khai. Link dự kiến:
   https://tu1703vuive-sudo.github.io/BinanceSignalMobile/

CÀI TRÊN IPHONE
1. Mở link GitHub Pages bằng Safari.
2. Bấm nút Chia sẻ.
3. Chọn "Thêm vào Màn hình chính".
4. App sẽ có icon riêng và mở ở chế độ standalone.

TÍNH NĂNG
- Binance miniTicker WebSocket realtime.
- Watchlist + Favorites.
- Thêm coin USDT.
- Swing / Position: 1M, 1W, 1D, 12H, 4H.
- Short Term: 4H, 1H, 15m, 5m.
- EMA, RSI, MACD, ATR, market structure, volume.
- BUY/SELL tương ứng LONG/SHORT, WATCH, WAIT.
- Entry, SL, TP1/TP2/TP3 (TP3 có ở Swing; Short Term dùng TP1/TP2 như logic nguồn).
- Support/Resistance zones.
- Candlestick chart.
- PWA cache + Add to Home Screen.

LƯU Ý
- iOS có thể tạm dừng WebSocket khi PWA chạy nền. Giá realtime hoạt động tốt nhất khi app đang mở.
- App chỉ dùng market data công khai, không cần API Key/Secret.
- Đây là công cụ phân tích kỹ thuật, không phải khuyến nghị đầu tư.
