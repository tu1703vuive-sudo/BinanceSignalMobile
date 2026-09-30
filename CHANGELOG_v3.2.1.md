# v3.2.1 - WebSocket / Candle Cache

## Performance/data-layer changes
- Closed kline events update the in-memory candle cache and re-run analysis from cache.
- Full 260-candle REST reload is no longer performed after every analysis candle close.
- REST is used for initial hydrate, stale/missing cache, manual refresh, reconnect resync and resume/online resync.
- Duplicate REST requests for the same market/symbol/timeframe are coalesced.
- Cache is capped at 35 symbol-timeframe entries with LRU-like pruning of old non-current entries.
- Ticker DOM rendering is batched to ~120 ms instead of rebuilding on every miniTicker message.
- Chart drawing is batched with requestAnimationFrame.
- WebSocket reconnect uses exponential backoff, then REST resyncs candles after reconnection.

## Unchanged
- Short Engine V2.2 logic
- Swing Engine logic
- Support/Resistance logic from v3.2.0
- UI/layout
- localStorage keys and user watchlist/favorites
