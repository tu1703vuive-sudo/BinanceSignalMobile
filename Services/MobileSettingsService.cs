using System.Text.Json;
using Microsoft.Maui.Storage;

namespace BinanceSignalMobile.Services;

public sealed class MobileSettings
{
    public List<string> Symbols { get; set; } = new() { "BTCUSDT", "ETHUSDT", "SOLUSDT" };
    public List<string> FavoriteSymbols { get; set; } = new() { "BTCUSDT" };
    public string AnalysisMode { get; set; } = "Swing";
}

public static class MobileSettingsService
{
    private static string FilePath => Path.Combine(FileSystem.AppDataDirectory, "settings.json");

    public static MobileSettings Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new MobileSettings();
            return JsonSerializer.Deserialize<MobileSettings>(File.ReadAllText(FilePath)) ?? new MobileSettings();
        }
        catch { return new MobileSettings(); }
    }

    public static void Save(MobileSettings settings)
    {
        try
        {
            Directory.CreateDirectory(FileSystem.AppDataDirectory);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}
