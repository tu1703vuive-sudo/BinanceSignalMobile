# BinanceSignalMobile v3.4.0 — chạy thử Cloudflare

Giữ giao diện trên GitHub Pages. Chuyển riêng bot paper, sổ lệnh và Web Push lên một Cloudflare Worker + SQLite Durable Object. Sau khi triển khai và đăng ký thiết bị thành công, bot hoạt động khi đóng trình duyệt, tắt máy tính và khóa điện thoại.

**Bản này đã chuẩn bị mã nguồn và kiểm thử. Chưa được triển khai vào tài khoản Cloudflare của bạn.** Cần đăng nhập tài khoản của chính bạn theo các bước dưới đây; không gửi mật khẩu hoặc token vào cuộc trò chuyện.

## 1. Cập nhật giao diện GitHub Pages

Giải nén gói. Trong repository `tu1703vuive-sudo/BinanceSignalMobile`, tải đè các file giao diện sau ở thư mục gốc, giữ thư mục `icons` hiện có:

```
index.html
styles.css
app.js
sw.js
manifest.webmanifest
rsi-mtf.js
paper-trading.js
remote-paper.js
paper-ui.js
mobile-ui.js
```

Đợi GitHub Pages triển khai xong, mở lại app. Trong Cài đặt sẽ thấy **v3.4.0 · Cloudflare Paper**. Nếu vẫn hiện bản cũ, đóng toàn bộ cửa sổ app rồi mở lại / tải lại trang. Không xóa dữ liệu trình duyệt vì có thể làm mất sổ paper lưu cục bộ.

## 2. Cài bot lên Cloudflare — làm một lần trên Windows

1. Cài [Node.js 24 LTS](https://nodejs.org/) nếu máy chưa có. Tạo tài khoản [Cloudflare](https://dash.cloudflare.com/) và giữ **Workers Free**. Không cần mua tên miền hoặc VPS.
2. Chạy file **CAI_CLOUDFLARE_WINDOWS.cmd** trong thư mục đã giải nén. Cửa sổ sẽ cài các gói, tạo khóa, rồi mở trình duyệt để bạn đăng nhập và cho Wrangler quyền triển khai Worker trong tài khoản của mình.
3. Nếu Cloudflare hỏi chọn account, chọn account muốn chạy bot. Nếu yêu cầu đặt tên miền phụ `workers.dev`, chọn một tên còn trống. Không nâng cấp sang Paid để chạy bản thử này.
4. Khi hoàn tất, mở **cloudflare/connection.txt**. File có URL HTTPS và mã kết nối để điền trong app.

Các file `cloudflare/secrets.json` và `cloudflare/connection.txt` chứa bí mật. Giữ trên máy của bạn, không tải lên GitHub, không chụp/gửi công khai. Script giữ nguyên khóa khi chạy lại để tránh làm hỏng đăng ký push cũ.

Nếu muốn gõ lệnh PowerShell, mở trong thư mục `cloudflare` rồi chạy lần lượt:

```powershell
npm ci
npm run setup
npm run login
npm run deploy
```

Script `deploy` tải mã nguồn, cài secrets rồi kiểm tra API bằng mã kết nối. Nó không đổi gói thanh toán của tài khoản. Nếu chưa có `connection.txt`, xem lỗi trong cửa sổ lệnh; chưa thể coi bot đã được cài thành công.

## 3. Kết nối trên điện thoại và bật push

1. Mở [app GitHub Pages](https://tu1703vuive-sudo.github.io/BinanceSignalMobile/).
2. Vào **Paper Trading → Cài đặt & thông báo → Chạy 24/7 & thông báo đẩy**.
3. Điền URL và mã từ `connection.txt`, nhấn **Kết nối 24/7**. Đợi hiện **Cloudflare 24/7 · BTCUSDT · đang chạy**. Nếu hiện lỗi Binance / dữ liệu, phải xử lý lỗi đó trước; kết nối API thành công chưa có nghĩa dữ liệu thị trường đã hoạt động.
4. Nhấn **Bật thông báo thiết bị** và chấp nhận quyền một lần. Nút cũng gửi thông báo thử. Hãy kiểm tra bạn thực sự nhận được trên điện thoại. Quyền hệ điều hành cần thao tác của bạn; website không thể tự cấp.
5. iPhone: thêm website vào Màn hình chính, mở app từ biểu tượng đó rồi bật thông báo. Nếu chặn quyền trước đó, đổi lại trong cài đặt thiết bị. Chế độ Không làm phiền / hạn chế nền có thể ảnh hưởng thời điểm hiển thị.

Cloud mới mặc định **Tự vào lệnh BẬT**. Nếu bạn tắt thủ công thì lần mở app sau vẫn giữ TẮT. Mỗi thiết bị phải đăng ký push riêng; tối đa 5 đăng ký. Khi đã có quyền, app tự đăng ký lại nếu cần lúc mở app.

Có sổ paper cũ trên trình duyệt? Nhấn **Chuyển sổ hiện tại lên máy chủ** khi cloud còn trống. Bot không ghi đè cloud đã có lệnh/lịch sử, và giữ bản cục bộ ban đầu. Sao lưu JSON trước khi chuyển. Khi đã có sổ trên cloud, mọi thao tác dùng sổ cloud; mất mạng không tự tạo một bot cục bộ thứ hai.

## Bot thực hiện gì?

- Theo dõi **một coin** (mặc định BTCUSDT), tối đa **một lệnh mở**. Chọn coin trong app để đổi coin theo dõi; nếu đã có lệnh, bot tiếp tục quản lý lệnh đó và áp dụng coin mới cho tín hiệu tiếp theo. Watchlist vẫn là danh sách giao diện, chưa phải quét đồng thời mọi coin trên cloud.
- RSI 14 Wilder, năm khung **1M (tháng), 1D, 4H, 1H, 15m**. Dùng đúng module chiến lược của ứng dụng, không thay đổi quy tắc LONG/SHORT hiện tại.
- Chỉ vào tín hiệu mới sau khi bật tự động / đổi coin, trong 30 giây đầu sau nến 15m đóng. Tín hiệu cũ, thiếu dữ liệu hoặc alarm bị trễ quá cửa sổ này được bỏ qua; không giả lập giá vào trong quá khứ.
- Vốn mặc định 10.000 USDT ảo, mỗi lệnh 100 USDT, SL 1%, TP 2%, phí mỗi chiều 0,05%, trượt giá 0,02%. Có thể đổi trong cài đặt. Không đặt lệnh thật, không cần Binance API key.
- **TP/SL tự động dựa trên nến 1 phút đã đóng**, không phải từng tick. Bot thức dậy ngay sau phút đóng khi có lệnh. Chạm cả TP và SL trong cùng nến: ưu tiên SL. Nến chứa thời điểm vào lệnh chỉ dùng giá đóng vì không biết cực trị nào xảy ra trước/sau khi vào.
- Giá chart vẫn cập nhật qua kết nối thị trường của điện thoại. Sổ máy chủ đồng bộ mỗi 10 giây khi app đang hiện; dừng hỏi API khi app ẩn. Nút đóng tay yêu cầu máy chủ lấy giá mới và kiểm tra lịch sử trước khi đóng.
- Thông báo mở/đóng đi từ cloud tới dịch vụ push, kèm retry và xóa đăng ký đã hết hạn. Dịch vụ nhận yêu cầu không đảm bảo hệ điều hành sẽ hiển thị ngay. TP/SL theo nến phút và lịch alarm có thể làm thông báo trễ khoảng một phút hoặc lâu hơn khi có sự cố.
- SQLite giữ sổ, tùy chọn auto, coin, khung RSI và hàng đợi thông báo qua lần khởi động lại / triển khai lại. Không đổi tên Worker, class hoặc singleton nếu muốn tiếp tục dùng sổ hiện tại. Xóa Worker/Durable Object sẽ ảnh hưởng dữ liệu; xuất JSON định kỳ.

## Cách tiết kiệm gói Free

Không có lệnh: kiểm tra lúc nến 15m đóng (khoảng 96 lần/ngày). Có lệnh: kiểm tra nến 1 phút (khoảng 1.440 lần/ngày nếu giữ lệnh suốt ngày). Cron kiểm tra lịch mỗi 5 phút (288 lần/ngày) để khôi phục alarm bị mất; không dùng cron để tự vào thêm lệnh. Tắt auto và không còn lệnh/thông báo chờ: dừng alarm giao dịch.

Một điện thoại mở app suốt 24 giờ, đồng bộ mỗi 10 giây, tạo khoảng 8.640 lượt API/ngày. Tổng thường khoảng 10.368 lượt Durable Object/ngày khi luôn có lệnh, chưa tính retry và thao tác tay. Đây là **ước tính lượt yêu cầu**, không phải cam kết chi phí hoặc số liệu Billing; nhiều tab/thiết bị và các dự án khác cùng tài khoản dùng chung hạn mức.

Theo tài liệu Cloudflare kiểm tra ngày 17/11/2026, Durable Objects SQLite dùng được trên Workers Free: 100.000 requests/ngày, 13.000 GB-s/ngày, 5 triệu rows đọc/ngày, 100.000 rows ghi/ngày và 5 GB lưu trữ. `setAlarm` cũng tính một row ghi. Hết một hạn mức Free thì thao tác tương ứng có thể lỗi đến khi hạn mức reset; không phải dịch vụ bảo đảm chạy đủ tháng.

Trong phần kết nối app có bộ đếm ngày UTC (đổi ngày lúc 07:00 Việt Nam). Bộ đếm chỉ phản ánh hoạt động ứng dụng; xem **Cloudflare Dashboard → Workers & Pages → Worker → Metrics** và phần **Durable Objects / Billing** để đánh giá hạn mức thực tế. Mã không đăng ký gói trả phí, không tự bật nâng cấp.

## Khi có lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy v3.4.0 | Kiểm tra GitHub Pages đã deploy các file ở bước 1; đóng/mở lại app |
| Mã kết nối không đúng | Chép lại từ `cloudflare/connection.txt`; không dùng Cloudflare API token làm mã app |
| Origin không được phép | `ALLOWED_ORIGINS` phải là origin chính xác của website. Mặc định đã điền `https://tu1703vuive-sudo.github.io`; đổi miền thì sửa `wrangler.jsonc` và deploy lại |
| Binance HTTP 451/403 | Cloudflare tại vị trí chạy có thể bị Binance từ chối. Bot giữ sổ, không bịa dữ liệu; chưa thể coi bản thử đã thành công. Không có cam kết Binance luôn cho phép egress Cloudflare |
| Binance HTTP 429/418 / thiếu nến | Bot lùi lịch thử lại và giữ lệnh; chỉ tiếp tục sau khi dữ liệu hợp lệ |
| Không nhận thông báo | Kiểm tra quyền thiết bị, iPhone mở từ Màn hình chính, thông báo thử và mạng; app có quyền chưa chắc đã đăng ký cloud thành công |
| Không vào ngay sau bật | Bot đợi tín hiệu xác nhận mới; không vào lại tín hiệu đang hiển thị |
| Muốn tạm dừng | Tắt **Tự vào lệnh**. Lệnh đang mở vẫn được quản lý. Muốn dừng hẳn: đóng lệnh rồi **Dừng bot & ngắt kết nối** |
| Chạm hạn mức Free | Xem Dashboard, đóng bớt tab/thiết bị; đợi reset. Không cần tự nâng cấp để tiếp tục thử |

## Kiểm thử và giới hạn bàn giao

Kiểm thử gồm RSI/sổ lệnh dùng chung; chạy alarm trên workerd/SQLite cục bộ; API xác thực/CORS; gửi push mã hóa bằng Web Crypto; khôi phục sau eviction; chống vào trùng; giữ auto và sổ; không ghi đè lịch sử; giao diện qua JSDOM. Dữ liệu Binance và nhà cung cấp push trong kiểm thử được mô phỏng. Chưa kiểm chứng egress Binance hoặc thông báo tới điện thoại thật từ tài khoản Cloudflare của bạn. Bước 3 là bước kiểm chứng thực tế.

Nguồn chính thức:

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/workers/wrangler/commands/

