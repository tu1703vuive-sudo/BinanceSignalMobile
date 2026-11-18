# Signal v3.10.0 — Watchlist tối và chi tiết RSI

## Đã thay đổi

- Watchlist theo bố cục ảnh tham chiếu: từng hàng gồm icon coin, mã/tên, đường giá nhỏ 24H, giá và phần trăm thay đổi bên phải. Màu nền tối. Hàng đang chọn có vạch xanh; nút quản lý vẫn cho đánh dấu yêu thích, thêm và xóa coin.
- Đường giá nhỏ dùng các nến Futures 15 phút trong khoảng 24 giờ. Khi nhận ticker, app cập nhật điểm ở cuối. Dùng chung lịch sử sẵn có của coin đang xem; các coin khác tải lịch sử riêng, giữ cache 5 phút và không gọi REST theo từng tick. Nếu chưa lấy được nến thì hiện “Chờ nến”, không tạo đường giá giả.
- Toàn bộ **Phân tích nâng cao / Short–Swing / hỗ trợ–kháng cự / kế hoạch** được chuyển vào **Cài đặt → Phân tích nâng cao**. Chức năng còn đầy đủ; màn hình chính chỉ giữ Watchlist, Chart và RSI.
- Hàng **Chi tiết tín hiệu** sáng xanh khi thiên LONG, đỏ khi thiên SHORT. Thiên hướng tính từ **RSI nến đã chốt** của năm khung: dùng dấu điểm bối cảnh v4.1 (tháng 10%, ngày 20%, 4H 30%, 1H 25%, 15M 15%). Điểm dương thiên LONG, âm thiên SHORT, bằng 0 trung lập. Nếu có tín hiệu v4.1 được xác nhận thì ưu tiên hướng xác nhận. Thiếu dữ liệu, dữ liệu cũ/mất kết nối hoặc xung đột thì không sáng hướng.
- Khi mở Chi tiết tín hiệu, hiện ngay sáu mục **Reversal LONG/SHORT, Momentum LONG/SHORT, Breakout LONG/SHORT**. Điểm đạt như **3/5** có số lớn. Mỗi hàng bấm mở/đóng được, bên trong hiện năm điều kiện và dấu đạt/chưa đạt cùng số RSI. Giữ mục đang mở khi số liệu cập nhật.
- **Thiên hướng là bối cảnh tham khảo**, còn nhãn **xác nhận** chỉ hiện khi bộ điều kiện v4.1 đạt. Số 3/5 nghĩa là đạt ba trong năm điều kiện, không phải tỷ lệ thắng. Khi dữ liệu chưa sẵn sàng hiển thị —/5.

## Cập nhật

1. Giải nén gói FULL. Mở thư mục **GITHUB_UPLOAD**.
2. Tải **nội dung bên trong** thư mục này đè vào gốc repo `tu1703vuive-sudo/BinanceSignalMobile`, rồi **Commit changes**. Không tải nguyên thư mục thành `repo/GITHUB_UPLOAD`.
3. Đợi Pages deploy xong, đóng/mở lại app. Nếu còn giao diện cũ, mở trang bằng Safari và làm mới. Cài đặt cần hiện **v3.10.0 · Binance Futures · RSI v4.1**.

Không cần deploy Vercel hoặc Cloudflare cho bản này. Vẫn không có paper trading. Nếu bot Cloudflare từ bản v3.8 chưa được dừng, xem hướng dẫn `CAP_NHAT_v3.9.0_BINANCE_FUTURES.md` và công cụ dừng bot cũ đi kèm. Nếu đã dừng thì không cần chạy lại.

## Giữ nguyên

Nguồn Binance USDⓈ-M Futures, chart và các lớp hiển thị, RSI 14 với **1M = tháng lịch UTC**, bộ điều kiện RSI v4.1 nguyên bản, danh sách coin/yêu thích và phân tích Short/Swing. Không đổi thuật toán để làm sáng thiên hướng; phần màu/nhãn là lớp trình bày riêng.

Đã kiểm tra 18 bài kiểm thử, hai luồng tích hợp UI và bố cục trình duyệt ở khung 320px. Dữ liệu mô phỏng dùng trong kiểm tra giao diện không được đưa vào gói app. Gói chưa được tải trực tiếp lên repo của bạn.
