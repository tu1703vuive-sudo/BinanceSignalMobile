namespace BinanceSignalMobile.Models;

public enum SignalLifecycleState
{
    Wait = 0,
    WatchLong = 1,
    WatchShort = 2,
    LongConfirmed = 3,
    ShortConfirmed = 4,
    LongActive = 5,
    ShortActive = 6,
    TakeProfit2Hit = 7,
    StopLossHit = 8,
    Invalid = 9,
    Expired = 10,
    TakeProfit3Hit = 11
}

public sealed class SignalLifecycleEvent
{
    public DateTime Time { get; set; } = DateTime.Now;
    public SignalLifecycleState State { get; set; } = SignalLifecycleState.Wait;
    public string Message { get; set; } = "";
}

public sealed class TradeSignalLifecycle
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Symbol { get; set; } = "";
    public string Mode { get; set; } = "Swing";
    public SignalLifecycleState State { get; set; } = SignalLifecycleState.Wait;

    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? ActivatedAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    public decimal? WatchLow { get; set; }
    public decimal? WatchHigh { get; set; }
    public string WatchSource { get; set; } = "";

    public decimal? EntryLow { get; set; }
    public decimal? EntryHigh { get; set; }
    public decimal? StopLoss { get; set; }
    public decimal? TakeProfit1 { get; set; }
    public decimal? TakeProfit2 { get; set; }
    public decimal? TakeProfit3 { get; set; }
    public decimal? InvalidationLevel { get; set; }

    public bool Tp1Hit { get; set; }
    public bool Tp2Hit { get; set; }
    public bool Tp3Hit { get; set; }
    public decimal? ActualEntryPrice { get; set; }
    public decimal? LastPrice { get; set; }
    public string LastMessage { get; set; } = "";

    public List<SignalLifecycleEvent> Timeline { get; set; } = new();

    public bool IsTerminal => State is SignalLifecycleState.TakeProfit2Hit
        or SignalLifecycleState.TakeProfit3Hit
        or SignalLifecycleState.StopLossHit
        or SignalLifecycleState.Invalid
        or SignalLifecycleState.Expired;

    public bool IsLong => State is SignalLifecycleState.WatchLong
        or SignalLifecycleState.LongConfirmed
        or SignalLifecycleState.LongActive;

    public bool IsShort => State is SignalLifecycleState.WatchShort
        or SignalLifecycleState.ShortConfirmed
        or SignalLifecycleState.ShortActive;
}
