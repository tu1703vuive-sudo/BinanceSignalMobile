namespace BinanceSignalMobile;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
        MainPage = new NavigationPage(new Views.MainPage())
        {
            BarBackgroundColor = Color.FromArgb("#0B0E11"),
            BarTextColor = Colors.White
        };
    }
}
