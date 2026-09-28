using BinanceSignalMobile.ViewModels;

namespace BinanceSignalMobile.Views;

public partial class MainPage : ContentPage
{
    private readonly MainViewModel _vm = new();
    private bool _loaded;

    public MainPage()
    {
        InitializeComponent();
        BindingContext = _vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (_loaded) return;
        _loaded = true;
        await _vm.InitializeAsync();
    }

    private async void AddCoin_Clicked(object sender, EventArgs e)
    {
        var input = await DisplayPromptAsync("Thêm coin", "Nhập BTC, ETH, SOL hoặc BTCUSDT", "Thêm", "Hủy", "BTCUSDT", maxLength: 20);
        if (input is null) return;
        var result = await _vm.AddCoinAsync(input);
        if (!result.Ok) await DisplayAlert("Không thể thêm", result.Message, "OK");
    }

    private async void Mode_Clicked(object sender, EventArgs e) => await _vm.ToggleModeAsync();
    private async void Refresh_Clicked(object sender, EventArgs e) => await _vm.RefreshAsync();
    private async void RefreshView_Refreshing(object sender, EventArgs e) => await _vm.RefreshAsync();

    private void Favorite_Clicked(object sender, EventArgs e)
    {
        if ((sender as BindableObject)?.BindingContext is CoinViewModel coin) _vm.ToggleFavorite(coin);
    }

    private async void CoinList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not CoinViewModel coin) return;
        CoinList.SelectedItem = null;
        await Navigation.PushAsync(new CoinDetailPage(coin, _vm.ShortTerm));
    }
}
