# Changelog v3.2.5 — Indicator Settings

## Added
- Gear settings button on the mini chart.
- Persistent visual toggles for RSI 14, Volume, Support/Resistance, Entry/SL/TP and Crosshair/OHLC.
- Three display presets: Tối giản, Trading and Đầy đủ.
- Chart display preferences saved in `localStorage` (`bsm_chart_layers`).

## Behavior
- These settings only change what is drawn on the chart.
- Signal Engine, Short V2.2, Swing, Support/Resistance calculations, Entry/SL/TP calculations and Binance data logic are unchanged.
- Turning RSI off hides the RSI panel but does not change any RSI calculation used by analysis.

## Presets
- Tối giản: Price + Entry/SL/TP.
- Trading: RSI + S/R + Entry/SL/TP + Crosshair.
- Đầy đủ: RSI + Volume + S/R + Entry/SL/TP + Crosshair.
