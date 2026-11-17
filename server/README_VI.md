# Cài máy chủ Paper Trading 24/7

Máy chủ cần **Node.js 24+**, kết nối Binance Futures public, ổ đĩa bền và hoạt động liên tục. Có thể đặt trên VPS, hoặc máy Windows luôn bật. Máy tính tắt/ngủ hoặc VPS bị dừng thì bot cũng dừng. Không dùng GitHub Actions, hosting chỉ chạy frontend hoặc máy chủ tự ngủ để thay thế tiến trình bot liên tục.

Giao diện có thể tiếp tục ở GitHub Pages, hoặc được phục vụ từ chính máy chủ HTTPS. Không cần Binance API key. Chỉ một tiến trình bot chạy trên một thư mục dữ liệu; không chạy nhiều bản/cluster dùng chung SQLite.

## 1. Tạo cấu hình riêng

Tại thư mục `server`:

```powershell
npm ci
npm run setup
```

Lệnh setup tạo:

- `server/.env`: mã kết nối ngẫu nhiên `BOT_TOKEN`, địa chỉ origin được phép và cổng.
- `server/data/vapid.json`: cặp khóa ký Web Push bền vững.

Sửa `VAPID_SUBJECT` thành email liên hệ thật. `ALLOWED_ORIGINS` là **origin**, không gồm đường dẫn repo; ví dụ:

```text
ALLOWED_ORIGINS=https://tu1703vuive-sudo.github.io,https://bot.tenmiencuaban.com
VAPID_SUBJECT=mailto:email-cuaban@example.com
```

Giữ kín `.env` và thư mục `data`. Không commit/upload chúng lên GitHub hoặc gửi mã kết nối vào chat. Nhập mã riêng vào trường mật khẩu trong app. Thiết bị sẽ lưu kết nối để không phải nhập lại mỗi lần.

Nếu không có Node trên VPS nhưng có Docker, có thể chạy bước setup từ image Node chính thức ở thư mục gốc đã giải nén:

```bash
docker run --rm -v "$PWD:/app" -w /app/server node:24-alpine sh -c "npm ci && npm run setup"
```

## 2A. VPS/Docker, HTTPS và tự khởi động lại

Cần tên miền trỏ tới VPS và cổng 80/443 có thể truy cập. Không có tên miền hoặc VPS nào được tạo tự động trong gói này.

Ở thư mục gốc, tạo `.env` riêng cho Compose:

```text
SITE_DOMAIN=bot.tenmiencuaban.com
```

Kiểm tra `server/.env` đã có cấu hình riêng từ bước 1. Khởi chạy:

```bash
docker compose up -d --build
docker compose logs --tail=40 bot
```

Caddy nhận chứng chỉ HTTPS cho tên miền đã cấu hình và chuyển API tới bot. Docker đặt chính sách tự khởi động lại. Cổng bot 8787 chỉ nằm trong mạng Docker; cổng công khai là HTTPS qua Caddy. Với deployment này, có thể mở luôn `https://bot.tenmiencuaban.com/` làm giao diện, hoặc giữ giao diện GitHub Pages và nhập URL này trong app.

Máy chủ không tự biến URL mẫu thành URL hoạt động. Cần DNS, kết nối Internet và dịch vụ Docker thực sự chạy trên máy của bạn. Không bỏ kiểm tra chứng chỉ nếu cấu hình HTTPS lỗi.

## 2B. Máy Windows luôn bật

Cài Node.js 24+ từ nguồn chính thức. Mở PowerShell:

```powershell
cd DUONG_DAN_GIAI_NEN\server
npm ci
npm run setup
npm start
```

Kiểm tra tại `http://127.0.0.1:8787/health`. Địa chỉ localhost này chỉ phục vụ kiểm tra trên chính máy Windows; điện thoại không dùng URL đó để truy cập máy tính.

Script `START_WINDOWS.ps1` chạy bot và khởi động lại nếu tiến trình kết thúc. Muốn tự chạy khi Windows khởi động, tạo tác vụ Task Scheduler chạy script này bằng tài khoản của bạn; giữ máy không ngủ. Đây vẫn chưa phải HTTPS công khai cho điện thoại: cần reverse proxy HTTPS bằng Caddy/tên miền tới cổng 8787, hoặc môi trường hosting HTTPS tương đương do bạn cấu hình. Phương án Docker/VPS ở trên có sẵn cấu hình Caddy hoàn chỉnh.

Không đưa cổng HTTP không xác thực TLS trực tiếp lên Internet. Không để chế độ sleep rồi kỳ vọng bot còn chạy.

## 3. Kết nối điện thoại và nhận push

1. Mở app đã cập nhật v3.3.0.
2. Trong Paper Trading, mở cấu hình **Chạy 24/7 & thông báo đẩy**.
3. Nhập URL HTTPS và mã `BOT_TOKEN` đã tạo. Bấm Kết nối.
4. Bật thông báo, chấp thuận yêu cầu của hệ điều hành một lần. Thông báo thử gửi riêng tới thiết bị vừa đăng ký.
5. Với iPhone/iPad: dùng app đã thêm ra Màn hình chính. Hỗ trợ/hiển thị thông báo còn phụ thuộc phiên bản OS, quyền, Focus và chính sách trình duyệt.

Quyền đã cấp được thiết bị ghi nhớ. Không thể dùng JavaScript để tự cấp quyền hoặc vượt qua việc người dùng từ chối. Nếu server được kết nối nhưng chưa có quyền, bot vẫn chạy nhưng điện thoại chưa nhận push.

Mặc định sổ máy chủ mới có vốn 10.000 USDT và **tự mở lệnh bật**. Nếu cần sổ cũ, dùng nút **Chuyển sổ hiện tại lên máy chủ** khi máy chủ chưa có lệnh. Máy chủ không cho ghi đè một sổ đã có lịch sử/vị thế. Sổ trình duyệt gốc vẫn được giữ.

Nút tự vào lệnh điều khiển trạng thái trên server. Tắt app, đóng PWA hoặc mở lại không tắt trạng thái đó. Đổi coin khi kết nối điều khiển coin bot theo dõi cho tín hiệu mới. Nếu bạn chủ động tắt tự mở lệnh trên một thiết bị, thiết bị khác cũng nhìn thấy trạng thái tắt của cùng sổ.

## Vận hành, dữ liệu và thông báo

- SQLite lưu trong `server/data/paper.sqlite` (kèm các file WAL nếu đang chạy); khóa push trong cùng thư mục. Sao lưu khi bot đã dừng để có bộ file nhất quán. Không thay khóa VAPID mỗi lần restart vì subscription cũ gắn với khóa đó.
- API cần Bearer token. CORS giới hạn origin; không dùng token này cho bất kỳ tài khoản tiền thật nào.
- Worker kiểm tra khoảng 3 giây/lần, lấy 5 khung nến khi tới mốc 15M mới, xét đúng RSI chốt và cửa sổ tín hiệu mới 30 giây. Dùng cùng hai module `rsi-mtf.js` và `paper-trading.js` với giao diện để tránh lệch quy tắc.
- Lệnh mở được theo dõi dù không có điện thoại truy cập. Sau restart/khoảng trống dữ liệu, bot kiểm tra lại nến 1 phút trước khi tiếp tục. Các giới hạn khôi phục TP/SL và giả định SL trước khi cùng nến chạm hai mức vẫn áp dụng.
- Sổ và yêu cầu thông báo được ghi trong cùng giao dịch SQLite. Push lỗi tạm thời được thử lại; subscription hết hạn 404/410 bị loại. Hệ thống push có thể trễ hoặc không hiển thị do thiết bị/OS. Gửi lại có thể xảy ra sau sự cố; tag theo mã lệnh giúp gộp thông báo.
- Trạng thái HTTP server còn sống khác với dữ liệu Binance hợp lệ. Kiểm tra thêm dòng trạng thái trong Paper Trading; nếu worker báo lỗi, tự mở mới có thể phải chờ dữ liệu hợp lệ.
- Khi tab mở, giao diện đọc trạng thái mỗi 3 giây; chỉ tải thêm phần lịch sử mới sau lần đầu để giảm dữ liệu. Mất kết nối không kích hoạt bot local thay thế.

## Kiểm tra sau triển khai

- `/health` trả `ok: true`.
- App kết nối thành công, hiện **Máy chủ 24/7** và worker đang chạy.
- Mã kết nối sai bị từ chối.
- Thông báo thử đến đúng điện thoại.
- Đóng app rồi mở lại: trạng thái bật/tắt và lịch sử vẫn đúng.
- Restart container: sổ và trạng thái vẫn giữ.

Chưa có server của bạn được triển khai từ phiên chat này. Các bài test trong ZIP dùng giá và dịch vụ push mô phỏng; không chứng minh dịch vụ đã chạy trên VPS hoặc điện thoại của bạn.
