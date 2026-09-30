# v3.2.3 - Data Integrity Guard

## Added
- Candle integrity validator: malformed OHLCV, duplicates, ordering and missing intervals.
- Automatic WebSocket gap detection and REST resync.
- Resume/online reconciliation after background/offline periods.
- REST timeout + bounded retry/backoff.
- Data health states: LIVE, RESYNCING, STALE, SYNC.
- Signal guard: invalid/gapped analysis data yields WAIT instead of a trading signal.

## Unchanged
- Short V2.2 strategy logic and weights.
- Swing strategy logic.
- Existing Support/Resistance algorithm.
- Mini Chart V2 presentation/levels.
