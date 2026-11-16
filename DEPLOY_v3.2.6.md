# BinanceSignalMobile v3.2.6 — RSI Momentum 5 khung

## Cập nhật GitHub Pages

1. Giải nén ZIP. Nội dung ZIP là nội dung ROOT của repository.
2. Upload và ghi đè **đủ 5 file** vào cùng thư mục với `index.html` đang chạy:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `sw.js`
   - **`rsi-mtf.js` (file mới, bắt buộc)**
3. Giữ `manifest.webmanifest`, thư mục `icons` và cấu hình GitHub Pages hiện tại. Bản FULL có kèm các file này nếu cần triển khai mới.
4. Commit rồi chờ GitHub Pages hoàn tất triển khai.
5. Mở lại website và tải lại trang. Trên Windows có thể dùng Ctrl+Shift+R; với PWA trên điện thoại, mở website trong Safari/Chrome để nhận bản mới rồi mở lại app.

Không xóa dữ liệu website hoặc localStorage: danh sách coin, favorite và lựa chọn cũ vẫn dùng cùng khóa lưu trữ. Không cần API key.

## Phần mới nằm ở đâu?

Card **RSI · 5 KHUNG** nằm ngay trên biểu đồ, dưới khối kế hoạch giao dịch hiện có.

- 5 ô: **1M (tháng), 1D, 4H, 1H, 15M**.
- Số lớn cập nhật trực tiếp theo nến đang chạy. Màu BULL/BEAR/NEUTRAL của số này cũng là trạng thái trực tiếp.
- Dòng **Chốt** là RSI nến đã đóng. Mũi tên cạnh số chốt so với RSI của nến đóng trước đó.
- Điểm và tín hiệu chỉ dựa vào dòng **Chốt**; vì vậy màu ô trực tiếp đôi khi khác điểm hoặc trạng thái tổng.
- Hai hướng LONG / SHORT chỉ là đèn báo, không phải nút đặt lệnh.
- Phần **Cách tính & điều kiện xác nhận** có công thức và thời gian chốt từng khung theo múi giờ của thiết bị.

Chế độ trong bảng là **Momentum**. Reversal và Breakout chưa được thêm vì chưa thống nhất quy tắc cho hai chế độ đó.

## Quy tắc

| Khung | Trọng số |
| --- | ---: |
| 1M | 10% |
| 1D | 20% |
| 4H | 30% |
| 1H | 25% |
| 15M | 15% |

Mỗi khung có RSI chốt ≥55 nhận +1 điểm; ≤45 nhận −1; còn lại nhận 0. Tổng điểm = tổng điểm từng khung nhân trọng số, trong khoảng −100…+100.

- Điểm ≥+35: thiên LONG.
- Điểm ≤−35: thiên SHORT.
- Ở giữa: trung lập.
- LONG xác nhận: thiên LONG; RSI chốt 4H và 1H ≥55; RSI 15M nến chốt trước <55 và nến vừa chốt ≥55.
- SHORT xác nhận: thiên SHORT; RSI chốt 4H và 1H ≤45; RSI 15M nến chốt trước >45 và nến vừa chốt ≤45.
- Một xác nhận 15M có hiệu lực đến lần chốt nến 15M tiếp theo. Chưa nhận được dữ liệu chốt mới thì chuyển CHỜ.
- Dưới/đúng 30 hoặc trên/đúng 70: cảnh báo cực trị; không tự phát sinh tín hiệu đảo chiều.

Các trọng số là đề xuất để kiểm thử, không phải tham số đã backtest hoặc xác suất thắng. Độ dốc RSI được hiển thị để quan sát; không cộng điểm thêm hoặc thêm điều kiện ẩn ngoài quy tắc trên.

## Dữ liệu và trường hợp CHỜ

Tái sử dụng cache nến, WebSocket và cơ chế gộp request của app. Lúc đầu tải bổ sung các khung còn thiếu cho coin đang chọn. Không tải 5 khung cho toàn watchlist, không tạo WebSocket riêng và không thêm vòng polling REST.

Mỗi khung cần ít nhất **16 nến đóng** để tính RSI(14) hiện tại và trước đó. Coin mới chưa đủ 16 tháng sẽ không có điểm tổng; không gán RSI giả bằng 50 và không chia lại trọng số. Với thị trường giá đi ngang hoàn toàn, RSI của bộ mới là 50 theo quy ước trung lập.

Dữ liệu lỗi, có khoảng trống, quá cũ, tải thất bại hoặc mất kết nối WebSocket: ngừng hiển thị điểm và đèn hướng, chuyển CHỜ. Có thể bấm ↻ để tải lại. Đổi coin sẽ xóa kết quả hiển thị cũ; kết quả tải chậm của coin trước không được ghi đè coin mới.

## Phần hiện có

Short V2.2, Swing, S/R và công thức Entry/SL/TP giữ nguyên. Bảng RSI là bộ đánh giá độc lập và sử dụng cùng bộ trọng số ngắn hạn khi chuyển Dài hạn/Ngắn hạn của app. Vì vậy bảng RSI có thể khác tín hiệu gốc phía trên; chưa dùng điểm RSI để sửa kế hoạch giao dịch gốc.

## Kiểm tra đã thực hiện

- `node --check` cho `app.js`, `rsi-mtf.js` và `sw.js`.
- `node --test tests/rsi-mtf.test.cjs`: 8 nhóm kiểm tra gồm RSI Wilder, giá đi ngang, biên 45/55, điểm ±35, LONG/SHORT, ví dụ ảnh −50, thiếu lịch sử và nến chưa đóng.
- Kiểm tra tích hợp DOM bằng dữ liệu Binance mô phỏng: hydrate dùng chung 5 request, số trực tiếp khác số chốt, chặn cache cũ, mất/kết nối lại WebSocket, đổi coin với phản hồi sai thứ tự, lỗi API tháng không chặn engine ngắn hạn, coin mới, cài đặt chart, chuyển Short/Swing và localStorage. Không ghi nhận lỗi runtime.
- So sánh trực tiếp với commit gốc `5a5c935578805967e04c44cc85651e3f538650b1`: vùng mã RSI/MACD/ATR/S/R/Short/Swing hiện có không thay đổi. Xem `ENGINE_INVARIANTS_v3.2.6.json`.
- Đã nâng cache PWA và tham số asset lên 326; file mới được thêm vào danh sách cache offline.

**Giới hạn kiểm chứng:** môi trường chặn khởi chạy Chromium, nên chưa xác minh layout bằng trình duyệt thật, cài đặt PWA thực tế hoặc kết nối Binance trực tiếp. Kiểm tra tích hợp dùng DOM mô phỏng, không phải backtest hiệu quả giao dịch. Sau triển khai, kiểm tra trên thiết bị đang sử dụng: đủ 5 ô, không tràn màn hình, đổi coin đúng, và dữ liệu Binance cập nhật.
