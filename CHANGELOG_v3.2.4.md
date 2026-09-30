# v3.2.4 - RSI 14 Chart Panel

## Added
- RSI (14) panel integrated into the Mini Chart card.
- 70 / 50 / 30 reference levels and subtle overbought/oversold bands.
- Current RSI value badge.
- Synchronized crosshair/hover between price candles and RSI.
- RSI recalculates from the existing in-memory candle cache; no extra REST request.

## Performance
- RSI redraw is tied to the existing throttled chart render loop.
- Canvas DPR remains capped, avoiding an extra high-DPI rendering penalty on mobile.

## Unchanged
- Short V2.2 signal logic and weights.
- Swing signal logic.
- Existing Support/Resistance algorithm.
- Entry / SL / TP logic.
- WebSocket/candle cache and Data Integrity Guard behavior.
