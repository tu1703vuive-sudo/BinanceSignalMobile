using BinanceSignalMobile.Models;

namespace BinanceSignalMobile.Services;

public sealed class SignalLifecycleService
{
    public TradeSignalLifecycle ApplyAnalysis(
        TradeSignalLifecycle? current,
        string symbol,
        string mode,
        SignalAnalysis analysis,
        decimal? realtimePrice,
        DateTime now,
        IReadOnlyList<MarketCandle>? recoveryCandles = null)
    {
        if (current is null ||
            !string.Equals(current.Symbol, symbol, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(current.Mode, mode, StringComparison.OrdinalIgnoreCase))
        {
            current = CreateFromAnalysis(symbol, mode, analysis, realtimePrice, now);
            return ApplyPriceTick(current, realtimePrice, now);
        }

        // Recover transitions that may have happened while WebSocket ticks were missed
        // (sleep/reconnect/app restart) from closed execution-timeframe candles.
        ApplyClosedCandleRecovery(current, recoveryCandles, now);

        // Do not overwrite LastPrice here. ApplyPriceTick needs the previous realtime
        // value to detect a gap that crosses the Entry zone between two ticks.
        current.UpdatedAt = now;

        if (current.IsTerminal)
        {
            var cooldown = IsShortTerm(mode) ? TimeSpan.FromMinutes(30) : TimeSpan.FromHours(12);
            if (!current.ClosedAt.HasValue || now - current.ClosedAt.Value < cooldown)
                return current;

            if (analysis.Kind == SignalKind.Wait)
                return CreateWait(symbol, mode, analysis, realtimePrice, now);

            return ApplyPriceTick(CreateFromAnalysis(symbol, mode, analysis, realtimePrice, now), realtimePrice, now);
        }

        if (current.State == SignalLifecycleState.Wait)
        {
            if (analysis.Kind == SignalKind.Wait)
            {
                current.LastMessage = "Chưa có setup đủ điều kiện.";
                return current;
            }

            return ApplyPriceTick(CreateFromAnalysis(symbol, mode, analysis, realtimePrice, now), realtimePrice, now);
        }

        if (current.State is SignalLifecycleState.WatchLong or SignalLifecycleState.WatchShort)
        {
            if (WatchExpired(current, mode, now))
                return Close(current, SignalLifecycleState.Expired, "Setup chờ đã quá hạn; cần cấu trúc mới.", now);

            if (ClosedCandleInvalidated(current, analysis))
                return Close(current, SignalLifecycleState.Invalid, "Nến đã đóng vượt mức vô hiệu của setup.", now);

            if (OppositeCandidate(current, analysis.Kind))
                return Close(current, SignalLifecycleState.Invalid, "Bias kỹ thuật đã đảo chiều trước khi setup được kích hoạt.", now);

            if (current.State == SignalLifecycleState.WatchLong && analysis.Kind == SignalKind.Long && analysis.HasTradePlan)
            {
                Confirm(current, analysis, isLong: true, now);
                return ApplyPriceTick(current, realtimePrice, now);
            }

            if (current.State == SignalLifecycleState.WatchShort && analysis.Kind == SignalKind.Short && analysis.HasTradePlan)
            {
                Confirm(current, analysis, isLong: false, now);
                return ApplyPriceTick(current, realtimePrice, now);
            }

            // While still watching the same direction, allow the engine to refine the zone.
            // Once confirmed/active, the original plan is frozen and cannot drift on refresh.
            if ((current.State == SignalLifecycleState.WatchLong && analysis.Kind == SignalKind.WatchLong) ||
                (current.State == SignalLifecycleState.WatchShort && analysis.Kind == SignalKind.WatchShort))
            {
                if (analysis.WatchLow.HasValue && analysis.WatchHigh.HasValue)
                {
                    current.WatchLow = analysis.WatchLow;
                    current.WatchHigh = analysis.WatchHigh;
                    current.WatchSource = analysis.WatchZoneSource;
                }

                if (analysis.InvalidationLevel.HasValue)
                    current.InvalidationLevel = analysis.InvalidationLevel;

                current.LastMessage = "Setup đang được theo dõi; chờ nến xác nhận.";
            }

            return current;
        }

        if (current.State is SignalLifecycleState.LongConfirmed or SignalLifecycleState.ShortConfirmed)
        {
            if (ConfirmedExpired(current, mode, now))
                return Close(current, SignalLifecycleState.Expired, "Tín hiệu đã xác nhận nhưng không khớp Entry trong thời gian cho phép.", now);

            if (ClosedCandleInvalidated(current, analysis))
                return Close(current, SignalLifecycleState.Invalid, "Setup bị vô hiệu trước khi Entry được khớp.", now);

            if (OppositeCandidate(current, analysis.Kind))
                return Close(current, SignalLifecycleState.Invalid, "Bias đảo chiều trước khi Entry được khớp.", now);

            return ApplyPriceTick(current, realtimePrice, now);
        }

        // ACTIVE trades are no longer re-written by fresh indicator analysis.
        // Realtime price alone owns Entry/TP/SL transitions until the lifecycle closes.
        return ApplyPriceTick(current, realtimePrice, now);
    }

    public TradeSignalLifecycle ApplyPriceTick(TradeSignalLifecycle lifecycle, decimal? price, DateTime now)
    {
        if (!price.HasValue || lifecycle.IsTerminal)
            return lifecycle;

        var value = price.Value;
        var previousPrice = lifecycle.LastPrice;
        lifecycle.LastPrice = value;
        lifecycle.UpdatedAt = now;

        if (lifecycle.State == SignalLifecycleState.LongConfirmed &&
            TryGetEntryTouchPrice(lifecycle, previousPrice, value, out var longEntryPrice))
        {
            lifecycle.State = SignalLifecycleState.LongActive;
            lifecycle.ActivatedAt = now;
            lifecycle.ActualEntryPrice = longEntryPrice;
            lifecycle.LastMessage = Math.Abs(longEntryPrice - value) > 0m
                ? $"Giá đã đi xuyên vùng Entry LONG; ghi nhận lần chạm đầu tại {FormatPrice(longEntryPrice)}."
                : $"Entry LONG đã được chạm tại {FormatPrice(value)}.";
            AddEvent(lifecycle, lifecycle.State, lifecycle.LastMessage, now);
        }
        else if (lifecycle.State == SignalLifecycleState.ShortConfirmed &&
                 TryGetEntryTouchPrice(lifecycle, previousPrice, value, out var shortEntryPrice))
        {
            lifecycle.State = SignalLifecycleState.ShortActive;
            lifecycle.ActivatedAt = now;
            lifecycle.ActualEntryPrice = shortEntryPrice;
            lifecycle.LastMessage = Math.Abs(shortEntryPrice - value) > 0m
                ? $"Giá đã đi xuyên vùng Entry SHORT; ghi nhận lần chạm đầu tại {FormatPrice(shortEntryPrice)}."
                : $"Entry SHORT đã được chạm tại {FormatPrice(value)}.";
            AddEvent(lifecycle, lifecycle.State, lifecycle.LastMessage, now);
        }

        if (lifecycle.State == SignalLifecycleState.LongActive)
        {
            if (lifecycle.StopLoss.HasValue && value <= lifecycle.StopLoss.Value)
                return Close(lifecycle, SignalLifecycleState.StopLossHit, $"SL LONG đã chạm tại {FormatPrice(value)}.", now);

            if (!lifecycle.Tp1Hit && lifecycle.TakeProfit1.HasValue && value >= lifecycle.TakeProfit1.Value)
            {
                lifecycle.Tp1Hit = true;
                var nextTargets = lifecycle.TakeProfit3.HasValue ? "TP2/TP3/SL" : "TP2/SL";
                lifecycle.LastMessage = $"TP1 LONG đã chạm tại {FormatPrice(value)}; lifecycle vẫn ACTIVE chờ {nextTargets}.";
                AddEvent(lifecycle, SignalLifecycleState.LongActive, lifecycle.LastMessage, now);
            }

            if (!lifecycle.Tp2Hit && lifecycle.TakeProfit2.HasValue && value >= lifecycle.TakeProfit2.Value)
            {
                lifecycle.Tp2Hit = true;
                if (!lifecycle.TakeProfit3.HasValue)
                    return Close(lifecycle, SignalLifecycleState.TakeProfit2Hit, $"TP2 LONG đã chạm tại {FormatPrice(value)}.", now);

                lifecycle.LastMessage = $"TP2 LONG đã chạm tại {FormatPrice(value)}; lifecycle vẫn ACTIVE chờ TP3/SL.";
                AddEvent(lifecycle, SignalLifecycleState.LongActive, lifecycle.LastMessage, now);
            }

            if (lifecycle.TakeProfit3.HasValue && value >= lifecycle.TakeProfit3.Value)
            {
                lifecycle.Tp3Hit = true;
                return Close(lifecycle, SignalLifecycleState.TakeProfit3Hit, $"TP3 LONG đã chạm tại {FormatPrice(value)}.", now);
            }
        }
        else if (lifecycle.State == SignalLifecycleState.ShortActive)
        {
            if (lifecycle.StopLoss.HasValue && value >= lifecycle.StopLoss.Value)
                return Close(lifecycle, SignalLifecycleState.StopLossHit, $"SL SHORT đã chạm tại {FormatPrice(value)}.", now);

            if (!lifecycle.Tp1Hit && lifecycle.TakeProfit1.HasValue && value <= lifecycle.TakeProfit1.Value)
            {
                lifecycle.Tp1Hit = true;
                var nextTargets = lifecycle.TakeProfit3.HasValue ? "TP2/TP3/SL" : "TP2/SL";
                lifecycle.LastMessage = $"TP1 SHORT đã chạm tại {FormatPrice(value)}; lifecycle vẫn ACTIVE chờ {nextTargets}.";
                AddEvent(lifecycle, SignalLifecycleState.ShortActive, lifecycle.LastMessage, now);
            }

            if (!lifecycle.Tp2Hit && lifecycle.TakeProfit2.HasValue && value <= lifecycle.TakeProfit2.Value)
            {
                lifecycle.Tp2Hit = true;
                if (!lifecycle.TakeProfit3.HasValue)
                    return Close(lifecycle, SignalLifecycleState.TakeProfit2Hit, $"TP2 SHORT đã chạm tại {FormatPrice(value)}.", now);

                lifecycle.LastMessage = $"TP2 SHORT đã chạm tại {FormatPrice(value)}; lifecycle vẫn ACTIVE chờ TP3/SL.";
                AddEvent(lifecycle, SignalLifecycleState.ShortActive, lifecycle.LastMessage, now);
            }

            if (lifecycle.TakeProfit3.HasValue && value <= lifecycle.TakeProfit3.Value)
            {
                lifecycle.Tp3Hit = true;
                return Close(lifecycle, SignalLifecycleState.TakeProfit3Hit, $"TP3 SHORT đã chạm tại {FormatPrice(value)}.", now);
            }
        }

        return lifecycle;
    }

    private static void ApplyClosedCandleRecovery(
        TradeSignalLifecycle lifecycle,
        IReadOnlyList<MarketCandle>? candles,
        DateTime now)
    {
        if (candles is null || candles.Count == 0 || lifecycle.IsTerminal ||
            lifecycle.State is SignalLifecycleState.Wait or SignalLifecycleState.WatchLong or SignalLifecycleState.WatchShort)
            return;

        var since = lifecycle.UpdatedAt;
        if (lifecycle.ConfirmedAt.HasValue && lifecycle.ConfirmedAt.Value > since)
            since = lifecycle.ConfirmedAt.Value;

        var sinceMs = new DateTimeOffset(since).ToUnixTimeMilliseconds();
        var nowMs = new DateTimeOffset(now).ToUnixTimeMilliseconds();

        foreach (var candle in candles
                     .Where(c => c.CloseTime > sinceMs && c.CloseTime < nowMs)
                     .OrderBy(c => c.CloseTime))
        {
            var eventTime = DateTimeOffset.FromUnixTimeMilliseconds(candle.CloseTime).LocalDateTime;
            lifecycle.LastPrice = candle.Close;
            lifecycle.UpdatedAt = eventTime;

            if (lifecycle.State is SignalLifecycleState.LongConfirmed or SignalLifecycleState.ShortConfirmed)
            {
                if (CandleTouchesEntry(lifecycle, candle, out var entryPrice))
                {
                    lifecycle.State = lifecycle.State == SignalLifecycleState.LongConfirmed
                        ? SignalLifecycleState.LongActive
                        : SignalLifecycleState.ShortActive;
                    lifecycle.ActivatedAt = eventTime;
                    lifecycle.ActualEntryPrice = entryPrice;
                    lifecycle.LastMessage = $"Khôi phục từ Kline: Entry đã được chạm tại khoảng {FormatPrice(entryPrice)}.";
                    AddEvent(lifecycle, lifecycle.State, lifecycle.LastMessage, eventTime);
                }
            }

            if (lifecycle.State == SignalLifecycleState.LongActive)
            {
                // Conservative rule for OHLC ambiguity: if the same candle spans both
                // SL and TP, count SL first because intrabar path is unknown.
                if (lifecycle.StopLoss.HasValue && candle.Low <= lifecycle.StopLoss.Value)
                {
                    Close(lifecycle, SignalLifecycleState.StopLossHit,
                        $"Khôi phục từ Kline: SL LONG đã được chạm (low {FormatPrice(candle.Low)}).", eventTime);
                    break;
                }

                if (!lifecycle.Tp1Hit && lifecycle.TakeProfit1.HasValue && candle.High >= lifecycle.TakeProfit1.Value)
                {
                    lifecycle.Tp1Hit = true;
                    lifecycle.LastMessage = $"Khôi phục từ Kline: TP1 LONG đã được chạm (high {FormatPrice(candle.High)}).";
                    AddEvent(lifecycle, SignalLifecycleState.LongActive, lifecycle.LastMessage, eventTime);
                }

                if (!lifecycle.Tp2Hit && lifecycle.TakeProfit2.HasValue && candle.High >= lifecycle.TakeProfit2.Value)
                {
                    lifecycle.Tp2Hit = true;
                    if (!lifecycle.TakeProfit3.HasValue)
                    {
                        Close(lifecycle, SignalLifecycleState.TakeProfit2Hit,
                            $"Khôi phục từ Kline: TP2 LONG đã được chạm (high {FormatPrice(candle.High)}).", eventTime);
                        break;
                    }

                    lifecycle.LastMessage = $"Khôi phục từ Kline: TP2 LONG đã được chạm (high {FormatPrice(candle.High)}).";
                    AddEvent(lifecycle, SignalLifecycleState.LongActive, lifecycle.LastMessage, eventTime);
                }

                if (lifecycle.TakeProfit3.HasValue && candle.High >= lifecycle.TakeProfit3.Value)
                {
                    lifecycle.Tp3Hit = true;
                    Close(lifecycle, SignalLifecycleState.TakeProfit3Hit,
                        $"Khôi phục từ Kline: TP3 LONG đã được chạm (high {FormatPrice(candle.High)}).", eventTime);
                    break;
                }
            }
            else if (lifecycle.State == SignalLifecycleState.ShortActive)
            {
                if (lifecycle.StopLoss.HasValue && candle.High >= lifecycle.StopLoss.Value)
                {
                    Close(lifecycle, SignalLifecycleState.StopLossHit,
                        $"Khôi phục từ Kline: SL SHORT đã được chạm (high {FormatPrice(candle.High)}).", eventTime);
                    break;
                }

                if (!lifecycle.Tp1Hit && lifecycle.TakeProfit1.HasValue && candle.Low <= lifecycle.TakeProfit1.Value)
                {
                    lifecycle.Tp1Hit = true;
                    lifecycle.LastMessage = $"Khôi phục từ Kline: TP1 SHORT đã được chạm (low {FormatPrice(candle.Low)}).";
                    AddEvent(lifecycle, SignalLifecycleState.ShortActive, lifecycle.LastMessage, eventTime);
                }

                if (!lifecycle.Tp2Hit && lifecycle.TakeProfit2.HasValue && candle.Low <= lifecycle.TakeProfit2.Value)
                {
                    lifecycle.Tp2Hit = true;
                    if (!lifecycle.TakeProfit3.HasValue)
                    {
                        Close(lifecycle, SignalLifecycleState.TakeProfit2Hit,
                            $"Khôi phục từ Kline: TP2 SHORT đã được chạm (low {FormatPrice(candle.Low)}).", eventTime);
                        break;
                    }

                    lifecycle.LastMessage = $"Khôi phục từ Kline: TP2 SHORT đã được chạm (low {FormatPrice(candle.Low)}).";
                    AddEvent(lifecycle, SignalLifecycleState.ShortActive, lifecycle.LastMessage, eventTime);
                }

                if (lifecycle.TakeProfit3.HasValue && candle.Low <= lifecycle.TakeProfit3.Value)
                {
                    lifecycle.Tp3Hit = true;
                    Close(lifecycle, SignalLifecycleState.TakeProfit3Hit,
                        $"Khôi phục từ Kline: TP3 SHORT đã được chạm (low {FormatPrice(candle.Low)}).", eventTime);
                    break;
                }
            }
        }
    }

    private static bool CandleTouchesEntry(
        TradeSignalLifecycle lifecycle,
        MarketCandle candle,
        out decimal entryPrice)
    {
        entryPrice = candle.Close;
        if (!lifecycle.EntryLow.HasValue || !lifecycle.EntryHigh.HasValue)
            return false;

        var low = Math.Min(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value);
        var high = Math.Max(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value);
        if (candle.High < low || candle.Low > high)
            return false;

        entryPrice = candle.Open > high
            ? high
            : candle.Open < low
                ? low
                : Math.Clamp(candle.Open, low, high);
        return true;
    }

    public TradeSignalLifecycle CreateWait(string symbol, string mode, SignalAnalysis analysis, decimal? price, DateTime now)
    {
        var result = new TradeSignalLifecycle
        {
            Symbol = symbol,
            Mode = mode,
            State = SignalLifecycleState.Wait,
            CreatedAt = now,
            UpdatedAt = now,
            LastPrice = price,
            LastMessage = "Chưa có setup đủ điều kiện."
        };
        AddEvent(result, SignalLifecycleState.Wait, result.LastMessage, now);
        return result;
    }

    private TradeSignalLifecycle CreateFromAnalysis(string symbol, string mode, SignalAnalysis analysis, decimal? price, DateTime now)
    {
        if (analysis.Kind == SignalKind.Wait)
            return CreateWait(symbol, mode, analysis, price, now);

        var lifecycle = new TradeSignalLifecycle
        {
            Symbol = symbol,
            Mode = mode,
            CreatedAt = now,
            UpdatedAt = now,
            LastPrice = price,
            WatchLow = analysis.WatchLow,
            WatchHigh = analysis.WatchHigh,
            WatchSource = analysis.WatchZoneSource,
            InvalidationLevel = analysis.InvalidationLevel
        };

        switch (analysis.Kind)
        {
            case SignalKind.WatchLong:
                lifecycle.State = SignalLifecycleState.WatchLong;
                lifecycle.LastMessage = "Tạo setup CANH LONG; chưa phải lệnh.";
                break;
            case SignalKind.WatchShort:
                lifecycle.State = SignalLifecycleState.WatchShort;
                lifecycle.LastMessage = "Tạo setup CANH SHORT; chưa phải lệnh.";
                break;
            case SignalKind.Long:
                CopyTradePlan(lifecycle, analysis);
                lifecycle.State = SignalLifecycleState.LongConfirmed;
                NormalizeTargetOrder(lifecycle);
                lifecycle.ConfirmedAt = now;
                lifecycle.LastMessage = "LONG đã được xác nhận bằng nến đóng; đang chờ giá chạm Entry.";
                break;
            case SignalKind.Short:
                CopyTradePlan(lifecycle, analysis);
                lifecycle.State = SignalLifecycleState.ShortConfirmed;
                NormalizeTargetOrder(lifecycle);
                lifecycle.ConfirmedAt = now;
                lifecycle.LastMessage = "SHORT đã được xác nhận bằng nến đóng; đang chờ giá chạm Entry.";
                break;
        }

        AddEvent(lifecycle, lifecycle.State, lifecycle.LastMessage, now);
        return lifecycle;
    }

    private static void Confirm(TradeSignalLifecycle lifecycle, SignalAnalysis analysis, bool isLong, DateTime now)
    {
        CopyTradePlan(lifecycle, analysis);
        lifecycle.State = isLong ? SignalLifecycleState.LongConfirmed : SignalLifecycleState.ShortConfirmed;
        NormalizeTargetOrder(lifecycle);
        lifecycle.ConfirmedAt = now;
        lifecycle.UpdatedAt = now;
        lifecycle.LastMessage = isLong
            ? "LONG CONFIRMED bằng nến đã đóng; chờ Entry được chạm."
            : "SHORT CONFIRMED bằng nến đã đóng; chờ Entry được chạm.";
        AddEvent(lifecycle, lifecycle.State, lifecycle.LastMessage, now);
    }

    private static void CopyTradePlan(TradeSignalLifecycle lifecycle, SignalAnalysis analysis)
    {
        lifecycle.EntryLow = analysis.EntryLow;
        lifecycle.EntryHigh = analysis.EntryHigh;
        lifecycle.StopLoss = analysis.StopLoss;
        lifecycle.TakeProfit1 = analysis.TakeProfit1;
        lifecycle.TakeProfit2 = analysis.TakeProfit2;
        lifecycle.TakeProfit3 = analysis.TakeProfit3;
        lifecycle.InvalidationLevel = analysis.InvalidationLevel ?? analysis.StopLoss;
        lifecycle.WatchLow = analysis.WatchLow;
        lifecycle.WatchHigh = analysis.WatchHigh;
        lifecycle.WatchSource = analysis.WatchZoneSource;
    }

    private static TradeSignalLifecycle Close(TradeSignalLifecycle lifecycle, SignalLifecycleState state, string message, DateTime now)
    {
        if (lifecycle.IsTerminal)
            return lifecycle;

        lifecycle.State = state;
        lifecycle.ClosedAt = now;
        lifecycle.UpdatedAt = now;
        lifecycle.LastMessage = message;
        AddEvent(lifecycle, state, message, now);
        return lifecycle;
    }

    private static bool ClosedCandleInvalidated(TradeSignalLifecycle lifecycle, SignalAnalysis analysis)
    {
        if (!analysis.ReferencePrice.HasValue || !lifecycle.InvalidationLevel.HasValue)
            return false;

        var close = analysis.ReferencePrice.Value;
        var level = lifecycle.InvalidationLevel.Value;
        return lifecycle.IsLong ? close <= level : lifecycle.IsShort && close >= level;
    }

    private static bool OppositeCandidate(TradeSignalLifecycle lifecycle, SignalKind candidate)
    {
        if (lifecycle.IsLong)
            return candidate is SignalKind.WatchShort or SignalKind.Short;
        if (lifecycle.IsShort)
            return candidate is SignalKind.WatchLong or SignalKind.Long;
        return false;
    }

    private static bool IsInsideEntry(TradeSignalLifecycle lifecycle, decimal price)
        => lifecycle.EntryLow.HasValue && lifecycle.EntryHigh.HasValue &&
           price >= Math.Min(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value) &&
           price <= Math.Max(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value);

    private static bool TryGetEntryTouchPrice(
        TradeSignalLifecycle lifecycle,
        decimal? previousPrice,
        decimal currentPrice,
        out decimal touchPrice)
    {
        touchPrice = currentPrice;
        if (!lifecycle.EntryLow.HasValue || !lifecycle.EntryHigh.HasValue)
            return false;

        var low = Math.Min(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value);
        var high = Math.Max(lifecycle.EntryLow.Value, lifecycle.EntryHigh.Value);

        if (currentPrice >= low && currentPrice <= high)
            return true;

        if (!previousPrice.HasValue)
            return false;

        var previous = previousPrice.Value;
        var segmentLow = Math.Min(previous, currentPrice);
        var segmentHigh = Math.Max(previous, currentPrice);
        if (segmentHigh < low || segmentLow > high)
            return false;

        // Approximate the first boundary touched by the price segment. This prevents
        // a fast WebSocket gap from leaving a confirmed setup stuck forever.
        touchPrice = previous > high ? high : previous < low ? low : previous;
        return true;
    }

    private static void NormalizeTargetOrder(TradeSignalLifecycle lifecycle)
    {
        var targets = new[]
        {
            lifecycle.TakeProfit1,
            lifecycle.TakeProfit2,
            lifecycle.TakeProfit3
        }
        .Where(x => x.HasValue)
        .Select(x => x!.Value)
        .Distinct()
        .ToList();

        if (targets.Count < 2)
            return;

        targets = lifecycle.IsLong
            ? targets.OrderBy(x => x).ToList()
            : targets.OrderByDescending(x => x).ToList();

        lifecycle.TakeProfit1 = targets.ElementAtOrDefault(0);
        lifecycle.TakeProfit2 = targets.Count > 1 ? targets[1] : null;
        lifecycle.TakeProfit3 = targets.Count > 2 ? targets[2] : null;
    }

    private static bool WatchExpired(TradeSignalLifecycle lifecycle, string mode, DateTime now)
    {
        var maxAge = IsShortTerm(mode) ? TimeSpan.FromHours(24) : TimeSpan.FromDays(14);
        return now - lifecycle.CreatedAt > maxAge;
    }

    private static bool ConfirmedExpired(TradeSignalLifecycle lifecycle, string mode, DateTime now)
    {
        var origin = lifecycle.ConfirmedAt ?? lifecycle.CreatedAt;
        var maxAge = IsShortTerm(mode) ? TimeSpan.FromHours(4) : TimeSpan.FromDays(3);
        return now - origin > maxAge;
    }

    private static bool IsShortTerm(string mode)
        => string.Equals(mode, "ShortTerm", StringComparison.OrdinalIgnoreCase);

    private static void AddEvent(TradeSignalLifecycle lifecycle, SignalLifecycleState state, string message, DateTime now)
    {
        lifecycle.Timeline.Add(new SignalLifecycleEvent
        {
            Time = now,
            State = state,
            Message = message
        });

        // Bound the file size while keeping enough events for the UI and future statistics.
        if (lifecycle.Timeline.Count > 40)
            lifecycle.Timeline.RemoveRange(0, lifecycle.Timeline.Count - 40);
    }

    private static string FormatPrice(decimal price)
    {
        if (price >= 1000m) return price.ToString("N2");
        if (price >= 1m) return price.ToString("N4");
        if (price >= 0.01m) return price.ToString("N6");
        return price.ToString("N8");
    }
}
