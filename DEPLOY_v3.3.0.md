# Signal v3.3.0 — Mobile Workspace & Bot Paper 24/7

## Thay đổi chính

Màn hình điện thoại ưu tiên đúng thứ tự: **Watchlist → Chart → RSI 5 khung → Paper Trading**. Thanh điều hướng dưới giúp chuyển nhanh giữa bốn phần. Thêm/xóa/yêu thích coin nằm ở nút **+** của Watchlist. Short/Swing, Entry/SL/TP cũ và S/R vẫn có trong **Phân tích nâng cao**, mặc định đóng. Chế độ Dài hạn/Ngắn hạn nằm ở nút cài đặt trên thanh đầu.

Watchlist cập nhật giá vào các phần tử đang có, không dựng lại toàn danh sách theo mỗi tick; giữ cuộn ngang và nút đang chạm. Lịch sử không dựng lại theo mỗi giá mới. Lệnh đang mở giữ nguyên các nút và phần lý do khi cập nhật PnL. Có ưu tiên giảm chuyển động theo cài đặt thiết bị và không dùng thư viện UI/CDN/font bên ngoài.

Bot trình duyệt **mặc định bật tự mở lệnh**, lưu lại lựa chọn bật/tắt qua lần tải lại; không vào lại tín hiệu cũ. Nếu người dùng chủ động tắt, app nhớ trạng thái tắt. Các số vốn/TP/SL/phí và sổ paper v3.2.7 giữ nguyên.

## Hai chế độ hoạt động — phân biệt trước khi sử dụng

| Chế độ | Nơi chạy bot | Tắt trình duyệt/điện thoại |
| --- | --- | --- |
| Trình duyệt, chưa kết nối máy chủ | Tab/PWA đang chạy | Bot dừng khi trang không được thực thi |
| Máy chủ 24/7 đã triển khai và kết nối | Node.js trên VPS hoặc máy tính bật liên tục | Bot tiếp tục; push qua service worker nếu thiết bị đã cấp quyền |

**Gói ZIP chứa đầy đủ phần mềm nhưng chưa tự tạo VPS, tên miền hoặc máy chủ của bạn.** Chỉ upload lên GitHub Pages sẽ có giao diện mới và lưu nút tự vào lệnh; chưa tạo khả năng giao dịch khi trang đóng. Xem [server/README_VI.md](server/README_VI.md) để triển khai phần 24/7.

Trong chế độ máy chủ, sổ lệnh là sổ trên máy chủ. Điện thoại chỉ hiển thị và điều khiển; không chạy thêm bot trình duyệt để vào trùng. Khi kết nối máy chủ lỗi, app giữ chế độ máy chủ và báo lỗi; không tự chuyển về bot trình duyệt. Sổ cũ trong trình duyệt vẫn được giữ. Có nút chuyển bản sao sổ cũ lên máy chủ nếu máy chủ chưa có lệnh.

## Cập nhật giao diện GitHub Pages

Giải nén ZIP. Upload, ghi đè **10 file ở ROOT**, không upload nguyên ZIP:

1. `index.html`
2. `styles.css`
3. `app.js`
4. `sw.js`
5. `manifest.webmanifest`
6. `rsi-mtf.js`
7. `paper-trading.js`
8. `paper-ui.js`
9. **`remote-paper.js` — mới**
10. **`mobile-ui.js` — mới**

Giữ thư mục `icons`, file `.nojekyll`, cấu hình GitHub Pages và dữ liệu trình duyệt. Không cần upload `server/` cho riêng phần giao diện. Không upload `.env`, `server/data` hoặc `node_modules` lên GitHub. Các file bí mật này không có sẵn trong ZIP; sẽ được tạo riêng khi cài máy chủ.

Commit, chờ GitHub Pages deploy hoàn tất, rồi tải lại trang. Windows: Ctrl+Shift+R. PWA điện thoại: mở trang trong trình duyệt để nhận cập nhật rồi mở lại app. Phiên bản mới hiển thị **v3.3.0** trong cài đặt. Không xóa dữ liệu website nếu muốn giữ watchlist, lịch sử, quyền thông báo và thông tin kết nối.

## Bật chạy 24/7 trên điện thoại

Sau khi đã triển khai máy chủ theo hướng dẫn:

1. Paper Trading → **Cài đặt & thông báo → Chạy 24/7 & thông báo đẩy**.
2. Nhập URL HTTPS và mã `BOT_TOKEN` riêng của máy chủ.
3. Bấm **Kết nối 24/7**. Dòng trạng thái phải ghi **Máy chủ 24/7**; kiểm tra worker báo đang chạy.
4. Bấm **Bật thông báo thiết bị**, cấp quyền một lần. App đăng ký push và gửi thông báo thử tới thiết bị này.
5. Đóng app, giữ máy chủ hoạt động. Lệnh tiếp tục được quản lý và thông báo do máy chủ gửi. Lần mở lại giao diện đọc trạng thái đã lưu; không tắt bot hoặc tự re-arm máy chủ.

Khi quyền đã được cấp, lần mở sau tự đăng ký lại thiết bị khi cần; không yêu cầu cấp lại bình thường. Nếu trước đó đã từ chối quyền, cần đổi quyền ở cài đặt website/thiết bị. Trên iPhone/iPad, thêm website ra **Màn hình chính** rồi mở bằng biểu tượng đó để dùng Web Push. Không thể dùng mã để tự cấp quyền thông báo thay cho người dùng.

Đổi coin trong Watchlist khi đang kết nối sẽ đổi coin mà máy chủ theo dõi cho lệnh mới. Lệnh đang mở trên coin cũ vẫn được máy chủ quản lý. Một sổ có tối đa một lệnh mở. Không phải bot quét toàn bộ danh sách.

## Thông tin phụ nằm ở đâu?

- Giá hiện tại, thay đổi 24h: đầu card Chart.
- RSI đầy đủ, nến chốt, lý do, công thức: **Chi tiết tín hiệu** dưới RSI 5 khung. Bộ đếm 15M chỉ biểu thị thời gian tới mốc nến, không dự báo sẽ có lệnh.
- Vốn khả dụng, số lệnh đóng: **Chi tiết tài khoản**.
- Phí, trượt giá, TP/SL, thông báo, máy chủ: **Cài đặt & thông báo**.
- Lệnh đã đóng và xuất CSV/JSON: **Lịch sử lệnh**.
- Điều kiện chạy, khôi phục nến, lưu dữ liệu: **Vận hành & dữ liệu**.
- Kế hoạch và công thức gốc: **Phân tích nâng cao**. Không sửa engine Short/Swing.

Người dùng có cài đặt chart trước đó sẽ giữ lựa chọn cũ. Với cài đặt chart mới hoàn toàn, chỉ hiện nến, volume và crosshair; RSI dạng đường, S/R và kế hoạch gốc bật lại được qua bánh răng chart. Các đường Entry/SL/TP gốc không phải TP/SL của vị thế paper mới.

## Kiểm chứng

- 22 nhóm unit test RSI/ledger + 4 nhóm test máy chủ: mở/đóng không cần trình duyệt, lưu trạng thái qua restart, chặn dữ liệu lỗi, xác thực/CORS, hàng đợi push, retry và loại subscription hết hạn.
- Kiểm tra DOM của app: bố cục 4 phần, quản lý coin, giữ node watchlist, tự vào lệnh mặc định bật, nhớ bật/tắt, chống trùng, giữ sổ/lịch sử, thao tác paper cũ.
- Kiểm tra kết nối giao diện ↔ HTTP server thật trên môi trường thử: cập nhật cấu hình, không vào trùng ở local khi bật cloud, giữ bản sửa cấu hình qua polling, đăng ký push qua API, nhớ tạm dừng và chặn fallback khi mất server. Dịch vụ push/OS trong test được mô phỏng; không gửi tới điện thoại thật.
- Kiểm tra cú pháp, file tham chiếu, cache và thứ tự script. Các module RSI và ledger giữ nguyên so với bản v3.2.7 đã upload.

**Giới hạn:** môi trường trình duyệt từ chối xem localhost/file của workspace; chưa kiểm tra bằng ảnh chụp layout thực tế trên thiết bị, chưa triển khai server của người dùng, chưa thử Binance trực tiếp hoặc push tới điện thoại thật. Không backtest hay cam kết hiệu quả chiến lược. Sau cài đặt, dùng thông báo thử và kiểm tra trạng thái server trước khi dựa vào vận hành 24/7.
