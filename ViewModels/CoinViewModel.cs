using System.ComponentModel;
using System.Runtime.CompilerServices;
using BinanceSignalMobile.Models;

namespace BinanceSignalMobile.ViewModels;

public sealed class CoinViewModel : INotifyPropertyChanged
{
    private decimal? _price;
    private decimal? _change24h;
    private SignalAnalysis? _signal;
    private TradeSignalLifecycle? _lifecycle;
    private bool _isAnalyzing;
    private bool _isFavorite;

    public CoinViewModel(string symbol) => Symbol = symbol.ToUpperInvariant();

    public string Symbol { get; }
    public string BaseAsset => Symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase) ? Symbol[..^4] : Symbol;
    public string PairDisplay => $"{BaseAsset}/USDT";

    public decimal? Price { get => _price; private set { _price = value; OnChanged(); OnChanged(nameof(PriceDisplay)); } }
    public decimal? Change24h { get => _change24h; private set { _change24h = value; OnChanged(); OnChanged(nameof(ChangeDisplay)); OnChanged(nameof(ChangeColor)); } }
    public SignalAnalysis? Signal { get => _signal; private set { _signal = value; OnChanged(); RaiseSignal(); } }
    public TradeSignalLifecycle? Lifecycle { get => _lifecycle; private set { _lifecycle = value; OnChanged(); RaiseSignal(); } }
    public bool IsAnalyzing { get => _isAnalyzing; set { if (_isAnalyzing == value) return; _isAnalyzing = value; OnChanged(); OnChanged(nameof(SignalDisplay)); } }
    public bool IsFavorite { get => _isFavorite; set { if (_isFavorite == value) return; _isFavorite = value; OnChanged(); OnChanged(nameof(FavoriteGlyph)); } }

    public string FavoriteGlyph => IsFavorite ? "★" : "☆";
    public string PriceDisplay => Price.HasValue ? FormatPrice(Price.Value) : "--";
    public string ChangeDisplay => Change24h.HasValue ? $"{(Change24h >= 0 ? "▲" : "▼")} {Math.Abs(Change24h.Value):0.00}%" : "--";
    public Color ChangeColor => !Change24h.HasValue ? Color.FromArgb("#848E9C") : Change24h.Value >= 0 ? Color.FromArgb("#0ECB81") : Color.FromArgb("#F6465D");

    public string SignalDisplay
    {
        get
        {
            if (IsAnalyzing && Signal is null) return "ANALYZING";
            if (Lifecycle is not null && Lifecycle.State is not SignalLifecycleState.Wait) return Lifecycle.State switch
            {
                SignalLifecycleState.WatchLong => "WATCH LONG",
                SignalLifecycleState.WatchShort => "WATCH SHORT",
                SignalLifecycleState.LongConfirmed => "LONG CONFIRMED",
                SignalLifecycleState.ShortConfirmed => "SHORT CONFIRMED",
                SignalLifecycleState.LongActive => "LONG ACTIVE",
                SignalLifecycleState.ShortActive => "SHORT ACTIVE",
                SignalLifecycleState.TakeProfit2Hit => "TP2 HIT",
                SignalLifecycleState.TakeProfit3Hit => "TP3 HIT",
                SignalLifecycleState.StopLossHit => "SL HIT",
                SignalLifecycleState.Invalid => "INVALID",
                SignalLifecycleState.Expired => "EXPIRED",
                _ => "WAIT"
            };
            return Signal?.Kind switch
            {
                SignalKind.Long => "LONG",
                SignalKind.Short => "SHORT",
                SignalKind.WatchLong => "WATCH LONG",
                SignalKind.WatchShort => "WATCH SHORT",
                _ => "WAIT"
            };
        }
    }

    public Color SignalColor => SignalDisplay.Contains("LONG", StringComparison.OrdinalIgnoreCase) ? Color.FromArgb("#0ECB81")
        : SignalDisplay.Contains("SHORT", StringComparison.OrdinalIgnoreCase) || SignalDisplay.Contains("SL", StringComparison.OrdinalIgnoreCase) ? Color.FromArgb("#F6465D")
        : SignalDisplay.Contains("WATCH", StringComparison.OrdinalIgnoreCase) ? Color.FromArgb("#F3BA2F") : Color.FromArgb("#848E9C");

    public string ScoreDisplay => Signal is null ? "Score --" : $"Score {Signal.Score:+0;-0;0}";
    public string EntryDisplay => FormatRange(Lifecycle?.EntryLow ?? Signal?.EntryLow, Lifecycle?.EntryHigh ?? Signal?.EntryHigh, "Entry");
    public string StopDisplay => FormatSingle(Lifecycle?.StopLoss ?? Signal?.StopLoss, "SL");
    public string TpDisplay
    {
        get
        {
            var t1 = Lifecycle?.TakeProfit1 ?? Signal?.TakeProfit1;
            var t2 = Lifecycle?.TakeProfit2 ?? Signal?.TakeProfit2;
            var t3 = Lifecycle?.TakeProfit3 ?? Signal?.TakeProfit3;
            if (!t1.HasValue && !t2.HasValue && !t3.HasValue) return "TP --";
            return $"TP {F(t1)} / {F(t2)} / {F(t3)}";
        }
    }
    public string UpdatedDisplay => Signal is null ? "Chưa phân tích" : $"Cập nhật {Signal.UpdatedAt:HH:mm}";
    public string LifecycleMessage => Lifecycle?.LastMessage ?? Signal?.PlanHint ?? "Chưa có setup.";

    public void UpdatePrice(decimal price, decimal change24h) { Price = price; Change24h = change24h; }
    public void ApplySignal(SignalAnalysis analysis) { Signal = analysis; IsAnalyzing = false; }
    public void ApplyLifecycle(TradeSignalLifecycle lifecycle) => Lifecycle = lifecycle;
    public void ApplyError(string message, string mode) => ApplySignal(new SignalAnalysis { AnalysisMode = mode, Reasons = new() { message }, PlanHint = message, UpdatedAt = DateTime.Now });

    private void RaiseSignal()
    {
        OnChanged(nameof(SignalDisplay)); OnChanged(nameof(SignalColor)); OnChanged(nameof(ScoreDisplay));
        OnChanged(nameof(EntryDisplay)); OnChanged(nameof(StopDisplay)); OnChanged(nameof(TpDisplay));
        OnChanged(nameof(UpdatedDisplay)); OnChanged(nameof(LifecycleMessage));
    }

    private static string FormatRange(decimal? low, decimal? high, string label) => low.HasValue && high.HasValue ? $"{label} {FormatPrice(low.Value)} – {FormatPrice(high.Value)}" : $"{label} --";
    private static string FormatSingle(decimal? value, string label) => value.HasValue ? $"{label} {FormatPrice(value.Value)}" : $"{label} --";
    private static string F(decimal? value) => value.HasValue ? FormatPrice(value.Value) : "--";
    public static string FormatPrice(decimal value)
    {
        var abs = Math.Abs(value);
        return abs >= 1000m ? value.ToString("#,##0.##") : abs >= 1m ? value.ToString("0.####") : value.ToString("0.########");
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
