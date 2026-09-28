namespace BinanceSignalMobile.Models;

public sealed record MarketCandle(
    long OpenTime,
    decimal Open,
    decimal High,
    decimal Low,
    decimal Close,
    decimal Volume,
    long CloseTime);
