# v3.8.0 — kết hợp Vercel + Cloudflare

**Vẫn chỉ giao dịch giả BTC, RSI v4.1. Không đặt lệnh thật.** Giữ app GitHub Pages; Vercel lấy dữ liệu OKX và xử lý lệnh; Cloudflare giữ lịch, sổ duy nhất và thông báo.

## Cài theo đúng thứ tự

### 1. Chuẩn bị khóa trên máy Windows

Giải nén gói FULL. Chép **`cloudflare/secrets.json` từ bản đang chạy** sang `cloudflare/secrets.json` của bản mới. Không xóa/đổi tên Worker hiện có.

Mở PowerShell trong thư mục `cloudflare` của bản mới:

```powershell
npm ci
npm run hybrid
```

Khi hỏi URL Vercel, có thể nhấn Enter để tạo khóa trước. Script giữ mã app/khóa push cũ, thêm khóa riêng `EXECUTOR_TOKEN`. Mở **`cloudflare/hybrid-connection.txt`** để lấy giá trị này. Không gửi khóa vào chat, không tải file đó hoặc `secrets.json` lên GitHub.

### 2. Đưa mã công khai lên GitHub và deploy Vercel

Trong gói FULL có thư mục **`GITHUB_UPLOAD`** được chuẩn bị sẵn chỉ chứa file công khai. Tải **NỘI DUNG bên trong thư mục này** đè vào thư mục gốc repo `tu1703vuive-sudo/BinanceSignalMobile`. Không tải nguyên thư mục thành `repo/GITHUB_UPLOAD/`.

Phải có ở gốc repo: `api/`, `vercel/`, `cloudflare/engine.mjs`, `hybrid-protocol.mjs`, `package.json`, `package-lock.json`, `vercel.json` và các module/giao diện đi kèm. Chỉ cập nhật 12 file giao diện như bản cũ sẽ chưa tạo được backend Vercel.

Trên Vercel:

1. **Add New → Project**, import repo trên.
2. Root Directory: để **gốc repo**. Framework Preset: **Other**. Node.js: **24.x**. Cấu hình trong `vercel.json` đã đặt vùng `sin1`, không cần Cron/Daemon.
3. Trước khi Deploy, thêm Environment Variable cho **Production**:

| Tên | Giá trị |
|---|---|
| `EXECUTOR_TOKEN` | Chép nguyên giá trị trong `cloudflare/hybrid-connection.txt` |

4. Deploy. Nếu thêm/sửa biến môi trường sau khi đã deploy, **Redeploy** để phiên bản Production nhận khóa.
5. Lấy domain Production ổn định, ví dụ `https://ten-du-an.vercel.app`. Dùng domain của project, tránh URL Preview của một commit cũ.

Mở `https://ten-du-an.vercel.app/api/health`: cần thấy `version: 3.8.0`, `platform: vercel`, `configured: true`. Đây chỉ xác nhận backend/biến môi trường, chưa xác nhận kết nối OKX.

Endpoint cần truy cập được từ Cloudflare. Nếu Vercel Authentication/Deployment Protection chặn Production, cấu hình quyền truy cập cho backend này; API `/api/run` vẫn tự kiểm tra Bearer token và từ chối sai khóa. Nếu muốn giữ Protection, có thể đặt thêm secret Cloudflare `VERCEL_PROTECTION_BYPASS` bằng automation-bypass secret do Vercel của bạn cấp. Không gửi bất kỳ khóa nào vào chat.

### 3. Nối Cloudflare đang chạy sang Vercel

Quay lại PowerShell trong thư mục `cloudflare` mới:

```powershell
npm run hybrid -- https://ten-du-an.vercel.app
npm run deploy
```

Thay domain ví dụ bằng domain Production của bạn. Nếu Wrangler yêu cầu đăng nhập, chạy `npm run login` rồi deploy lại.

Script thêm `EXECUTOR_URL` và `EXECUTOR_TOKEN` vào secrets của **Worker cũ**. Tên vẫn là `binance-signal-paper`, singleton vẫn `paper-account-v1`, binding/migrations vẫn giữ nguyên. Không tạo Worker thứ hai để chạy cùng một sổ.

Sau deploy, script kiểm tra từ **Cloudflare → Vercel → OKX**. Chỉ khi đủ năm khung, đúng phiên bản và đã nhận kết quả Vercel hợp lệ mới xác nhận sẵn sàng. Nếu tự vào lệnh đang TẮT, cài đặt cũ vẫn được giữ TẮT.

### 4. Mở lại app trên điện thoại

GitHub Pages đã cập nhật bằng nội dung `GITHUB_UPLOAD` ở bước 2. Đợi Pages deploy xong rồi đóng/mở app; Cài đặt cần hiện **v3.8.0**.

Giữ URL Cloudflare/mã kết nối app hiện tại. **Không điền URL Vercel vào ô máy chủ trong app.** Vercel là dịch vụ xử lý phía sau Cloudflare.

Đợi Paper hiện **Cloudflare + Vercel 24/7 · BTCUSDT · OKX Spot · đang chạy**. Trong Cài đặt kết nối có bộ đếm lượt Vercel và nút **Kiểm tra Vercel + OKX**. Nhấn **Bật thông báo thiết bị / ✓ Đã bật thông báo** để gửi thử. iPhone mở app từ Màn hình chính và cấp quyền thông báo.

## Giữ dữ liệu và chạy nền

- Cloudflare giữ số dư, cấu hình, lịch sử, auto, đăng ký push và hàng đợi thông báo. Không chuyển database sang Vercel, không cần tạo database thứ ba.
- Khóa Vercel tách khỏi BOT_TOKEN của app và khóa VAPID. Các khóa app/push không được gửi cho Vercel. Mỗi tác vụ chỉ gửi trạng thái cần thiết, vị thế hiện tại và cache RSI; không gửi toàn bộ lịch sử đã đóng.
- Vercel chỉ tính kết quả của một lượt và trả về; không giữ sổ, không có lịch chạy riêng, không tự gửi push. Cloudflare kiểm tra revision, thời gian, điều kiện RSI và phép tính sổ trước khi ghi sổ cùng thông báo trong một transaction.
- Không có lệnh: lịch kiểm tra khi nến 15m đóng. Có lệnh: kiểm tra nến 1 phút đã đóng, tiếp tục cơ chế SL/TP hiện tại. Không đổi chiến lược, SL/TP, số tiền lệnh hoặc phí đã lưu.
- Nếu Vercel lỗi/mất kết nối/phản hồi sai hoặc quá muộn, giữ sổ và chờ thử lại; không tự bật thêm bot trên Cloudflare/trình duyệt. Đóng app hay tắt máy tính không dừng lịch đã deploy.
- Giữ cache/pacing/cooldown 429. Chuyển dịch vụ không cam kết gỡ giới hạn từ OKX. Bản này không xoay domain/IP hoặc tự đổi nguồn để thử liên tục.
- Vị thế Binance cũ vẫn quản lý bằng đúng nguồn Binance qua Vercel; không dùng giá OKX để giả đóng vị thế cũ.

## Chi phí và kiểm tra thực tế

Thiết kế dùng Functions theo từng lượt trên Vercel Hobby, không cần Daemon chiếm RAM cả ngày hoặc Cron Vercel mỗi phút. Hạn mức Vercel/Cloudflare và các project khác vẫn ảnh hưởng khả năng chạy; không cam kết miễn phí hay hoạt động đủ tháng trong mọi tình huống. Xem Usage ở cả hai Dashboard. App mở mỗi 10 giây chỉ đọc trạng thái Cloudflare, không gọi Vercel mỗi lần đọc.

Chưa deploy vào tài khoản Vercel/Cloudflare của bạn. Đã kiểm thử HTTP executor thật ở môi trường cục bộ; workerd/SQLite alarm → Vercel runner → ghi sổ/push, restart và lỗi kết nối với dữ liệu/push mô phỏng. Việc lấy OKX từ Vercel thực tế và thông báo tới điện thoại được xác nhận sau các bước triển khai trên.

## Khi gặp lỗi

| Hiện tượng | Kiểm tra |
|---|---|
| Vercel `/api/health` 404 | Mã `api/` chưa nằm ở gốc repo hoặc Root Directory sai; deploy lại |
| `configured: false` | Thiếu `EXECUTOR_TOKEN` ở Production hoặc chưa Redeploy sau khi thêm |
| Vercel 401/403 hoặc trang đăng nhập | Hai bên dùng khác token, hoặc Deployment Protection đang chặn |
| Chưa kết nối Vercel trong Paper | Chạy `npm run hybrid -- https://...vercel.app` trong bản mới, rồi deploy Cloudflare |
| Sai phiên bản hoặc phản hồi không khớp | Deploy cả hai bên từ cùng gói v3.8.0; giữ sổ và khóa cũ |
| OKX 429/403 từ Vercel | Đợi đúng cooldown, kiểm tra kết quả mới. Không có bảo đảm đổi nơi chạy sẽ hết bị từ chối |
| Còn cooldown ngay sau nâng cấp | Đây là thời gian chờ đã lưu của bản cũ; bản mới không ép gọi lại trước hạn |
| Không nhận push | Kiểm tra quyền/đăng ký thiết bị và thông báo thử; VAPID cũ phải được giữ |

Nguồn cấu hình: [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), [Environment Variables](https://vercel.com/docs/environment-variables).
