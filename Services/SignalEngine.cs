using BinanceSignalMobile.Models;

namespace BinanceSignalMobile.Services;

public sealed class SignalEngine
{
    public SignalAnalysis AnalyzePosition(
        IReadOnlyList<MarketCandle> candles1M,
        IReadOnlyList<MarketCandle> candles1w,
        IReadOnlyList<MarketCandle> candles1d,
        IReadOnlyList<MarketCandle> candles12h,
        IReadOnlyList<MarketCandle> candles4h)
    {
        var c1M = ClosedCandles(candles1M);
        var c1w = ClosedCandles(candles1w);
        var c1d = ClosedCandles(candles1d);
        var c12h = ClosedCandles(candles12h);
        var c4h = ClosedCandles(candles4h);

        // Monthly data is allowed to be shorter for newer coins, but weekly/daily
        // need enough history to avoid basing a multi-week setup on only a few candles.
        if (c1w.Count < 55 || c1d.Count < 60 || c12h.Count < 60 || c4h.Count < 60)
        {
            return new SignalAnalysis
            {
                Kind = SignalKind.Wait,
                AnalysisMode = "SWING / POSITION",
                Reasons = new List<string>
                {
                    "Chưa đủ dữ liệu nến đã đóng ở khung lớn để phân tích vị thế an toàn."
                },
                PlanHint = "WAIT - đang chờ đủ dữ liệu 1W / 1D / 12H / 4H."
            };
        }

        var reasons = new List<string>();

        var trend1M = Trend(c1M, 6, 12);
        var trend1W = Trend(c1w, 20, 50);
        var trend1D = AdaptiveTrend(c1d);
        var trend12H = AdaptiveTrend(c12h);
        var trend4H = Trend(c4h, 20, 50);
        var structure1D = IndicatorCalculator.MarketStructure(c1d);

        var score = 0;
        score += trend1M * 15;
        score += trend1W * 25;
        score += trend1D * 25;
        score += trend12H * 15;
        score += structure1D * 10;

        reasons.Add(TrendReason("1M", trend1M, "chu kỳ lớn"));
        reasons.Add(TrendReason("1W", trend1W, "xu hướng chính"));
        reasons.Add(TrendReason("1D", trend1D, "setup chính"));
        reasons.Add(TrendReason("12H", trend12H, "bối cảnh vào vùng"));
        reasons.Add(structure1D switch
        {
            1 => "✓ 1D: cấu trúc High/Low đang nâng dần",
            -1 => "✓ 1D: cấu trúc High/Low đang hạ dần",
            _ => "○ 1D: cấu trúc đang đi ngang / chưa xác nhận"
        });

        var closes4h = c4h.Select(c => c.Close).ToList();
        var rsi4h = IndicatorCalculator.Rsi(closes4h);
        var macd4h = IndicatorCalculator.Macd(closes4h);
        var ema20_4h = IndicatorCalculator.Ema(closes4h, 20);
        var last4h = c4h[^1];
        var trigger4h = 0;

        if (last4h.Close > ema20_4h && rsi4h >= 52m && rsi4h < 72m && macd4h.Histogram > 0m)
        {
            trigger4h = 1;
            score += 10;
            reasons.Add($"✓ 4H: trigger tăng (RSI {rsi4h:0.0}, MACD dương)");
        }
        else if (last4h.Close < ema20_4h && rsi4h <= 48m && rsi4h > 28m && macd4h.Histogram < 0m)
        {
            trigger4h = -1;
            score -= 10;
            reasons.Add($"✓ 4H: trigger giảm (RSI {rsi4h:0.0}, MACD âm)");
        }
        else
        {
            reasons.Add($"○ 4H: chưa có trigger rõ (RSI {rsi4h:0.0})");
        }

        var avgVolumeD1 = IndicatorCalculator.AveragePreviousVolume(c1d, 20);
        var lastD1 = c1d[^1];
        var volumeRatio = avgVolumeD1 <= 0m ? 0m : lastD1.Volume / avgVolumeD1;
        reasons.Add(volumeRatio >= 1.20m
            ? $"✓ Volume 1D nổi bật ({volumeRatio:0.0}x trung bình 20D)"
            : $"○ Volume 1D bình thường ({volumeRatio:0.0}x trung bình 20D)");

        score = Math.Clamp(score, -100, 100);

        var currentPrice = last4h.Close;
        var atr4h = SafeAtr(c4h, currentPrice * 0.01m);
        var atr1d = SafeAtr(c1d, currentPrice * 0.025m);

        // V3.1.4 mode-aware S/R:
        // Swing uses longer lookbacks and wider ATR zones because these levels are
        // intended to survive normal 4H/D1 noise and represent position-trading areas.
        var rawSupports = new List<PriceZone>
        {
            BuildSupportZone(c1w, 52, "1W", 0.75m, SrProfile.Swing),
            BuildSupportZone(c1d, 120, "1D", 0.65m, SrProfile.Swing),
            BuildSupportZone(c12h, 140, "12H", 0.55m, SrProfile.Swing),
            BuildSupportZone(c4h, 150, "4H", 0.50m, SrProfile.Swing)
        };
        var rawResistances = new List<PriceZone>
        {
            BuildResistanceZone(c1w, 52, "1W", 0.75m, SrProfile.Swing),
            BuildResistanceZone(c1d, 120, "1D", 0.65m, SrProfile.Swing),
            BuildResistanceZone(c12h, 140, "12H", 0.55m, SrProfile.Swing),
            BuildResistanceZone(c4h, 150, "4H", 0.50m, SrProfile.Swing)
        };

        // Monthly zones are macro context only. Newer coins may not have enough 1M candles,
        // so add them only when there is a usable history.
        if (c1M.Count >= 8)
        {
            rawSupports.Add(BuildSupportZone(c1M, Math.Min(18, c1M.Count), "1M", 0.85m, SrProfile.Swing));
            rawResistances.Add(BuildResistanceZone(c1M, Math.Min(18, c1M.Count), "1M", 0.85m, SrProfile.Swing));
        }

        var allSupports = MergeZones(rawSupports, SrProfile.Swing, 0.55m);
        var allResistances = MergeZones(rawResistances, SrProfile.Swing, 0.55m);

        var supportZones = RankSupportZones(allSupports, currentPrice).Take(4).ToList();
        var resistanceZones = RankResistanceZones(allResistances, currentPrice).Take(4).ToList();

        var primarySupport = supportZones.FirstOrDefault(z => z.Low <= currentPrice + (0.25m * atr4h));
        var primaryResistance = resistanceZones.FirstOrDefault(z => z.High >= currentPrice - (0.25m * atr4h));

        primarySupport ??= supportZones.FirstOrDefault();
        primaryResistance ??= resistanceZones.FirstOrDefault();

        var monthlyWeeklyConflict = trend1M != 0 && trend1W != 0 && trend1M != trend1W;
        var weeklyDailyConflict = trend1W != 0 && trend1D != 0 && trend1W != trend1D;

        var longBias = trend1W > 0 && trend1D > 0 && trend1M >= 0;
        var shortBias = trend1W < 0 && trend1D < 0 && trend1M <= 0;

        if (monthlyWeeklyConflict)
            reasons.Insert(0, "⚠ 1M và 1W xung đột → chưa phù hợp để giữ vị thế dài.");
        else if (weeklyDailyConflict)
            reasons.Insert(0, "⚠ 1W và 1D xung đột → ưu tiên WAIT.");

        var nearSupport = primarySupport is not null &&
                          currentPrice >= primarySupport.Low - (0.25m * atr4h) &&
                          currentPrice <= primarySupport.High + (0.55m * atr4h);
        var nearResistance = primaryResistance is not null &&
                             currentPrice <= primaryResistance.High + (0.25m * atr4h) &&
                             currentPrice >= primaryResistance.Low - (0.55m * atr4h);

        var tooCloseToResistanceForLong = primaryResistance is not null &&
                                           primaryResistance.Low > currentPrice &&
                                           primaryResistance.Low - currentPrice < 0.75m * atr1d;
        var tooCloseToSupportForShort = primarySupport is not null &&
                                         primarySupport.High < currentPrice &&
                                         currentPrice - primarySupport.High < 0.75m * atr1d;

        SignalKind kind;
        if (monthlyWeeklyConflict || weeklyDailyConflict)
        {
            kind = SignalKind.Wait;
        }
        else if (longBias && score >= 65 && trigger4h > 0 && nearSupport && !tooCloseToResistanceForLong)
        {
            kind = SignalKind.Long;
        }
        else if (shortBias && score <= -65 && trigger4h < 0 && nearResistance && !tooCloseToSupportForShort)
        {
            kind = SignalKind.Short;
        }
        else if (longBias && score >= 45)
        {
            kind = SignalKind.WatchLong;
        }
        else if (shortBias && score <= -45)
        {
            kind = SignalKind.WatchShort;
        }
        else
        {
            kind = SignalKind.Wait;
        }

        if (tooCloseToResistanceForLong && longBias)
            reasons.Insert(0, "⚠ Giá đang sát kháng cự khung lớn → chưa xác nhận LONG mới.");
        if (tooCloseToSupportForShort && shortBias)
            reasons.Insert(0, "⚠ Giá đang sát hỗ trợ khung lớn → chưa xác nhận SHORT mới.");

        decimal? watchLow = null;
        decimal? watchHigh = null;
        var watchSource = "";
        var watchTriggerText = "";

        if (kind == SignalKind.WatchLong && primarySupport is not null)
        {
            watchLow = primarySupport.Low;
            watchHigh = primarySupport.High;
            watchSource = $"[{primarySupport.FrameLabel}] {primarySupport.Strength}";
            watchTriggerText = "Chờ giá phản ứng tại vùng hỗ trợ và nến 4H xác nhận tăng; không đuổi giá nếu chưa retest.";
        }
        else if (kind == SignalKind.WatchShort && primaryResistance is not null)
        {
            watchLow = primaryResistance.Low;
            watchHigh = primaryResistance.High;
            watchSource = $"[{primaryResistance.FrameLabel}] {primaryResistance.Strength}";
            watchTriggerText = "Chờ giá phản ứng tại vùng kháng cự và nến 4H xác nhận giảm; không đuổi giá nếu chưa retest.";
        }

        var hasPlan = kind is SignalKind.Long or SignalKind.Short;
        decimal? entryLow = null;
        decimal? entryHigh = null;
        decimal? stop = null;
        decimal? tp1 = null;
        decimal? tp2 = null;
        decimal? tp3 = null;
        var triggerText = "";
        var invalidationText = "";
        decimal? invalidationLevel = null;

        if (hasPlan && kind == SignalKind.Long && primarySupport is not null)
        {
            entryLow = primarySupport.Low;
            entryHigh = primarySupport.High;
            stop = primarySupport.Low - (0.60m * atr1d);
            invalidationLevel = stop;
            var midpoint = (entryLow.Value + entryHigh.Value) / 2m;
            var risk = midpoint - stop.Value;

            var aboveResistances = resistanceZones
                .Where(z => z.Low > midpoint)
                .OrderBy(z => z.Low)
                .ToList();

            var targets = BuildOrderedLongTargets(
                midpoint,
                risk,
                aboveResistances.Select(z => z.Low));
            tp1 = targets[0];
            tp2 = targets[1];
            tp3 = targets[2];

            if (risk <= 0m || tp1.Value - midpoint < 1.35m * risk)
            {
                hasPlan = false;
                kind = SignalKind.WatchLong;
                watchLow = primarySupport.Low;
                watchHigh = primarySupport.High;
                watchSource = $"[{primarySupport.FrameLabel}] {primarySupport.Strength}";
                watchTriggerText = "Vùng hỗ trợ hợp lệ nhưng khoảng trống tới kháng cự chưa đủ tốt; tiếp tục chờ.";
            }
            else
            {
                triggerText = "4H đóng xác nhận tăng tại vùng hỗ trợ; 1D/1W vẫn giữ bias tăng.";
                invalidationText = $"Luận điểm LONG yếu đi nếu 1D đóng dưới {FormatLevel(stop.Value)}.";
            }
        }
        else if (hasPlan && kind == SignalKind.Short && primaryResistance is not null)
        {
            entryLow = primaryResistance.Low;
            entryHigh = primaryResistance.High;
            stop = primaryResistance.High + (0.60m * atr1d);
            invalidationLevel = stop;
            var midpoint = (entryLow.Value + entryHigh.Value) / 2m;
            var risk = stop.Value - midpoint;

            var belowSupports = supportZones
                .Where(z => z.High < midpoint)
                .OrderByDescending(z => z.High)
                .ToList();

            var targets = BuildOrderedShortTargets(
                midpoint,
                risk,
                belowSupports.Select(z => z.High));
            tp1 = targets[0];
            tp2 = targets[1];
            tp3 = targets[2];

            if (risk <= 0m || midpoint - tp1.Value < 1.35m * risk)
            {
                hasPlan = false;
                kind = SignalKind.WatchShort;
                watchLow = primaryResistance.Low;
                watchHigh = primaryResistance.High;
                watchSource = $"[{primaryResistance.FrameLabel}] {primaryResistance.Strength}";
                watchTriggerText = "Vùng kháng cự hợp lệ nhưng khoảng trống tới hỗ trợ chưa đủ tốt; tiếp tục chờ.";
            }
            else
            {
                triggerText = "4H đóng xác nhận giảm tại vùng kháng cự; 1D/1W vẫn giữ bias giảm.";
                invalidationText = $"Luận điểm SHORT yếu đi nếu 1D đóng trên {FormatLevel(stop.Value)}.";
            }
        }

        if (kind == SignalKind.WatchLong && primarySupport is not null && string.IsNullOrWhiteSpace(invalidationText))
        {
            var invalid = primarySupport.Low - (0.60m * atr1d);
            invalidationLevel = invalid;
            invalidationText = $"Vùng canh mất ý nghĩa nếu 1D đóng dưới khoảng {FormatLevel(invalid)}.";
        }
        else if (kind == SignalKind.WatchShort && primaryResistance is not null && string.IsNullOrWhiteSpace(invalidationText))
        {
            var invalid = primaryResistance.High + (0.60m * atr1d);
            invalidationLevel = invalid;
            invalidationText = $"Vùng canh mất ý nghĩa nếu 1D đóng trên khoảng {FormatLevel(invalid)}.";
        }

        var breakoutAlternative = BuildBreakoutAlternative(kind, primarySupport, primaryResistance, atr1d);

        var planHint = kind switch
        {
            SignalKind.WatchLong when primarySupport is not null
                => $"CANH LONG vùng {FormatLevel(primarySupport.Low)} – {FormatLevel(primarySupport.High)} {watchSource}. Đây là vùng chờ, chưa phải lệnh.",
            SignalKind.WatchShort when primaryResistance is not null
                => $"CANH SHORT vùng {FormatLevel(primaryResistance.Low)} – {FormatLevel(primaryResistance.High)} {watchSource}. Đây là vùng chờ, chưa phải lệnh.",
            SignalKind.Wait when primarySupport is not null && primaryResistance is not null
                => $"WAIT - hỗ trợ gần {FormatLevel(primarySupport.Low)}–{FormatLevel(primarySupport.High)} [{primarySupport.FrameLabel}] • kháng cự gần {FormatLevel(primaryResistance.Low)}–{FormatLevel(primaryResistance.High)} [{primaryResistance.FrameLabel}].",
            _ => "WAIT - chưa có setup vị thế rõ."
        };

        return new SignalAnalysis
        {
            Kind = kind,
            Score = score,
            AnalysisMode = "SWING / POSITION",
            TimeframesDisplay = $"{FormatTimeframe("1M", trend1M)}   {FormatTimeframe("1W", trend1W)}   {FormatTimeframe("1D", trend1D)}   {FormatTimeframe("12H", trend12H)}   {FormatTimeframe("4H", trigger4h != 0 ? trigger4h : trend4H)}",
            Reasons = reasons.Take(9).ToList(),
            HasTradePlan = hasPlan,
            EntryLow = entryLow,
            EntryHigh = entryHigh,
            StopLoss = stop,
            TakeProfit1 = tp1,
            TakeProfit2 = tp2,
            TakeProfit3 = tp3,
            WatchLow = watchLow,
            WatchHigh = watchHigh,
            WatchZoneSource = watchSource,
            TriggerText = triggerText,
            WatchTriggerText = watchTriggerText,
            PlanHint = planHint,
            SupportZones = supportZones,
            ResistanceZones = resistanceZones,
            PrimarySupport = primarySupport,
            PrimaryResistance = primaryResistance,
            BreakoutAlternative = breakoutAlternative,
            InvalidationText = invalidationText,
            InvalidationLevel = invalidationLevel,
            ReferencePrice = lastD1.Close,
            UpdatedAt = DateTime.Now
        };
    }

    public SignalAnalysis AnalyzeShortTerm(
        IReadOnlyList<MarketCandle> candles5m,
        IReadOnlyList<MarketCandle> candles15m,
        IReadOnlyList<MarketCandle> candles1h,
        IReadOnlyList<MarketCandle> candles4h)
    {
        var c5 = ClosedCandles(candles5m);
        var c15 = ClosedCandles(candles15m);
        var c1h = ClosedCandles(candles1h);
        var c4h = ClosedCandles(candles4h);

        if (c5.Count < 210 || c15.Count < 210 || c1h.Count < 210 || c4h.Count < 210)
        {
            return new SignalAnalysis
            {
                Kind = SignalKind.Wait,
                AnalysisMode = "SHORT TERM",
                TimeframesDisplay = "4H --   1H --   15m --   5m --",
                Reasons = new List<string> { "Chưa đủ dữ liệu nến đã đóng để phân tích ngắn hạn an toàn." },
                PlanHint = "WAIT - đang chờ đủ dữ liệu 4H / 1H / 15m / 5m."
            };
        }

        var reasons = new List<string>();
        var score = 0;

        var trend4h = IndicatorCalculator.EmaTrend(c4h);
        var trend1h = IndicatorCalculator.EmaTrend(c1h);
        var structure1h = IndicatorCalculator.MarketStructure(c1h);

        score += trend4h * 25;
        score += trend1h * 20;
        score += structure1h * 15;

        reasons.Add(trend4h switch
        {
            1 => "✓ 4H: giá > EMA50 > EMA200",
            -1 => "✓ 4H: giá < EMA50 < EMA200",
            _ => "○ 4H: xu hướng EMA chưa rõ"
        });
        reasons.Add(trend1h switch
        {
            1 => "✓ 1H: xu hướng tăng đồng thuận",
            -1 => "✓ 1H: xu hướng giảm đồng thuận",
            _ => "○ 1H: xu hướng chưa rõ"
        });
        reasons.Add(structure1h switch
        {
            1 => "✓ 1H: cấu trúc High/Low đang nâng dần",
            -1 => "✓ 1H: cấu trúc High/Low đang hạ dần",
            _ => "○ 1H: cấu trúc giá đi ngang / chưa xác nhận"
        });

        var closes15 = c15.Select(c => c.Close).ToList();
        var rsi15 = IndicatorCalculator.Rsi(closes15);
        var macd15 = IndicatorCalculator.Macd(closes15);
        var ema20_15 = IndicatorCalculator.Ema(closes15, 20);
        var ema50_15 = IndicatorCalculator.Ema(closes15, 50);
        var atr15 = SafeAtr(c15, c15[^1].Close * 0.002m);
        var last15 = c15[^1];

        var momentum15 = 0;
        if (rsi15 >= 52m && rsi15 <= 70m && macd15.Histogram > 0m)
        {
            momentum15 = 1;
            score += 15;
            reasons.Add($"✓ 15m: RSI {rsi15:0.0} + MACD bullish");
        }
        else if (rsi15 <= 48m && rsi15 >= 30m && macd15.Histogram < 0m)
        {
            momentum15 = -1;
            score -= 15;
            reasons.Add($"✓ 15m: RSI {rsi15:0.0} + MACD bearish");
        }
        else
        {
            reasons.Add($"○ 15m: momentum chưa đồng thuận (RSI {rsi15:0.0})");
        }

        if (rsi15 > 72m)
            reasons.Add("⚠ 15m: RSI cao, tránh đuổi LONG");
        else if (rsi15 < 28m)
            reasons.Add("⚠ 15m: RSI thấp, tránh đuổi SHORT");

        var closes5 = c5.Select(c => c.Close).ToList();
        var rsi5 = IndicatorCalculator.Rsi(closes5);
        var macd5 = IndicatorCalculator.Macd(closes5);
        var ema20_5 = IndicatorCalculator.Ema(closes5, 20);
        var last5 = c5[^1];
        var trigger5 = 0;

        if (last5.Close > ema20_5 && rsi5 > 52m && macd5.Histogram > 0m)
        {
            trigger5 = 1;
            score += 10;
            reasons.Add("✓ 5m: có xác nhận tăng ngắn hạn");
        }
        else if (last5.Close < ema20_5 && rsi5 < 48m && macd5.Histogram < 0m)
        {
            trigger5 = -1;
            score -= 10;
            reasons.Add("✓ 5m: có xác nhận giảm ngắn hạn");
        }
        else
        {
            reasons.Add("○ 5m: chưa có trigger rõ");
        }

        var averageVolume = IndicatorCalculator.AveragePreviousVolume(c15, 20);
        var volumeRatio = averageVolume <= 0m ? 0m : last15.Volume / averageVolume;
        if (volumeRatio >= 1.20m)
        {
            if (last15.Close > last15.Open)
            {
                score += 5;
                reasons.Add($"✓ Volume 15m mua tăng ({volumeRatio:0.0}x trung bình)");
            }
            else if (last15.Close < last15.Open)
            {
                score -= 5;
                reasons.Add($"✓ Volume 15m bán tăng ({volumeRatio:0.0}x trung bình)");
            }
        }
        else
        {
            reasons.Add("○ Volume 15m chưa nổi bật");
        }

        var nearLongPullback = last15.Close >= ema20_15 - (0.30m * atr15) &&
                               last15.Close <= ema20_15 + (0.80m * atr15) &&
                               last15.Close > ema50_15;
        var nearShortPullback = last15.Close <= ema20_15 + (0.30m * atr15) &&
                                last15.Close >= ema20_15 - (0.80m * atr15) &&
                                last15.Close < ema50_15;

        if (trend4h > 0 && trend1h > 0 && nearLongPullback)
        {
            score += 10;
            reasons.Add("✓ 15m: giá đang ở vùng pullback hợp lý quanh EMA20");
        }
        else if (trend4h < 0 && trend1h < 0 && nearShortPullback)
        {
            score -= 10;
            reasons.Add("✓ 15m: giá đang ở vùng hồi hợp lý quanh EMA20");
        }

        score = Math.Clamp(score, -100, 100);

        var currentPrice = last15.Close;
        // Short Term deliberately uses tighter zones and more recent intraday history.
        // 4H gives context, while 1H / 15m are the main actionable levels and 5m refines them.
        var rawSupports = new List<PriceZone>
        {
            BuildSupportZone(c4h, 80, "4H", 0.40m, SrProfile.ShortTerm),
            BuildSupportZone(c1h, 100, "1H", 0.32m, SrProfile.ShortTerm),
            BuildSupportZone(c15, 120, "15m", 0.25m, SrProfile.ShortTerm),
            BuildSupportZone(c5, 150, "5m", 0.20m, SrProfile.ShortTerm)
        };
        var rawResistances = new List<PriceZone>
        {
            BuildResistanceZone(c4h, 80, "4H", 0.40m, SrProfile.ShortTerm),
            BuildResistanceZone(c1h, 100, "1H", 0.32m, SrProfile.ShortTerm),
            BuildResistanceZone(c15, 120, "15m", 0.25m, SrProfile.ShortTerm),
            BuildResistanceZone(c5, 150, "5m", 0.20m, SrProfile.ShortTerm)
        };

        var supportZones = RankSupportZones(
                MergeZones(rawSupports, SrProfile.ShortTerm, 0.28m), currentPrice)
            .Take(4)
            .ToList();
        var resistanceZones = RankResistanceZones(
                MergeZones(rawResistances, SrProfile.ShortTerm, 0.28m), currentPrice)
            .Take(4)
            .ToList();
        var primarySupport = supportZones.FirstOrDefault();
        var primaryResistance = resistanceZones.FirstOrDefault();

        var support15 = IndicatorCalculator.RecentSupport(c15, 20);
        var resistance15 = IndicatorCalculator.RecentResistance(c15, 20);

        var watchLongLow = Math.Max(support15, ema20_15 - (0.50m * atr15));
        var watchLongHigh = ema20_15 + (0.25m * atr15);
        if (watchLongLow > watchLongHigh)
            watchLongLow = ema20_15 - (0.25m * atr15);

        var watchShortLow = ema20_15 - (0.25m * atr15);
        var watchShortHigh = Math.Min(resistance15, ema20_15 + (0.50m * atr15));
        if (watchShortHigh < watchShortLow)
            watchShortHigh = ema20_15 + (0.25m * atr15);

        var higherFramesConflict = trend4h != 0 && trend1h != 0 && trend4h != trend1h;
        SignalKind kind;

        if (higherFramesConflict)
        {
            kind = SignalKind.Wait;
            reasons.Insert(0, "⚠ 4H và 1H xung đột → ưu tiên WAIT.");
        }
        else if (trend4h > 0 && trend1h > 0 && score >= 65 && momentum15 > 0 && trigger5 > 0 && nearLongPullback && rsi15 < 72m)
        {
            kind = SignalKind.Long;
        }
        else if (trend4h < 0 && trend1h < 0 && score <= -65 && momentum15 < 0 && trigger5 < 0 && nearShortPullback && rsi15 > 28m)
        {
            kind = SignalKind.Short;
        }
        else if (score >= 40 && trend4h >= 0 && trend1h >= 0)
        {
            kind = SignalKind.WatchLong;
        }
        else if (score <= -40 && trend4h <= 0 && trend1h <= 0)
        {
            kind = SignalKind.WatchShort;
        }
        else
        {
            kind = SignalKind.Wait;
        }

        decimal? watchLow = null;
        decimal? watchHigh = null;
        var watchSource = "";
        var watchTriggerText = "";

        if (kind == SignalKind.WatchLong)
        {
            watchLow = watchLongLow;
            watchHigh = watchLongHigh;
            watchSource = "[15m] SHORT TERM";
            watchTriggerText = "Chờ 15m giữ vùng canh và 5m xác nhận tăng (RSI > 52 + MACD dương).";
        }
        else if (kind == SignalKind.WatchShort)
        {
            watchLow = watchShortLow;
            watchHigh = watchShortHigh;
            watchSource = "[15m] SHORT TERM";
            watchTriggerText = "Chờ 15m giữ vùng canh và 5m xác nhận giảm (RSI < 48 + MACD âm).";
        }

        var hasPlan = kind is SignalKind.Long or SignalKind.Short;
        decimal? entryLow = null;
        decimal? entryHigh = null;
        decimal? stop = null;
        decimal? tp1 = null;
        decimal? tp2 = null;
        decimal? tp3 = null;
        var triggerText = "";
        var invalidationText = "";
        decimal? invalidationLevel = null;

        if (hasPlan && kind == SignalKind.Long)
        {
            entryLow = Math.Max(support15, ema20_15 - (0.25m * atr15));
            entryHigh = ema20_15 + (0.20m * atr15);
            if (entryLow > entryHigh)
                (entryLow, entryHigh) = (entryHigh, entryLow);

            var midpoint = (entryLow.Value + entryHigh.Value) / 2m;
            stop = Math.Min(support15, entryLow.Value) - (0.35m * atr15);
            invalidationLevel = stop;
            var risk = midpoint - stop.Value;

            if (risk <= 0m)
            {
                hasPlan = false;
                kind = SignalKind.WatchLong;
                watchLow = watchLongLow;
                watchHigh = watchLongHigh;
                watchSource = "[15m] SHORT TERM";
                watchTriggerText = "Chờ cấu trúc rủi ro hợp lệ và 5m xác nhận tăng.";
            }
            else
            {
                tp1 = midpoint + (1.5m * risk);
                tp2 = midpoint + (2.5m * risk);
                triggerText = "Nến 5m duy trì trên EMA20 và RSI > 52";
                invalidationText = $"Setup LONG mất hiệu lực nếu 15m đóng dưới khoảng {FormatLevel(stop.Value)}.";
            }
        }
        else if (hasPlan && kind == SignalKind.Short)
        {
            entryHigh = Math.Min(resistance15, ema20_15 + (0.25m * atr15));
            entryLow = ema20_15 - (0.20m * atr15);
            if (entryLow > entryHigh)
                (entryLow, entryHigh) = (entryHigh, entryLow);

            var midpoint = (entryLow.Value + entryHigh.Value) / 2m;
            stop = Math.Max(resistance15, entryHigh.Value) + (0.35m * atr15);
            invalidationLevel = stop;
            var risk = stop.Value - midpoint;

            if (risk <= 0m)
            {
                hasPlan = false;
                kind = SignalKind.WatchShort;
                watchLow = watchShortLow;
                watchHigh = watchShortHigh;
                watchSource = "[15m] SHORT TERM";
                watchTriggerText = "Chờ cấu trúc rủi ro hợp lệ và 5m xác nhận giảm.";
            }
            else
            {
                tp1 = midpoint - (1.5m * risk);
                tp2 = midpoint - (2.5m * risk);
                triggerText = "Nến 5m duy trì dưới EMA20 và RSI < 48";
                invalidationText = $"Setup SHORT mất hiệu lực nếu 15m đóng trên khoảng {FormatLevel(stop.Value)}.";
            }
        }

        if (kind == SignalKind.WatchLong && string.IsNullOrWhiteSpace(invalidationText))
        {
            invalidationLevel = watchLongLow - (0.35m * atr15);
            invalidationText = $"Vùng canh yếu đi nếu 15m đóng dưới khoảng {FormatLevel(invalidationLevel.Value)}.";
        }
        else if (kind == SignalKind.WatchShort && string.IsNullOrWhiteSpace(invalidationText))
        {
            invalidationLevel = watchShortHigh + (0.35m * atr15);
            invalidationText = $"Vùng canh yếu đi nếu 15m đóng trên khoảng {FormatLevel(invalidationLevel.Value)}.";
        }

        var breakoutAlternative = kind switch
        {
            SignalKind.Long or SignalKind.WatchLong => $"Breakout nhanh: chờ 15m đóng trên {FormatLevel(resistance15)}, sau đó quan sát 5m retest/giữ vùng.",
            SignalKind.Short or SignalKind.WatchShort => $"Breakdown nhanh: chờ 15m đóng dưới {FormatLevel(support15)}, sau đó quan sát 5m retest/giữ vùng.",
            _ => ""
        };

        var planHint = kind switch
        {
            SignalKind.WatchLong => $"CANH LONG quanh {FormatLevel(watchLongLow)} – {FormatLevel(watchLongHigh)} [15m]. Đây là vùng chờ, chưa phải Entry.",
            SignalKind.WatchShort => $"CANH SHORT quanh {FormatLevel(watchShortLow)} – {FormatLevel(watchShortHigh)} [15m]. Đây là vùng chờ, chưa phải Entry.",
            SignalKind.Wait when primarySupport is not null && primaryResistance is not null
                => $"WAIT - hỗ trợ gần {FormatLevel(primarySupport.Low)}–{FormatLevel(primarySupport.High)} [{primarySupport.FrameLabel}] • kháng cự gần {FormatLevel(primaryResistance.Low)}–{FormatLevel(primaryResistance.High)} [{primaryResistance.FrameLabel}].",
            _ => "WAIT - chưa có setup ngắn hạn rõ."
        };

        return new SignalAnalysis
        {
            Kind = kind,
            Score = score,
            AnalysisMode = "SHORT TERM",
            TimeframesDisplay = $"{FormatTimeframe("4H", trend4h)}   {FormatTimeframe("1H", trend1h)}   {FormatTimeframe("15m", momentum15)}   {FormatTimeframe("5m", trigger5)}",
            Reasons = reasons.Take(9).ToList(),
            HasTradePlan = hasPlan,
            EntryLow = entryLow,
            EntryHigh = entryHigh,
            StopLoss = stop,
            TakeProfit1 = tp1,
            TakeProfit2 = tp2,
            TakeProfit3 = tp3,
            WatchLow = watchLow,
            WatchHigh = watchHigh,
            WatchZoneSource = watchSource,
            TriggerText = triggerText,
            WatchTriggerText = watchTriggerText,
            PlanHint = planHint,
            SupportZones = supportZones,
            ResistanceZones = resistanceZones,
            PrimarySupport = primarySupport,
            PrimaryResistance = primaryResistance,
            BreakoutAlternative = breakoutAlternative,
            InvalidationText = invalidationText,
            InvalidationLevel = invalidationLevel,
            ReferencePrice = last15.Close,
            UpdatedAt = DateTime.Now
        };
    }

    private static int Trend(IReadOnlyList<MarketCandle> candles, int fastPeriod, int slowPeriod)
    {
        if (candles.Count < slowPeriod + 2)
            return 0;

        var closes = candles.Select(c => c.Close).ToList();
        var close = closes[^1];
        var fast = IndicatorCalculator.Ema(closes, fastPeriod);
        var slow = IndicatorCalculator.Ema(closes, slowPeriod);

        if (close > fast && fast > slow)
            return 1;
        if (close < fast && fast < slow)
            return -1;
        return 0;
    }

    private static int AdaptiveTrend(IReadOnlyList<MarketCandle> candles)
    {
        if (candles.Count >= 205)
        {
            var closes = candles.Select(c => c.Close).ToList();
            var close = closes[^1];
            var ema50 = IndicatorCalculator.Ema(closes, 50);
            var ema200 = IndicatorCalculator.Ema(closes, 200);
            if (close > ema50 && ema50 > ema200) return 1;
            if (close < ema50 && ema50 < ema200) return -1;
        }

        return Trend(candles, 20, 50);
    }

    private static string TrendReason(string timeframe, int state, string role)
        => state switch
        {
            1 => $"✓ {timeframe}: bullish ({role})",
            -1 => $"✓ {timeframe}: bearish ({role})",
            _ => $"○ {timeframe}: chưa rõ xu hướng ({role})"
        };

    private static decimal[] BuildOrderedLongTargets(
        decimal midpoint,
        decimal risk,
        IEnumerable<decimal> resistanceLevels)
    {
        var minimumTarget = midpoint + (1.35m * risk);
        var candidates = resistanceLevels
            .Concat(new[]
            {
                midpoint + (1.8m * risk),
                midpoint + (2.8m * risk),
                midpoint + (4.0m * risk)
            })
            .Where(x => x >= minimumTarget)
            .OrderBy(x => x)
            .ToList();

        return SelectDistinctTargets(candidates, risk, ascending: true);
    }

    private static decimal[] BuildOrderedShortTargets(
        decimal midpoint,
        decimal risk,
        IEnumerable<decimal> supportLevels)
    {
        var maximumTarget = midpoint - (1.35m * risk);
        var candidates = supportLevels
            .Concat(new[]
            {
                midpoint - (1.8m * risk),
                midpoint - (2.8m * risk),
                midpoint - (4.0m * risk)
            })
            .Where(x => x <= maximumTarget)
            .OrderByDescending(x => x)
            .ToList();

        return SelectDistinctTargets(candidates, risk, ascending: false);
    }

    private static decimal[] SelectDistinctTargets(
        IReadOnlyList<decimal> candidates,
        decimal risk,
        bool ascending)
    {
        var result = new List<decimal>(3);
        var minSpacing = Math.Max(risk * 0.10m, 0.00000001m);

        foreach (var candidate in candidates)
        {
            if (result.Count > 0 && Math.Abs(candidate - result[^1]) < minSpacing)
                continue;

            result.Add(candidate);
            if (result.Count == 3)
                break;
        }

        // Risk-based candidates guarantee three values, but keep a defensive fallback
        // so malformed/zero-risk input can never create an unordered trade plan.
        while (result.Count < 3)
        {
            var step = Math.Max(risk, 0.00000001m);
            var anchor = result.Count == 0 ? 0m : result[^1];
            result.Add(result.Count == 0
                ? (ascending ? step : -step)
                : (ascending ? anchor + step : anchor - step));
        }

        return result.ToArray();
    }

    private static decimal SafeAtr(IReadOnlyList<MarketCandle> candles, decimal fallback)
    {
        var atr = IndicatorCalculator.Atr(candles);
        return atr > 0m ? atr : Math.Max(fallback, 0.00000001m);
    }

    private enum SrProfile
    {
        Swing,
        ShortTerm
    }

    private static PriceZone BuildSupportZone(
        IReadOnlyList<MarketCandle> candles,
        int lookback,
        string timeframe,
        decimal atrWidth,
        SrProfile profile)
    {
        var support = IndicatorCalculator.RecentSupport(candles, Math.Min(lookback, candles.Count));
        var atr = SafeAtr(candles, Math.Max(support * 0.01m, 0.00000001m));
        var minWidthRatio = profile == SrProfile.Swing ? 0.0018m : 0.0008m;
        var width = Math.Max(atr * atrWidth, Math.Max(support * minWidthRatio, 0.00000001m));
        return MakeZone(support, support + width, profile, timeframe);
    }

    private static PriceZone BuildResistanceZone(
        IReadOnlyList<MarketCandle> candles,
        int lookback,
        string timeframe,
        decimal atrWidth,
        SrProfile profile)
    {
        var resistance = IndicatorCalculator.RecentResistance(candles, Math.Min(lookback, candles.Count));
        var atr = SafeAtr(candles, Math.Max(resistance * 0.01m, 0.00000001m));
        var minWidthRatio = profile == SrProfile.Swing ? 0.0018m : 0.0008m;
        var width = Math.Max(atr * atrWidth, Math.Max(resistance * minWidthRatio, 0.00000001m));
        return MakeZone(Math.Max(0m, resistance - width), resistance, profile, timeframe);
    }

    private static PriceZone MakeZone(
        decimal low,
        decimal high,
        SrProfile profile,
        params string[] timeframes)
    {
        var frames = timeframes.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return new PriceZone
        {
            Low = Math.Min(low, high),
            High = Math.Max(low, high),
            Timeframes = frames,
            Strength = StrengthForFrames(frames, profile)
        };
    }

    private static List<PriceZone> MergeZones(
        IEnumerable<PriceZone> zones,
        SrProfile profile,
        decimal mergeToleranceFactor)
    {
        var sorted = zones.OrderBy(z => z.Low).ToList();
        var merged = new List<PriceZone>();

        foreach (var zone in sorted)
        {
            if (merged.Count == 0)
            {
                merged.Add(zone);
                continue;
            }

            var last = merged[^1];
            var lastWidth = Math.Max(last.High - last.Low, 0.00000001m);
            var zoneWidth = Math.Max(zone.High - zone.Low, 0.00000001m);
            var tolerance = Math.Max(lastWidth, zoneWidth) * mergeToleranceFactor;

            if (zone.Low <= last.High + tolerance)
            {
                var frames = last.Timeframes
                    .Concat(zone.Timeframes)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(FrameOrder)
                    .ToList();

                merged[^1] = new PriceZone
                {
                    Low = Math.Min(last.Low, zone.Low),
                    High = Math.Max(last.High, zone.High),
                    Timeframes = frames,
                    Strength = StrengthForFrames(frames, profile)
                };
            }
            else
            {
                merged.Add(zone);
            }
        }

        return merged;
    }

    private static IEnumerable<PriceZone> RankSupportZones(IEnumerable<PriceZone> zones, decimal price)
        => zones
            .OrderBy(z => z.Midpoint > price ? 1 : 0)
            .ThenBy(z => Math.Abs(price - z.Midpoint));

    private static IEnumerable<PriceZone> RankResistanceZones(IEnumerable<PriceZone> zones, decimal price)
        => zones
            .OrderBy(z => z.Midpoint < price ? 1 : 0)
            .ThenBy(z => Math.Abs(z.Midpoint - price));

    private static int FrameOrder(string timeframe)
        => timeframe switch
        {
            "1M" => 0,
            "1W" => 1,
            "1D" => 2,
            "12H" => 3,
            "4H" => 4,
            "1H" => 5,
            "15m" => 6,
            "5m" => 7,
            _ => 9
        };

    private static string StrengthForFrames(
        IReadOnlyCollection<string> frames,
        SrProfile profile)
    {
        if (profile == SrProfile.Swing)
        {
            var hasMonthly = frames.Contains("1M", StringComparer.OrdinalIgnoreCase);
            var hasWeekly = frames.Contains("1W", StringComparer.OrdinalIgnoreCase);
            var hasDaily = frames.Contains("1D", StringComparer.OrdinalIgnoreCase);
            var has12h = frames.Contains("12H", StringComparer.OrdinalIgnoreCase);
            var has4h = frames.Contains("4H", StringComparer.OrdinalIgnoreCase);

            if (hasMonthly || (hasWeekly && frames.Count >= 2) ||
                (hasDaily && (has12h || has4h)))
                return "VERY STRONG";
            if (hasWeekly || hasDaily)
                return "MAJOR";
            if (frames.Count >= 2 || has12h)
                return "STRONG";
            return has4h ? "MEDIUM" : "SWING";
        }

        // Intraday strength is intentionally judged differently from Swing.
        // A 1H + 15m confluence is actionable even though it is not a macro level.
        var has4hShort = frames.Contains("4H", StringComparer.OrdinalIgnoreCase);
        var has1h = frames.Contains("1H", StringComparer.OrdinalIgnoreCase);
        var has15m = frames.Contains("15m", StringComparer.OrdinalIgnoreCase);
        var has5m = frames.Contains("5m", StringComparer.OrdinalIgnoreCase);

        if ((has4hShort && has1h) || (has1h && has15m && has5m))
            return "VERY STRONG";
        if (has4hShort || (has1h && has15m))
            return "STRONG";
        if (has1h || (has15m && has5m))
            return "MEDIUM";
        return "SHORT TERM";
    }

    private static string BuildBreakoutAlternative(
        SignalKind kind,
        PriceZone? support,
        PriceZone? resistance,
        decimal atr1d)
    {
        if (kind is SignalKind.Long or SignalKind.WatchLong)
        {
            if (resistance is null)
                return "";

            var retestLow = Math.Max(0m, resistance.Low - (0.15m * atr1d));
            return $"Breakout thay thế: chờ 1D đóng trên {FormatLevel(resistance.High)}, sau đó ưu tiên retest {FormatLevel(retestLow)} – {FormatLevel(resistance.High)}.";
        }

        if (kind is SignalKind.Short or SignalKind.WatchShort)
        {
            if (support is null)
                return "";

            var retestHigh = support.High + (0.15m * atr1d);
            return $"Breakdown thay thế: chờ 1D đóng dưới {FormatLevel(support.Low)}, sau đó ưu tiên retest {FormatLevel(support.Low)} – {FormatLevel(retestHigh)}.";
        }

        return "";
    }

    private static string FormatLevel(decimal price)
    {
        if (price >= 1000m) return price.ToString("N2");
        if (price >= 1m) return price.ToString("N4");
        if (price >= 0.01m) return price.ToString("N6");
        return price.ToString("N8");
    }

    private static List<MarketCandle> ClosedCandles(IReadOnlyList<MarketCandle> candles)
    {
        if (candles.Count == 0)
            return new List<MarketCandle>();

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return candles.Where(c => c.CloseTime < now).ToList();
    }

    private static string FormatTimeframe(string name, int state)
        => state switch
        {
            1 => $"{name} ↑",
            -1 => $"{name} ↓",
            _ => $"{name} →"
        };
}
