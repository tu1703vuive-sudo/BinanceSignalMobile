# BinanceSignalMobile v3.3.0 — S/R V2

## Nâng cấp v3.3.0

- Short Engine giữ nguyên V2.2: 4H 45% • 1H 35% • 15m 20%.
- S/R V2 cho Short chuyển từ cực trị đơn sang **Pivot Cluster**.
- Gom các pivot gần nhau thành vùng giá theo ATR.
- Ưu tiên vùng có nhiều lần chạm, rejection tốt, còn mới và gần giá hiện tại.
- Không dùng support nằm sai phía trên giá / resistance nằm sai phía dưới giá làm fallback.
- Mỗi timeframe có thể đóng góp tối đa 2 vùng trước khi merge đa khung.
- Bump PWA asset/cache lên v3.3.0 để website nhận code mới.

## Không thay đổi

- UI
- Swing Engine
- localStorage/watchlist/favorites
- Binance Futures public API
- Short weights / RR threshold

## Version

- `APP_VERSION = 3.3.0`
- `ENGINE_VERSION = short-v2.2+sr-v2.0`
- `SR_VERSION = sr-v2.0`
