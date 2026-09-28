using BinanceSignalMobile.Models;
using Microsoft.Maui.Graphics;

namespace BinanceSignalMobile.Controls;

public sealed class CandlestickDrawable : IDrawable
{
    public IReadOnlyList<MarketCandle> Candles { get; set; } = Array.Empty<MarketCandle>();
    public IReadOnlyList<PriceZone> Supports { get; set; } = Array.Empty<PriceZone>();
    public IReadOnlyList<PriceZone> Resistances { get; set; } = Array.Empty<PriceZone>();

    public void Draw(ICanvas canvas, RectF dirtyRect)
    {
        canvas.FillColor = Color.FromArgb("#111820");
        canvas.FillRectangle(dirtyRect);
        if (Candles.Count < 2) return;
        var data = Candles.TakeLast(Math.Min(90, Candles.Count)).ToList();
        var lo = data.Min(c => c.Low); var hi = data.Max(c => c.High);
        if (hi <= lo) hi = lo + 1m;
        float Y(decimal p) => dirtyRect.Top + (float)((hi - p) / (hi - lo)) * dirtyRect.Height;

        void DrawZone(PriceZone z, Color color)
        {
            var top = Y(z.High); var bottom = Y(z.Low);
            canvas.FillColor = color.WithAlpha(0.13f);
            canvas.FillRectangle(dirtyRect.Left, Math.Min(top, bottom), dirtyRect.Width, Math.Max(2, Math.Abs(bottom - top)));
        }
        foreach (var z in Supports.Take(2)) DrawZone(z, Color.FromArgb("#0ECB81"));
        foreach (var z in Resistances.Take(2)) DrawZone(z, Color.FromArgb("#F6465D"));

        var step = dirtyRect.Width / data.Count;
        var body = Math.Max(2f, step * 0.58f);
        for (var i = 0; i < data.Count; i++)
        {
            var c = data[i]; var x = dirtyRect.Left + i * step + step / 2f;
            var up = c.Close >= c.Open;
            var color = up ? Color.FromArgb("#0ECB81") : Color.FromArgb("#F6465D");
            canvas.StrokeColor = color; canvas.StrokeSize = 1;
            canvas.DrawLine(x, Y(c.High), x, Y(c.Low));
            var y1 = Y(c.Open); var y2 = Y(c.Close);
            canvas.FillColor = color;
            canvas.FillRectangle(x - body / 2f, Math.Min(y1, y2), body, Math.Max(1.5f, Math.Abs(y2 - y1)));
        }
    }
}
