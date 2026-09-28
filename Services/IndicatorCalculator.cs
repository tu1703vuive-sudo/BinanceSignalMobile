using BinanceSignalMobile.Models;

namespace BinanceSignalMobile.Services;

public static class IndicatorCalculator
{
    public static decimal Ema(IReadOnlyList<decimal> values, int period)
    {
        if (values.Count == 0)
            return 0m;

        var seedCount = Math.Min(period, values.Count);
        decimal ema = values.Take(seedCount).Average();
        var multiplier = 2m / (period + 1m);

        for (var i = seedCount; i < values.Count; i++)
            ema = ((values[i] - ema) * multiplier) + ema;

        return ema;
    }

    public static List<decimal> EmaSeries(IReadOnlyList<decimal> values, int period)
    {
        var result = new List<decimal>(values.Count);
        if (values.Count == 0)
            return result;

        decimal ema = values[0];
        var multiplier = 2m / (period + 1m);
        result.Add(ema);

        for (var i = 1; i < values.Count; i++)
        {
            ema = ((values[i] - ema) * multiplier) + ema;
            result.Add(ema);
        }

        return result;
    }

    public static decimal Rsi(IReadOnlyList<decimal> closes, int period = 14)
    {
        if (closes.Count <= period)
            return 50m;

        decimal averageGain = 0m;
        decimal averageLoss = 0m;

        for (var i = 1; i <= period; i++)
        {
            var change = closes[i] - closes[i - 1];
            if (change >= 0m) averageGain += change;
            else averageLoss += -change;
        }

        averageGain /= period;
        averageLoss /= period;

        for (var i = period + 1; i < closes.Count; i++)
        {
            var change = closes[i] - closes[i - 1];
            var gain = change > 0m ? change : 0m;
            var loss = change < 0m ? -change : 0m;
            averageGain = ((averageGain * (period - 1)) + gain) / period;
            averageLoss = ((averageLoss * (period - 1)) + loss) / period;
        }

        if (averageLoss == 0m)
            return 100m;

        var rs = averageGain / averageLoss;
        return 100m - (100m / (1m + rs));
    }

    public static (decimal Line, decimal Signal, decimal Histogram) Macd(IReadOnlyList<decimal> closes)
    {
        if (closes.Count < 35)
            return (0m, 0m, 0m);

        var ema12 = EmaSeries(closes, 12);
        var ema26 = EmaSeries(closes, 26);
        var macdSeries = new List<decimal>(closes.Count);

        for (var i = 0; i < closes.Count; i++)
            macdSeries.Add(ema12[i] - ema26[i]);

        var signalSeries = EmaSeries(macdSeries, 9);
        var line = macdSeries[^1];
        var signal = signalSeries[^1];
        return (line, signal, line - signal);
    }

    public static decimal Atr(IReadOnlyList<MarketCandle> candles, int period = 14)
    {
        if (candles.Count < 2)
            return 0m;

        var trueRanges = new List<decimal>();
        var start = Math.Max(1, candles.Count - period);

        for (var i = start; i < candles.Count; i++)
        {
            var current = candles[i];
            var previousClose = candles[i - 1].Close;
            var tr = Math.Max(
                current.High - current.Low,
                Math.Max(Math.Abs(current.High - previousClose), Math.Abs(current.Low - previousClose)));
            trueRanges.Add(tr);
        }

        return trueRanges.Count == 0 ? 0m : trueRanges.Average();
    }

    public static decimal AverageVolume(IReadOnlyList<MarketCandle> candles, int period = 20)
    {
        if (candles.Count == 0)
            return 0m;

        return candles.Skip(Math.Max(0, candles.Count - period)).Average(c => c.Volume);
    }

    public static decimal AveragePreviousVolume(IReadOnlyList<MarketCandle> candles, int period = 20)
    {
        if (candles.Count <= 1 || period <= 0)
            return 0m;

        var endExclusive = candles.Count - 1;
        var start = Math.Max(0, endExclusive - period);
        var count = endExclusive - start;
        if (count <= 0)
            return 0m;

        decimal total = 0m;
        for (var i = start; i < endExclusive; i++)
            total += candles[i].Volume;

        return total / count;
    }

    public static int EmaTrend(IReadOnlyList<MarketCandle> candles)
    {
        if (candles.Count < 205)
            return 0;

        var closes = candles.Select(c => c.Close).ToList();
        var close = closes[^1];
        var ema50 = Ema(closes, 50);
        var ema200 = Ema(closes, 200);

        if (close > ema50 && ema50 > ema200)
            return 1;
        if (close < ema50 && ema50 < ema200)
            return -1;
        return 0;
    }

    public static int MarketStructure(IReadOnlyList<MarketCandle> candles)
    {
        if (candles.Count < 24)
            return 0;

        var recent = candles.Skip(candles.Count - 10).Take(10).ToList();
        var previous = candles.Skip(candles.Count - 20).Take(10).ToList();

        var recentHigh = recent.Max(c => c.High);
        var recentLow = recent.Min(c => c.Low);
        var previousHigh = previous.Max(c => c.High);
        var previousLow = previous.Min(c => c.Low);

        if (recentHigh > previousHigh && recentLow > previousLow)
            return 1;
        if (recentHigh < previousHigh && recentLow < previousLow)
            return -1;
        return 0;
    }

    public static decimal RecentSupport(IReadOnlyList<MarketCandle> candles, int period = 20)
        => candles.Skip(Math.Max(0, candles.Count - period)).Min(c => c.Low);

    public static decimal RecentResistance(IReadOnlyList<MarketCandle> candles, int period = 20)
        => candles.Skip(Math.Max(0, candles.Count - period)).Max(c => c.High);
}
