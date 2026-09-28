using BinanceSignalMobile.Controls;
using BinanceSignalMobile.Services;
using BinanceSignalMobile.ViewModels;

namespace BinanceSignalMobile.Views;

public partial class CoinDetailPage : ContentPage
{
    private readonly CoinViewModel _coin;
    private readonly BinanceService _binance = new();
    private string _interval;
    private readonly CandlestickDrawable _drawable = new();

    public CoinDetailPage(CoinViewModel coin, bool shortTerm)
    {
        InitializeComponent();
        _coin = coin; BindingContext = coin;
        _interval = shortTerm ? "15m" : "1d";
        Chart.Drawable = _drawable;
        BuildReasons();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await LoadChartAsync(_interval);
        BuildReasons();
    }

    private async void Interval_Clicked(object sender, EventArgs e)
    {
        if (sender is Button b && b.CommandParameter is string interval) await LoadChartAsync(interval);
    }

    private async Task LoadChartAsync(string interval)
    {
        _interval = interval; ChartStatus.Text = $"Đang tải {_interval}…";
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            var candles = await _binance.GetKlinesAsync(_coin.Symbol, interval, 140, cts.Token);
            _drawable.Candles = candles;
            _drawable.Supports = _coin.Signal?.SupportZones ?? Array.Empty<BinanceSignalMobile.Models.PriceZone>();
            _drawable.Resistances = _coin.Signal?.ResistanceZones ?? Array.Empty<BinanceSignalMobile.Models.PriceZone>();
            Chart.Invalidate();
            ChartStatus.Text = $"{_interval.ToUpperInvariant()} • {candles.Count} nến";
        }
        catch { ChartStatus.Text = "Không tải được biểu đồ Binance."; }
    }

    private void BuildReasons()
    {
        Reasons.Clear();
        foreach (var reason in _coin.Signal?.Reasons ?? new List<string> { "Chưa có dữ liệu phân tích." })
            Reasons.Add(new Label { Text = "• " + reason, FontSize = 12, TextColor = Color.FromArgb("#B7C0CA") });
    }

    private async void OpenBinance_Clicked(object sender, EventArgs e)
    {
        await Launcher.Default.OpenAsync($"https://www.binance.com/en/trade/{_coin.BaseAsset}_USDT");
    }
}
