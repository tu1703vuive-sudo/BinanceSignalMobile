using System.Text.Json;
using BinanceSignalMobile.Models;
using Microsoft.Maui.Storage;

namespace BinanceSignalMobile.Services;

public sealed class MobileSignalLifecycleStore
{
    private readonly object _gate = new();
    private readonly string _filePath = Path.Combine(FileSystem.AppDataDirectory, "signal-lifecycle.json");
    private StoreData _data;

    private sealed class StoreData
    {
        public List<TradeSignalLifecycle> Current { get; set; } = new();
        public List<TradeSignalLifecycle> History { get; set; } = new();
    }

    public MobileSignalLifecycleStore() => _data = Load();

    public TradeSignalLifecycle? GetCurrent(string symbol, string mode)
    {
        lock (_gate)
            return _data.Current.FirstOrDefault(x => x.Symbol.Equals(symbol, StringComparison.OrdinalIgnoreCase) && x.Mode.Equals(mode, StringComparison.OrdinalIgnoreCase));
    }

    public void SaveCurrent(TradeSignalLifecycle lifecycle)
    {
        lock (_gate)
        {
            _data.Current.RemoveAll(x => x.Symbol.Equals(lifecycle.Symbol, StringComparison.OrdinalIgnoreCase) && x.Mode.Equals(lifecycle.Mode, StringComparison.OrdinalIgnoreCase));
            _data.Current.Add(lifecycle);
            if (lifecycle.IsTerminal && !_data.History.Any(x => x.Id == lifecycle.Id))
            {
                _data.History.Insert(0, Clone(lifecycle));
                if (_data.History.Count > 1000) _data.History.RemoveRange(1000, _data.History.Count - 1000);
            }
            Persist();
        }
    }

    public IReadOnlyList<TradeSignalLifecycle> GetHistory(string symbol, string mode, int take = 20)
    {
        lock (_gate)
            return _data.History.Where(x => x.Symbol.Equals(symbol, StringComparison.OrdinalIgnoreCase) && x.Mode.Equals(mode, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.ClosedAt ?? x.UpdatedAt).Take(Math.Max(1, take)).Select(Clone).ToList();
    }

    private StoreData Load()
    {
        try
        {
            if (!File.Exists(_filePath)) return new StoreData();
            return JsonSerializer.Deserialize<StoreData>(File.ReadAllText(_filePath)) ?? new StoreData();
        }
        catch { return new StoreData(); }
    }

    private void Persist()
    {
        try
        {
            File.WriteAllText(_filePath, JsonSerializer.Serialize(_data, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    private static TradeSignalLifecycle Clone(TradeSignalLifecycle source)
    {
        var json = JsonSerializer.Serialize(source);
        return JsonSerializer.Deserialize<TradeSignalLifecycle>(json) ?? source;
    }
}
