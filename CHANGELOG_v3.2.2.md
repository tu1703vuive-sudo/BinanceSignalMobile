# v3.2.2 - Mini Chart V2 + UI Polish

## Performance
- Chart rendering throttled to ~90 ms during rapid kline updates.
- Canvas backing store is resized only when CSS size/DPR changes.
- Per-candle shadow blur removed to reduce GPU work.
- Chart continues to consume the v3.2.1 in-memory candle cache; no new chart-only REST requests.

## Visual / UX
- Compact seven-button timeframe selector.
- Volume strip beneath price candles.
- Current-price guide and price tag.
- Support/Resistance bands retained from the existing engine.
- Entry/Watch zone, Stop Loss and TP1-TP3 are drawn when available.
- Crosshair/OHLC inspection on pointer/touch.
- LIVE/SYNC badge and visible-candle/cache status.

## Unchanged
- Short Engine V2.2
- Swing Engine
- Support/Resistance calculation
- Entry/SL/TP calculation
- localStorage/watchlist/favorites
- Binance data endpoints
