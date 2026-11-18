# Signal v3.8.0 — Vercel + Cloudflare

App di động GitHub Pages, RSI v4.1 năm khung; chỉ paper trading BTC. Cloudflare giữ lịch, sổ lệnh và push; Vercel lấy OKX Spot và xử lý mỗi lượt.

Hướng dẫn triển khai: [CAP_NHAT_v3.8.0_VERCEL_CLOUDFLARE.md](CAP_NHAT_v3.8.0_VERCEL_CLOUDFLARE.md).

Cài Vercel từ gốc repo, đặt EXECUTOR_TOKEN ở Production. Cloudflare vẫn dùng Worker cũ và secrets trên máy riêng. Không tải secrets.json, connection.txt hoặc hybrid-connection.txt lên GitHub.

Kiểm thử: `npm run test:hybrid`. Kiểm thử Worker: chạy `npm ci` trong cloudflare, sau đó `npm test` hoặc `npm run test:hybrid-runtime`.
