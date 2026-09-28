using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using BinanceSignalMobile.Models;
using BinanceSignalMobile.Services;
using Microsoft.Maui.ApplicationModel;

namespace BinanceSignalMobile.ViewModels;

public sealed class MainViewModel : INotifyPropertyChanged, IDisposable
{
    private const int MaxCoins = 20;
    private static readonly Regex ValidSymbolRegex = new("^[A-Z0-9]+$", RegexOptions.Compiled);
    private readonly BinanceService _binance = new();
    private readonly SignalEngine _signalEngine = new();
    private readonly SignalLifecycleService _lifecycleService = new();
    private readonly MobileSignalLifecycleStore _store = new();
    private readonly SemaphoreSlim _signalGate = new(3, 3);
    private readonly CancellationTokenSource _cts = new();
    private CancellationTokenSource? _streamCts;
    private CancellationTokenSource? _analysisCts;
    private MobileSettings _settings = new();
    private bool _shortTerm;
    private bool _initialized;
    private string _status = "OFFLINE";
    private bool _isBusy;

    public ObservableCollection<CoinViewModel> Coins { get; } = new();
    public bool ShortTerm { get => _shortTerm; private set { _shortTerm = value; OnChanged(); OnChanged(nameof(ModeText)); } }
    public string ModeText => ShortTerm ? "SHORT TERM" : "SWING / POSITION";
    public string Status { get => _status; private set { _status = value; OnChanged(); } }
    public bool IsBusy { get => _isBusy; private set { _isBusy = value; OnChanged(); } }

    public async Task InitializeAsync()
    {
        if (_initialized) return;
        _initialized = true;
        _settings = MobileSettingsService.Load();
        ShortTerm = string.Equals(_settings.AnalysisMode, "ShortTerm", StringComparison.OrdinalIgnoreCase);
        foreach (var symbol in (_settings.Symbols.Count == 0 ? new[] { "BTCUSDT" } : _settings.Symbols).Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxCoins))
        {
            var coin = new CoinViewModel(NormalizeSymbol(symbol)) { IsFavorite = _settings.FavoriteSymbols.Contains(symbol, StringComparer.OrdinalIgnoreCase) };
            var saved = _store.GetCurrent(coin.Symbol, CurrentModeKey());
            if (saved is not null) coin.ApplyLifecycle(saved);
            Coins.Add(coin);
        }
        RestartRealtime();
        RestartAnalysis();
        await AnalyzeAllAsync(_cts.Token);
    }

    public async Task ToggleModeAsync()
    {
        ShortTerm = !ShortTerm;
        _settings.AnalysisMode = ShortTerm ? "ShortTerm" : "Swing";
        MobileSettingsService.Save(_settings);
        foreach (var coin in Coins)
        {
            var saved = _store.GetCurrent(coin.Symbol, CurrentModeKey());
            if (saved is not null) coin.ApplyLifecycle(saved);
        }
        RestartAnalysis();
        await AnalyzeAllAsync(_cts.Token);
    }

    public async Task<(bool Ok, string Message)> AddCoinAsync(string? raw)
    {
        var symbol = NormalizeSymbol(raw);
        if (string.IsNullOrWhiteSpace(symbol) || !ValidSymbolRegex.IsMatch(symbol)) return (false, "Mã coin không hợp lệ.");
        if (!symbol.EndsWith("USDT", StringComparison.OrdinalIgnoreCase)) symbol += "USDT";
        if (Coins.Any(c => c.Symbol.Equals(symbol, StringComparison.OrdinalIgnoreCase))) return (false, "Coin đã có trong danh sách.");
        if (Coins.Count >= MaxCoins) return (false, $"Tối đa {MaxCoins} coin.");
        try
        {
            using var checkCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var check = await _binance.ValidateSymbolAsync(symbol, checkCts.Token);
            if (!check.IsValid || check.Ticker is null) return (false, check.Error ?? "Không tìm thấy coin.");
            var coin = new CoinViewModel(symbol);
            coin.UpdatePrice(check.Ticker.Price, check.Ticker.Change24h);
            Coins.Add(coin);
            SaveSettings();
            RestartRealtime();
            _ = AnalyzeCoinAsync(coin, _cts.Token);
            return (true, $"Đã thêm {symbol}.");
        }
        catch { return (false, "Không kết nối được Binance."); }
    }

    public void RemoveCoin(CoinViewModel coin)
    {
        Coins.Remove(coin);
        SaveSettings();
        RestartRealtime();
    }

    public void ToggleFavorite(CoinViewModel coin)
    {
        coin.IsFavorite = !coin.IsFavorite;
        SaveSettings();
        var ordered = Coins.OrderByDescending(c => c.IsFavorite).ThenBy(c => c.Symbol).ToList();
        Coins.Clear(); foreach (var c in ordered) Coins.Add(c);
    }

    public async Task RefreshAsync()
    {
        IsBusy = true;
        try { await AnalyzeAllAsync(_cts.Token); }
        finally { IsBusy = false; }
    }

    private void RestartRealtime()
    {
        _streamCts?.Cancel(); _streamCts?.Dispose();
        _streamCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        var symbols = Coins.Select(c => c.Symbol).ToArray();
        if (symbols.Length == 0) return;
        _ = Task.Run(() => _binance.RunCombinedMiniTickerAsync(symbols,
            ticker => MainThread.BeginInvokeOnMainThread(() => ApplyTicker(ticker)),
            status => MainThread.BeginInvokeOnMainThread(() => Status = status.Equals("Realtime", StringComparison.OrdinalIgnoreCase) ? "● LIVE" : $"● {status}"),
            _streamCts.Token));
    }

    private void RestartAnalysis()
    {
        _analysisCts?.Cancel(); _analysisCts?.Dispose();
        _analysisCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        _ = Task.Run(() => AnalysisLoopAsync(_analysisCts.Token));
    }

    private async Task AnalysisLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await AnalyzeAllAsync(ct);
                await Task.Delay(ShortTerm ? TimeSpan.FromMinutes(2) : TimeSpan.FromMinutes(10), ct);
            }
            catch (OperationCanceledException) { break; }
            catch
            {
                try { await Task.Delay(TimeSpan.FromSeconds(20), ct); } catch { break; }
            }
        }
    }

    private async Task AnalyzeAllAsync(CancellationToken ct)
    {
        var tasks = Coins.ToList().Select(c => AnalyzeCoinAsync(c, ct));
        await Task.WhenAll(tasks);
    }

    private async Task AnalyzeCoinAsync(CoinViewModel coin, CancellationToken ct)
    {
        coin.IsAnalyzing = true;
        var held = false;
        var shortTerm = ShortTerm;
        try
        {
            await _signalGate.WaitAsync(ct); held = true;
            SignalAnalysis analysis;
            IReadOnlyList<MarketCandle> executionCandles;
            if (shortTerm)
            {
                var t5 = _binance.GetKlinesAsync(coin.Symbol, "5m", 260, ct);
                var t15 = _binance.GetKlinesAsync(coin.Symbol, "15m", 260, ct);
                var t1h = _binance.GetKlinesAsync(coin.Symbol, "1h", 260, ct);
                var t4h = _binance.GetKlinesAsync(coin.Symbol, "4h", 260, ct);
                await Task.WhenAll(t5, t15, t1h, t4h);
                var c5 = await t5; var c15 = await t15; var c1h = await t1h; var c4h = await t4h;
                executionCandles = c5;
                analysis = _signalEngine.AnalyzeShortTerm(c5, c15, c1h, c4h);
            }
            else
            {
                var t1M = _binance.GetKlinesAsync(coin.Symbol, "1M", 80, ct);
                var t1w = _binance.GetKlinesAsync(coin.Symbol, "1w", 160, ct);
                var t1d = _binance.GetKlinesAsync(coin.Symbol, "1d", 320, ct);
                var t12h = _binance.GetKlinesAsync(coin.Symbol, "12h", 320, ct);
                var t4h = _binance.GetKlinesAsync(coin.Symbol, "4h", 320, ct);
                await Task.WhenAll(t1M, t1w, t1d, t12h, t4h);
                var c1M = await t1M; var c1w = await t1w; var c1d = await t1d; var c12h = await t12h; var c4h = await t4h;
                executionCandles = c4h;
                analysis = _signalEngine.AnalyzePosition(c1M, c1w, c1d, c12h, c4h);
            }

            MainThread.BeginInvokeOnMainThread(() => coin.ApplySignal(analysis));
            var mode = shortTerm ? "ShortTerm" : "Swing";
            var current = coin.Lifecycle;
            if (current is null || !current.Mode.Equals(mode, StringComparison.OrdinalIgnoreCase)) current = _store.GetCurrent(coin.Symbol, mode);
            var lifecycle = _lifecycleService.ApplyAnalysis(current, coin.Symbol, mode, analysis, coin.Price, DateTime.Now, executionCandles);
            MainThread.BeginInvokeOnMainThread(() => coin.ApplyLifecycle(lifecycle));
            _store.SaveCurrent(lifecycle);
        }
        catch (OperationCanceledException) { }
        catch
        {
            MainThread.BeginInvokeOnMainThread(() => coin.ApplyError("Không lấy được dữ liệu Kline từ Binance.", shortTerm ? "SHORT TERM" : "SWING / POSITION"));
        }
        finally { if (held) _signalGate.Release(); coin.IsAnalyzing = false; }
    }

    private void ApplyTicker(BinanceTicker ticker)
    {
        var coin = Coins.FirstOrDefault(c => c.Symbol.Equals(ticker.Symbol, StringComparison.OrdinalIgnoreCase));
        if (coin is null) return;
        coin.UpdatePrice(ticker.Price, ticker.Change24h);
        var lifecycle = coin.Lifecycle;
        if (lifecycle is null || !lifecycle.Mode.Equals(CurrentModeKey(), StringComparison.OrdinalIgnoreCase)) return;
        var oldState = lifecycle.State; var old1 = lifecycle.Tp1Hit; var old2 = lifecycle.Tp2Hit; var old3 = lifecycle.Tp3Hit;
        lifecycle = _lifecycleService.ApplyPriceTick(lifecycle, ticker.Price, DateTime.Now);
        coin.ApplyLifecycle(lifecycle);
        if (oldState != lifecycle.State || old1 != lifecycle.Tp1Hit || old2 != lifecycle.Tp2Hit || old3 != lifecycle.Tp3Hit) _store.SaveCurrent(lifecycle);
    }

    private string CurrentModeKey() => ShortTerm ? "ShortTerm" : "Swing";
    private static string NormalizeSymbol(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        return raw.Trim().ToUpperInvariant().Replace("/", "").Replace("-", "").Replace("_", "").Replace(" ", "");
    }
    private void SaveSettings()
    {
        _settings.Symbols = Coins.Select(c => c.Symbol).ToList();
        _settings.FavoriteSymbols = Coins.Where(c => c.IsFavorite).Select(c => c.Symbol).ToList();
        _settings.AnalysisMode = ShortTerm ? "ShortTerm" : "Swing";
        MobileSettingsService.Save(_settings);
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    public void Dispose() { _cts.Cancel(); _streamCts?.Cancel(); _analysisCts?.Cancel(); _binance.Dispose(); _signalGate.Dispose(); _cts.Dispose(); }
}
