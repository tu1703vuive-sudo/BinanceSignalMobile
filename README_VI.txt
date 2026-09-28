BINANCE SIGNAL MOBILE iOS — PORT TỪ V3.1.4
==========================================

Đây là bản source iOS-ready dùng .NET MAUI, giữ nguyên engine C# từ bản Windows:
- BinanceService.cs
- IndicatorCalculator.cs
- SignalEngine.cs
- SignalLifecycleService.cs
- MarketCandle / SignalAnalysis / SignalLifecycle

ĐÃ CHUYỂN SANG iOS:
- Danh sách coin realtime qua Binance WebSocket
- % 24h
- Favorite
- Swing/Position và Short Term
- Phân tích multi-timeframe
- LONG/SHORT/WATCH/WAIT
- Entry / SL / TP1 / TP2 / TP3
- Signal lifecycle
- Lưu settings + lifecycle trong AppDataDirectory của iOS
- Candlestick chart cơ bản + vùng support/resistance
- Mở cặp coin trên Binance

KHÔNG CÓ TRÊN iOS (do giới hạn hệ điều hành):
- Always on Top
- Click-through / Freeze Window
- System Tray
- Kéo/resize cửa sổ kiểu Windows

CÁCH ÍT THAO TÁC NHẤT TỪ WINDOWS:
A) Đưa project này lên GitHub.
B) Mở tab Actions > "Build unsigned iPhone IPA" > Run workflow.
C) Tải artifact BinanceSignalMobile-unsigned.
D) Dùng Sideloadly trên Windows để ký IPA bằng Apple ID của chính bạn và cài lên iPhone.

GitHub Actions dùng máy macOS để compile iOS, nên bạn không cần sở hữu Mac.
IPA tạo theo workflow là bản chưa ký; Sideloadly sẽ ký lại cho thiết bị của bạn.

APPLE ID MIỄN PHÍ:
- Không cần đăng App Store.
- Provisioning profile hết hạn sau 7 ngày, sau đó cần ký/cài lại (hoặc để Sideloadly tự refresh khi có thể).

QUAN TRỌNG:
- Không gửi mật khẩu Apple ID cho bất kỳ ai, kể cả ChatGPT.
- Không đặt Apple ID/password trong GitHub repository hay source code.
- Nếu dùng tài khoản Apple có 2FA, công cụ sideload có thể yêu cầu quy trình xác thực riêng.
