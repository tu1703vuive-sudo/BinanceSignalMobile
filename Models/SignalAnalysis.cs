namespace BinanceSignalMobile.Models;

public enum SignalKind
{
    Wait,
    WatchLong,
    Long,
    WatchShort,
    Short
}

public sealed class PriceZone
{
    public decimal Low { get; init; }
    public decimal High { get; init; }
    public List<string> Timeframes { get; init; } = new();
    public string Strength { get; init; } = "";

    public decimal Midpoint => (Low + High) / 2m;
    public string FrameLabel => string.Join("+", Timeframes);
}

public sealed class SignalAnalysis
{
    public SignalKind Kind { get; init; } = SignalKind.Wait;
    public int Score { get; init; }
    public string AnalysisMode { get; init; } = "SWING / POSITION";
    public string TimeframesDisplay { get; init; } = "1M --   1W --   1D --   12H --   4H --";
    public List<string> Reasons { get; init; } = new();

    public bool HasTradePlan { get; init; }
    public decimal? EntryLow { get; init; }
    public decimal? EntryHigh { get; init; }
    public decimal? StopLoss { get; init; }
    public decimal? TakeProfit1 { get; init; }
    public decimal? TakeProfit2 { get; init; }
    public decimal? TakeProfit3 { get; init; }

    public decimal? WatchLow { get; init; }
    public decimal? WatchHigh { get; init; }
    public string WatchZoneSource { get; init; } = "";
    public string TriggerText { get; init; } = "";
    public string WatchTriggerText { get; init; } = "";
    public string PlanHint { get; init; } = "Chưa có điểm vào lệnh.";

    public List<PriceZone> SupportZones { get; init; } = new();
    public List<PriceZone> ResistanceZones { get; init; } = new();
    public PriceZone? PrimarySupport { get; init; }
    public PriceZone? PrimaryResistance { get; init; }
    public string BreakoutAlternative { get; init; } = "";
    public string InvalidationText { get; init; } = "";
    public decimal? InvalidationLevel { get; init; }
    public decimal? ReferencePrice { get; init; }

    public DateTime UpdatedAt { get; init; } = DateTime.Now;
}
