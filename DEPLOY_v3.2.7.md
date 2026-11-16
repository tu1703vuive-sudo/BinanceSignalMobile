# BinanceSignalMobile v3.2.7 — RSI Auto Paper

## Cập nhật từ bản cũ

1. Giải nén ZIP. Nội dung ZIP là nội dung ROOT của repository.
2. Upload và ghi đè đủ **7 file** vào cùng thư mục `index.html` đang chạy:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `sw.js`
   - `rsi-mtf.js`
   - **`paper-trading.js` — mới, bắt buộc**
   - **`paper-ui.js` — mới, bắt buộc**
3. Giữ `manifest.webmanifest`, `icons`, thiết lập GitHub Pages và dữ liệu trình duyệt. Bản FULL có kèm manifest/icons để triển khai mới.
4. Commit, chờ GitHub Pages hoàn tất rồi tải lại trang. Windows: Ctrl+Shift+R. Với PWA: mở trang trong Safari/Chrome để nhận bản mới, sau đó mở lại app.

Không cần API key, tài khoản Binance hay nạp tiền. Bản này chỉ gọi dữ liệu thị trường công khai; không gửi lệnh giao dịch hoặc sử dụng tiền thật.

## Bắt đầu

Card **PAPER TRADING** nằm ngay dưới bảng RSI 5 khung, trước biểu đồ.

1. Chọn coin muốn theo dõi.
2. Mở **Cấu hình vốn & TP/SL** để kiểm tra các thông số.
3. Bấm **Bật thông báo thiết bị**, cấp quyền nếu muốn. Nếu không cấp quyền hoặc trình duyệt không hỗ trợ, vẫn có thông báo trong app. Âm thanh là tùy chọn và cần thao tác trên trang để trình duyệt cho phép phát.
4. Bật **Tự vào lệnh giả**.
5. Giữ tab đang hiển thị. Bot chờ xác nhận RSI mới sau thời điểm bật; không mở ngay theo một tín hiệu đã có sẵn.

Mỗi lần tải lại/mở lại app, tự vào lệnh trở về **TẮT**. Số dư, lệnh mở, cấu hình và lịch sử vẫn giữ. Tắt tự vào lệnh chỉ ngừng mở mới; lệnh đang mở tiếp tục được theo dõi khi chương trình nhận được giá.

## Cấu hình mặc định

| Tham số | Mặc định |
| --- | ---: |
| Vốn ảo ban đầu | 10.000 USDT |
| Giá trị mỗi lệnh / vốn giữ cho lệnh | 100 USDT |
| Stop Loss | 1% từ giá khớp giả |
| Take Profit | 2% từ giá khớp giả |
| Phí mỗi chiều | 0,05% |
| Trượt giá bất lợi mỗi chiều | 0,02% |
| Số lệnh mở tối đa | 1 trên toàn sổ paper |
| Đòn bẩy mô phỏng | 1× |

Đây là cấu hình thử nghiệm, không phải mức phí Binance thực tế, đề xuất quản trị vốn hoặc thông số đã backtest. Có thể chỉnh giá trị lệnh, TP/SL, phí và trượt giá. Vốn ban đầu khóa sau lệnh đầu tiên; cấu hình mới chỉ áp dụng cho lệnh mở sau đó. Không tự sửa TP/SL của lệnh đang mở.

## Điều kiện mở lệnh

Bot dùng bộ RSI Momentum 5 khung v3.2.6, độc lập tín hiệu Short/Swing và Entry/SL/TP gốc phía trên:

- Điểm RSI chốt: 1M 10%, 1D 20%, 4H 30%, 1H 25%, 15M 15%; RSI ≥55 nhận +1, ≤45 nhận −1, còn lại nhận 0.
- **LONG:** điểm ≥+35; RSI 4H và 1H ≥55; RSI 15M nến trước <55 và nến vừa chốt ≥55.
- **SHORT:** điểm ≤−35; RSI 4H và 1H ≤45; RSI 15M nến trước >45 và nến vừa chốt ≤45.
- Có đủ 5 khung, dữ liệu hợp lệ, kết nối đang hoạt động và giá trực tiếp còn mới.
- Tín hiệu được nhận không quá **30 giây** sau thời điểm nến 15M đóng, và sau thời điểm bật tự vào lệnh / quay lại tab / đổi coin. Tín hiệu trễ bị bỏ qua.
- Chỉ mở theo **coin đang chọn**. Không quét tự động toàn bộ watchlist.
- Tối đa một vị thế. Một lần xác nhận chỉ được xử lý một lần, kể cả khi lệnh đã đóng, trang vẽ lại hoặc có nhiều tab.
- Nếu thiếu số dư để giữ giá trị lệnh cộng phí mở, không mở lệnh.

Khóa Web Locks kết hợp đọc/lưu sổ lệnh trong cùng giao dịch giúp hai tab không cùng mở trùng một tín hiệu. Trình duyệt thiếu Web Locks sẽ tắt khả năng tự mở lệnh. Phiên bản này không có nút đặt lệnh thật.

## Giá khớp, số dư và PnL

- Mở theo giá cuối cùng quan sát được từ luồng thị trường, cộng trượt giá bất lợi: LONG mua cao hơn, SHORT bán thấp hơn. Không giả vờ khớp tại giá đóng nến tín hiệu trong quá khứ.
- Khối lượng = giá trị lệnh / giá khớp giả. Giá trị lệnh được giữ khỏi số dư khả dụng; trừ phí mở khi vào lệnh.
- LONG: lãi gộp = (giá thoát − giá vào) × khối lượng. SHORT dùng dấu ngược lại.
- Khi thoát, cộng lại vốn giữ, cộng/trừ lãi gộp và trừ phí thoát. Lãi ròng trừ đủ cả phí mở và thoát; trượt giá đã nằm trong giá khớp.
- TP giả lập theo mức mục tiêu, áp dụng trượt giá thoát. SL theo giá quan sát khi chạm/vượt SL nên có thể lỗ hơn mức cấu hình nếu giá nhảy qua ngưỡng. Có nút đóng thủ công theo giá hợp lệ đang quan sát.
- Lãi/lỗ đang mở và tổng vốn chỉ là ước tính theo giá mới nhất, có dự trù phí thoát.

Không mô phỏng funding, thanh lý, ký quỹ sàn, spread/order book, hàng đợi hay khớp từng phần. Khi đang trực tuyến, TP/SL xét theo giá nhận được; có thể bỏ lỡ dao động giữa các lần cập nhật. Đây là công cụ forward paper để kiểm tra quy tắc, không bảo đảm sao chép kết quả đặt lệnh thật.

## Đổi coin, mất mạng và đóng app

Lệnh đang mở vẫn được theo dõi bằng miniTicker dù bạn chuyển sang coin khác hoặc xóa coin đó khỏi watchlist. Không thêm lại coin vào danh sách của bạn.

GitHub Pages/PWA này không có máy chủ bot chạy 24/7. Khi trang ngừng chạy, không có xử lý lệnh hoặc thông báo trực tiếp. Tab ẩn tạm dừng mở lệnh; việc theo dõi thoát vẫn chỉ chạy nếu trình duyệt tiếp tục cấp thời gian thực thi và dữ liệu.

Khi mở lại trang, quay lại tab hoặc giá bị gián đoạn quá 10 giây, bot tải lịch sử **nến 1 phút** cho lệnh mở và kiểm tra trước khi xử lý giá mới:

- Nến đầy đủ chạm cả SL và TP: xử lý SL trước theo giả định thận trọng.
- Nếu giá mở nến đã vượt SL, dùng giá mở bất lợi hơn mức SL.
- Nến chứa thời điểm vào lệnh hoặc tick cuối đã quan sát: chỉ xét giá đóng; không dùng lại high/low có thể xảy ra trước thời điểm đó. Điều này có thể bỏ sót một lần chạm trong phần nến còn lại.
- Thời gian thoát được lưu là cuối nến kiểm tra, không phải thời điểm tick thực tế. Lịch sử ghi rõ khi kết quả được khôi phục từ nến.
- Chưa tải được, nến có khoảng trống hoặc lịch sử quá dài (hơn 100 trang × 1.000 nến): giữ lệnh nguyên trạng và báo cần đồng bộ, không tự tạo kết quả. Có nút **Thử đồng bộ lại**.

Nếu SL/TP được phát hiện sau khi mở lại app, thông báo phát ở thời điểm khôi phục và có ghi chú. Không phải thông báo đã được gửi khi app đóng.

## Thông báo và lịch sử

Mỗi lần mở/đóng thành công có thông báo trong app. Có thể bật thông báo hệ thống và âm thanh. Chỉ thông báo giao dịch sau khi sổ lệnh lưu thành công; không báo đã vào nếu thao tác lưu bị lỗi. Thông báo hệ thống phụ thuộc quyền và khả năng trình duyệt/thiết bị; việc cấp quyền không bảo đảm OS luôn hiển thị.

Lệnh lưu: coin, hướng, giá, thời gian vào/thoát, khối lượng, giá trị, TP/SL, phí, PnL, lý do và số RSI chốt/trước đó của cả 5 khung. Lịch sử hiển thị 20 lệnh một lần và có **Xem thêm**, không cắt bỏ các lệnh đã lưu.

- **Xuất lịch sử CSV:** các lệnh đã đóng, đọc được bằng Excel.
- **Sao lưu JSON:** tải toàn bộ sổ, cấu hình và lệnh mở. Bản này xuất bản sao lưu; chưa có nút nhập JSON trở lại.

Dữ liệu nằm ở localStorage khóa `bsm_paper_rsi_v1` của cùng trình duyệt và cùng địa chỉ website. Không đồng bộ máy khác. Không xóa dữ liệu web nếu muốn giữ lịch sử. Dữ liệu hỏng hoặc hết chỗ lưu sẽ chặn thao tác và tắt tự mở, giữ dữ liệu gốc để có thể sao lưu/xử lý.

## Kết quả kiểm tra

- 22 nhóm unit test RSI và ledger qua `node --test tests/*.test.cjs`.
- 15 nhóm kiểm tra tích hợp DOM bằng dữ liệu mô phỏng: tắt mặc định, quyền thông báo, bỏ tín hiệu cũ, mở với đủ audit 5 khung, chống trùng, đổi/xóa coin, thoát TP và thông báo, xuất CSV/JSON, khôi phục sau reload, bù nến khi offline, giữ lệnh khi thiếu nến, hai tab cạnh tranh, đóng tay/tab ẩn, lỗi lưu và trình duyệt thiếu khóa.
- Các kiểm tra hồi quy của v3.2.6 về dữ liệu, đổi coin, Short/Swing, cài đặt biểu đồ và watchlist tiếp tục qua.
- Kiểm tra cú pháp các file JS, liên kết asset/cache PWA và so sánh nguyên vùng engine RSI/MACD/ATR/S/R/Short/Swing với commit gốc. Xem `ENGINE_INVARIANTS_v3.2.7.json`.

Kiểm tra tích hợp tùy chọn cần `jsdom`: cài trong thư mục kiểm thử bằng npm rồi chạy `node tests/paper-app.integration.cjs`. App triển khai không cần npm hoặc jsdom.

**Giới hạn xác minh:** Chromium bị môi trường chặn khởi chạy. Chưa xác minh layout trên trình duyệt thật, thông báo OS/PWA thực tế, kết nối Binance trực tiếp hay lợi nhuận chiến lược. Các thông báo trong kiểm tra là API mô phỏng, không phải thông báo được gửi tới thiết bị người dùng.
