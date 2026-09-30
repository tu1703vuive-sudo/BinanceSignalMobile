# Binance Signal Web

Bản web-only dành cho GitHub Pages. Không cần .NET, C#, Node.js hay server riêng.

## File cần có trên GitHub

- `index.html`
- `styles.css`
- `app.js`
- `sw.js`
- `manifest.webmanifest`
- `.nojekyll`
- `icons/icon-192.png`
- `icons/icon-512.png`

## Engine

### Ngắn hạn
- 4H: 45%
- 1H: 35%
- 15m: 20%
- Không dùng 5m.

### Dài hạn
- 1W: 30%
- 1D: 30%
- 12H: 20%
- 4H: 20%

Mỗi timeframe tạo bias từ EMA20/50/200, MACD histogram, RSI14 và market structure.
Support/Resistance dùng pivot được gom cụm đa timeframe.

`Độ đồng thuận` là điểm của bộ luật, **không phải xác suất thắng**.

## Upload lên GitHub Pages

1. Sao lưu repo cũ nếu cần.
2. Xóa các file/folder cũ trong branch `main`.
3. Upload toàn bộ nội dung trong thư mục này vào **root** của repo.
4. GitHub: Settings → Pages → Deploy from a branch → `main` → `/(root)`.
5. Mở:
   `https://<username>.github.io/<repository>/`

Nếu vừa cập nhật mà vẫn thấy giao diện cũ:
- tải lại trang bằng Ctrl+F5, hoặc
- DevTools → Application → Service Workers → Unregister, sau đó reload.

## Lưu ý

Ứng dụng chỉ đọc dữ liệu thị trường công khai. Không chứa API key và không gửi lệnh giao dịch.


## Mobile Fixed UI

Bản này khóa giao diện theo mobile:
- max-width 480px
- desktop vẫn hiển thị khung mobile ở giữa
- hỗ trợ safe-area iPhone
- control cao 48px
- font input/select 16px để tránh iOS auto-zoom
- bảng dữ liệu cuộn ngang
- không thay đổi logic Signal Engine
