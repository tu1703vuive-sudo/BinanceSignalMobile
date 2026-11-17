# Mobile v3.5.0 — bộ RSI chính v4.1, chỉ BTCUSDT

Thay bộ Momentum đơn lẻ bằng **RSI v4.1** lấy từ `strategy.py` trong gói TriSignal-Paper-Trading-v4.2.2-Telegram(1).zip bạn cung cấp. Bộ chính bật đủ Reversal, Momentum, Breakout; mỗi nhóm có LONG/SHORT. Chỉ BTCUSDT mở paper. Coin khác vẫn xem chart và RSI.

## Cập nhật Cloudflare đang chạy

1. Giải nén đè **toàn bộ nội dung gói mới vào thư mục Mobile cũ** đang có `cloudflare/secrets.json`. Giữ nguyên file đó và `connection.txt`; ZIP mới không chứa hai file bí mật này. Nếu giải nén sang thư mục khác, sao chép `secrets.json` từ bản đang chạy sang trước khi deploy.
2. Trong thư mục `cloudflare`, chạy:

```powershell
npm run deploy
```

Giữ nguyên tên Worker `binance-signal-paper`, binding, class, migrations và account. Không cần tạo bot hoặc tài khoản mới. Bản nâng cấp dùng tiếp sổ lệnh, lịch sử, vốn, auto và đăng ký push. Nếu phiên đăng nhập Wrangler hết hạn, chạy `npm run login` rồi deploy lại. Không chạy setup để đổi khóa.

3. Cập nhật các file frontend trên GitHub Pages ở thư mục gốc:

```
index.html
styles.css
app.js
sw.js
rsi-mtf.js
paper-trading.js
paper-ui.js
```

Giữ các file còn lại của bản Cloudflare trước. Gói FULL cũng có đủ toàn bộ frontend để tải đè nếu cần. Đợi Pages deploy xong, đóng/mở lại app cho tới khi Cài đặt hiển thị **v3.5.0 · RSI v4.1 · BTC**. Không xóa dữ liệu trình duyệt.

4. Giữ URL và mã kết nối cũ. Với Worker hiện có, mở `https://binance-signal-paper.tu1703vuive.workers.dev/health`: phiên bản phải là `3.5.0`. Giao diện mới cảnh báo nếu máy chủ vẫn dùng bộ RSI cũ.
5. Kiểm tra phần RSI hiển thị **v4.1 · 3 chiến lược**, Paper chỉ BTCUSDT, rồi thử thông báo. Bot đợi tín hiệu mới sau thời điểm nâng cấp; không mở lại tín hiệu cũ đang hiển thị.

Nếu cuối bước deploy Node.js báo SSL nhưng log đã ghi Uploaded/Deployed và cài secrets thành công, kiểm tra `/health` trong trình duyệt và trạng thái kết nối app. Không tắt kiểm tra chứng chỉ SSL và không thay khóa để xử lý lỗi đường truyền.

## Luật vào lệnh được chuyển nguyên nghĩa

RSI 14 Wilder, tính trên **nến đã đóng**. 1M là tháng lịch UTC. Các điều kiện trong cùng hàng đều phải đạt.

| Nhóm | RSI 15m | RSI 1H | RSI 4H | RSI ngày |
|---|---|---|---|---|
| Reversal LONG | Trước <30; mới 30–40 | 30–55 và tăng | 30–55 | ≥25 |
| Reversal SHORT | Trước >70; mới 60–70 | 45–70 và giảm | 45–70 | ≤75 |
| Momentum LONG | Trước <50; mới 50–65 | 50–68 và tăng | 52–70 | ≥40 |
| Momentum SHORT | Trước >50; mới 35–50 | 32–50 và giảm | 30–48 | ≤60 |
| Breakout LONG | Trước <70; mới 70–85 | ≥60 và tăng | ≥60 | ≥50 |
| Breakout SHORT | Trước >30; mới 15–30 | ≤40 và giảm | ≤40 | ≤50 |

Hướng RSI 1H so với nến đã đóng trước đó của chính khung 1H. Bối cảnh ngày/tháng: RSI ≥55 là BULL, <45 là BEAR, khoảng [45,55) là NEUTRAL. **RSI đúng 45 là trung lập**, theo mã v4.1 gốc.

Nếu cả ngày và tháng cùng ngược hướng, chặn Momentum/Breakout. Reversal vẫn xét. Mức rủi ro bối cảnh tính theo mã gốc: cả hai thuận 0,50%, cả hai ngược 0,15%, còn lại 0,30%. Các mức này được lưu làm thông tin giải thích trong lệnh; **giá trị lệnh thực tế vẫn là notional bạn cài trong Paper**, không tự chuyển sang cách tính khối lượng theo phần trăm vốn của Desktop.

Ưu tiên cùng hướng **Breakout → Reversal → Momentum**. Nếu LONG/SHORT cùng hợp lệ thì chờ. Mỗi tài khoản tối đa một lệnh mở. Điểm −100…+100 còn hiển thị để tham khảo bối cảnh, không tham gia quyết định vào lệnh.

Mỗi khung cần ít nhất 100 nến đóng, riêng tháng 30. Bộ lấy tối đa 450 nến mỗi lần tải RSI. Dữ liệu thiếu/cũ/lỗi: không vào lệnh. Phần Chi tiết tín hiệu cho biết từng nhóm đạt mấy điều kiện và điều kiện nào còn thiếu.

## Sổ cũ và phạm vi thực thi

- Khi nâng cấp, máy chủ nhận diện phiên bản chiến lược, làm mới dữ liệu RSI và chờ tín hiệu mới. Nó không đặt lại auto về BẬT nếu trước đó bạn đã chủ động tắt.
- Lệnh đang mở giữ giá vào, phí, SL/TP và lý do cũ; không đổi thành lệnh v4.1 hoặc tự đóng. Giao diện ghi **Bộ RSI cũ** nếu lệnh không có nhãn chiến lược. Sau khi đóng, lệnh mới dùng v4.1.
- Lệnh v4.1 lưu phiên bản, tên Reversal/Momentum/Breakout, năm RSI, năm điều kiện đã đạt và lý do vào bằng số. CSV/JSON có các thông tin này. Thông báo mở lệnh có tên chiến lược.
- Giá trị lệnh, vốn, phí, trượt giá và SL/TP giữ theo cài đặt hiện có. Cloudflare vẫn quản lý TP/SL bằng nến đóng 1 phút và chỉ mở tín hiệu trong 30 giây sau nến 15m đóng.
- Dữ liệu vẫn là **Binance USDⓈ-M Futures**, theo app Mobile hiện tại. Desktop gốc lấy Spot. Tính RSI/đánh giá luật khớp khi dùng cùng dữ liệu đầu vào; không bảo đảm hai app phát tín hiệu trùng từng nến khi nguồn giá và lịch sử nến khác nhau.
- Cloudflare vẫn dùng alarm/SQLite/push, không thêm tác vụ học mô hình và không thêm sổ v5.5. Bot tiếp tục chạy độc lập khi đóng điện thoại sau khi deploy thành công.

## Kiểm tra đã thực hiện

- 4.360 bộ RSI × sáu nhóm chiến lược/hướng: kết quả từng điều kiện, bối cảnh, rủi ro tham khảo, nhóm thắng và mâu thuẫn khớp Python gốc; 26.160 lượt đánh giá, không sai lệch.
- 12 chuỗi × 450 giá trị: RSI Wilder khớp Python với sai số dưới 1e-10.
- 27 kiểm thử RSI/sổ lệnh/API Node và 10 kiểm thử runner/push Cloudflare đều đạt.
- Kiểm thử workerd/SQLite/alarm cục bộ đạt; dữ liệu thị trường và nhà cung cấp push được mô phỏng.
- Kiểm tra giao diện: bật/tắt được lưu, lệnh không trùng, khôi phục TP/SL, giữ sổ, đổi chart không đổi bot BTC, CSV/JSON, push và nâng cấp phiên bản.

Đây là xác minh tính đúng của phần triển khai; chưa phải báo cáo đánh giá lợi nhuận của bộ v4.1. Bản v3.5.0 chưa được triển khai vào tài khoản Cloudflare của bạn trong lần bàn giao này.

Lệnh kiểm tra bổ sung (Python chỉ dùng đối chiếu, bot Cloudflare không cần Python):

```text
node --test tests/*.test.cjs server/tests/*.test.cjs
node tests/v41-parity.cjs
cd cloudflare
npm test
npm run test:runtime
```
