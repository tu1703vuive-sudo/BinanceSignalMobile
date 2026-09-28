using BinanceSignalMobile.Models;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace BinanceSignalMobile.Services;

public sealed record BinanceTicker(string Symbol, decimal Price, decimal Change24h);

public sealed class BinanceService : IDisposable
{
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(8)
    };

    public async Task<(bool IsValid, BinanceTicker? Ticker, string? Error)> ValidateSymbolAsync(
        string symbol,
        CancellationToken cancellationToken)
    {
        try
        {
            var url = $"https://api.binance.com/api/v3/ticker/24hr?symbol={Uri.EscapeDataString(symbol)}";
            using var response = await _httpClient.GetAsync(url, cancellationToken);

            if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.NotFound)
                return (false, null, "Không tìm thấy cặp coin này trên Binance Spot.");

            if (!response.IsSuccessStatusCode)
                return (false, null, $"Binance trả về lỗi {(int)response.StatusCode}.");

            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!TryReadDecimal(root, "lastPrice", out var price) ||
                !TryReadDecimal(root, "priceChangePercent", out var change))
            {
                return (false, null, "Dữ liệu Binance không hợp lệ.");
            }

            return (true, new BinanceTicker(symbol, price, change), null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return (false, null, "Không kết nối được Binance. Hãy kiểm tra Internet rồi thử lại.");
        }
    }

    public async Task<List<MarketCandle>> GetKlinesAsync(
        string symbol,
        string interval,
        int limit,
        CancellationToken cancellationToken)
    {
        var url = $"https://api.binance.com/api/v3/klines?symbol={Uri.EscapeDataString(symbol)}&interval={Uri.EscapeDataString(interval)}&limit={Math.Clamp(limit, 1, 1000)}";
        using var response = await _httpClient.GetAsync(url, cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(json);
        var result = new List<MarketCandle>();

        foreach (var row in doc.RootElement.EnumerateArray())
        {
            if (row.GetArrayLength() < 7)
                continue;

            var openTime = row[0].GetInt64();
            var closeTime = row[6].GetInt64();

            if (!decimal.TryParse(row[1].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var open) ||
                !decimal.TryParse(row[2].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var high) ||
                !decimal.TryParse(row[3].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var low) ||
                !decimal.TryParse(row[4].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var close) ||
                !decimal.TryParse(row[5].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var volume))
            {
                continue;
            }

            result.Add(new MarketCandle(openTime, open, high, low, close, volume, closeTime));
        }

        return result;
    }

    public async Task RunCombinedMiniTickerAsync(
        IReadOnlyCollection<string> symbols,
        Action<BinanceTicker> onTicker,
        Action<string> onStatus,
        CancellationToken cancellationToken)
    {
        if (symbols.Count == 0)
            return;

        var streams = string.Join('/', symbols.Select(s => $"{s.ToLowerInvariant()}@miniTicker"));
        var endpoint = new Uri($"wss://stream.binance.com:9443/stream?streams={streams}");

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var socket = new ClientWebSocket();
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

                onStatus("Đang kết nối...");
                await socket.ConnectAsync(endpoint, cancellationToken);
                onStatus("Realtime");

                var buffer = new byte[16 * 1024];

                while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
                {
                    using var message = new MemoryStream();
                    WebSocketReceiveResult result;

                    do
                    {
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                        if (result.MessageType == WebSocketMessageType.Close)
                            break;

                        message.Write(buffer, 0, result.Count);
                    }
                    while (!result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Close)
                        break;

                    var json = Encoding.UTF8.GetString(message.ToArray());
                    if (TryParseCombinedMiniTicker(json, out var ticker) && ticker is not null)
                        onTicker(ticker);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                onStatus("Mất kết nối - đang nối lại...");
                try
                {
                    await Task.Delay(2000, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private static bool TryParseCombinedMiniTicker(string json, out BinanceTicker? ticker)
    {
        ticker = null;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("data", out var data))
                return false;

            if (!data.TryGetProperty("s", out var symbolElement) ||
                !data.TryGetProperty("c", out var closeElement) ||
                !data.TryGetProperty("o", out var openElement))
            {
                return false;
            }

            var symbol = symbolElement.GetString();
            if (string.IsNullOrWhiteSpace(symbol))
                return false;

            if (!decimal.TryParse(closeElement.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var price) ||
                !decimal.TryParse(openElement.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var openPrice))
            {
                return false;
            }

            var change = openPrice == 0m ? 0m : (price - openPrice) / openPrice * 100m;
            ticker = new BinanceTicker(symbol.ToUpperInvariant(), price, change);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryReadDecimal(JsonElement root, string propertyName, out decimal value)
    {
        value = 0m;
        return root.TryGetProperty(propertyName, out var element) &&
               decimal.TryParse(element.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out value);
    }

    public void Dispose() => _httpClient.Dispose();
}
