(() => {
  "use strict";

  const API_BASES = [
    "https://data-api.binance.vision",
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com"
  ];

  const WS_BASES = [
    "wss://stream.binance.com:9443/ws",
    "wss://stream.binance.com:443/ws"
  ];

  const SYMBOLS = [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
    "DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","TRXUSDT",
    "SUIUSDT","TONUSDT","LTCUSDT","BCHUSDT","DOTUSDT"
  ];

  const MODES = {
    short: {
      label: "NGẮN HẠN",
      timeframes: [
        { interval: "4h", label: "4H", weight: 45, limit: 260 },
        { interval: "1h", label: "1H", weight: 35, limit: 260 },
        { interval: "15m", label: "15m", weight: 20, limit: 260 }
      ],
      signalThreshold: 62,
      watchThreshold: 45,
      pivotSpan: 2,
      zonePct: 0.0025
    },
    swing: {
      label: "DÀI HẠN",
      timeframes: [
        { interval: "1w", label: "1W", weight: 30, limit: 260 },
        { interval: "1d", label: "1D", weight: 30, limit: 260 },
        { interval: "12h", label: "12H", weight: 20, limit: 260 },
        { interval: "4h", label: "4H", weight: 20, limit: 260 }
      ],
      signalThreshold: 58,
      watchThreshold: 42,
      pivotSpan: 2,
      zonePct: 0.006
    }
  };

  const state = {
    symbol: localStorage.getItem("bsw.symbol") || "BTCUSDT",
    mode: localStorage.getItem("bsw.mode") || "short",
    analysisGeneration: 0,
    fetchController: null,
    websocket: null,
    wsRetry: 0,
    wsTimer: null,
    lastAnalysis: null,
    deferredInstallPrompt: null,
    autoTimer: null
  };

  const $ = (id) => document.getElementById(id);

  const el = {
    symbolSelect: $("symbolSelect"),
    shortModeBtn: $("shortModeBtn"),
    swingModeBtn: $("swingModeBtn"),
    analyzeBtn: $("analyzeBtn"),
    livePrice: $("livePrice"),
    priceChange: $("priceChange"),
    lastUpdated: $("lastUpdated"),
    wsDot: $("wsDot"),
    wsStatus: $("wsStatus"),
    signalBadge: $("signalBadge"),
    signalSummary: $("signalSummary"),
    signalScore: $("signalScore"),
    scoreMeter: $("scoreMeter"),
    modeBadge: $("modeBadge"),
    planDirection: $("planDirection"),
    entryValue: $("entryValue"),
    slValue: $("slValue"),
    tp1Value: $("tp1Value"),
    tp2Value: $("tp2Value"),
    rrValue: $("rrValue"),
    supportZones: $("supportZones"),
    resistanceZones: $("resistanceZones"),
    timeframeRows: $("timeframeRows"),
    reasonList: $("reasonList"),
    historyRows: $("historyRows"),
    clearHistoryBtn: $("clearHistoryBtn"),
    engineTitle: $("engineTitle"),
    apiStatus: $("apiStatus"),
    installBtn: $("installBtn"),
    toast: $("toast")
  };

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function fmtNumber(n) {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    let digits = 2;
    if (abs >= 10000) digits = 2;
    else if (abs >= 1000) digits = 2;
    else if (abs >= 100) digits = 3;
    else if (abs >= 1) digits = 4;
    else digits = 6;
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0
    }).format(n);
  }

  function fmtPct(n) {
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  function nowLabel(ts = Date.now()) {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      day: "2-digit", month: "2-digit"
    }).format(new Date(ts));
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  }

  function setBusy(busy) {
    el.analyzeBtn.disabled = busy;
    el.analyzeBtn.textContent = busy ? "Đang phân tích..." : "Phân tích ngay";
  }

  function initSymbolSelect() {
    el.symbolSelect.innerHTML = SYMBOLS
      .map(s => `<option value="${s}">${s.replace("USDT", "/USDT")}</option>`)
      .join("");
    if (!SYMBOLS.includes(state.symbol)) state.symbol = "BTCUSDT";
    el.symbolSelect.value = state.symbol;
  }

  function syncModeUI() {
    const short = state.mode === "short";
    el.shortModeBtn.classList.toggle("active", short);
    el.swingModeBtn.classList.toggle("active", !short);
    el.modeBadge.textContent = MODES[state.mode].label;
    const spec = MODES[state.mode].timeframes;
    el.engineTitle.textContent = spec.map(x => `${x.label} ${x.weight}%`).join(" · ");
  }

  async function fetchJson(path, { signal, timeoutMs = 10000 } = {}) {
    let lastError = null;

    for (const base of API_BASES) {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);
      const combined = mergeSignals(signal, timeoutController.signal);

      try {
        const response = await fetch(`${base}${path}`, {
          method: "GET",
          cache: "no-store",
          signal: combined
        });

        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          if (response.status === 418 || response.status === 429) {
            clearTimeout(timer);
            continue;
          }
          throw lastError;
        }

        const data = await response.json();
        clearTimeout(timer);
        el.apiStatus.textContent = base.includes("vision") ? "DATA API" : "BINANCE API";
        return data;
      } catch (error) {
        clearTimeout(timer);
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }

    throw lastError || new Error("Không thể kết nối Binance API.");
  }

  function mergeSignals(...signals) {
    const controller = new AbortController();
    for (const signal of signals.filter(Boolean)) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  }

  async function fetchKlines(symbol, interval, limit, signal) {
    const rows = await fetchJson(
      `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`,
      { signal }
    );

    return rows.map(r => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6])
    })).filter(c =>
      [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)
    );
  }

  function sma(values, period) {
    if (values.length < period) return NaN;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return sum / period;
  }

  function emaSeries(values, period) {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const out = new Array(values.length).fill(NaN);
    if (values.length < period) return out;

    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    let prev = seed / period;
    out[period - 1] = prev;

    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function lastFinite(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (Number.isFinite(arr[i])) return arr[i];
    }
    return NaN;
  }

  function rsi(values, period = 14) {
    if (values.length <= period) return NaN;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gains += d;
      else losses -= d;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const gain = d > 0 ? d : 0;
      const loss = d < 0 ? -d : 0;
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function atr(candles, period = 14) {
    if (candles.length <= period) return NaN;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close;
      const c = candles[i];
      trs.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      ));
    }
    if (trs.length < period) return NaN;

    let value = trs.slice(0, period).reduce((a,b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      value = ((value * (period - 1)) + trs[i]) / period;
    }
    return value;
  }

  function macd(values) {
    const fast = emaSeries(values, 12);
    const slow = emaSeries(values, 26);
    const line = values.map((_, i) =>
      Number.isFinite(fast[i]) && Number.isFinite(slow[i]) ? fast[i] - slow[i] : NaN
    );

    const valid = line.filter(Number.isFinite);
    const signalSeries = emaSeries(valid, 9);
    const macdLine = lastFinite(line);
    const signal = lastFinite(signalSeries);
    return {
      line: macdLine,
      signal,
      histogram: Number.isFinite(macdLine) && Number.isFinite(signal) ? macdLine - signal : NaN
    };
  }

  function recentStructure(candles, span = 2) {
    const pivH = [];
    const pivL = [];
    for (let i = span; i < candles.length - span; i++) {
      let high = true, low = true;
      for (let j = i - span; j <= i + span; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) high = false;
        if (candles[j].low <= candles[i].low) low = false;
      }
      if (high) pivH.push(candles[i].high);
      if (low) pivL.push(candles[i].low);
    }

    const lastH = pivH.slice(-2);
    const lastL = pivL.slice(-2);
    if (lastH.length < 2 || lastL.length < 2) return 0;
    if (lastH[1] > lastH[0] && lastL[1] > lastL[0]) return 1;
    if (lastH[1] < lastH[0] && lastL[1] < lastL[0]) return -1;
    return 0;
  }

  function analyzeTimeframe(candles, spec) {
    const closes = candles.map(c => c.close);
    const close = closes.at(-1);
    const ema20 = lastFinite(emaSeries(closes, 20));
    const ema50 = lastFinite(emaSeries(closes, 50));
    const ema200 = lastFinite(emaSeries(closes, 200));
    const rsi14 = rsi(closes, 14);
    const macdData = macd(closes);
    const structure = recentStructure(candles.slice(-120), 2);
    const atr14 = atr(candles, 14);

    let bias = 0;
    const reasons = [];

    if (ema20 > ema50) { bias += 35; reasons.push("EMA20 > EMA50"); }
    else if (ema20 < ema50) { bias -= 35; reasons.push("EMA20 < EMA50"); }

    if (close > ema20) { bias += 15; reasons.push("Giá trên EMA20"); }
    else if (close < ema20) { bias -= 15; reasons.push("Giá dưới EMA20"); }

    if (ema50 > ema200) { bias += 20; reasons.push("EMA50 > EMA200"); }
    else if (ema50 < ema200) { bias -= 20; reasons.push("EMA50 < EMA200"); }

    if (macdData.histogram > 0) { bias += 15; reasons.push("MACD histogram dương"); }
    else if (macdData.histogram < 0) { bias -= 15; reasons.push("MACD histogram âm"); }

    if (rsi14 >= 55) { bias += 10; reasons.push("RSI thiên tăng"); }
    else if (rsi14 <= 45) { bias -= 10; reasons.push("RSI thiên giảm"); }

    if (structure > 0) { bias += 5; reasons.push("Cấu trúc HH/HL"); }
    else if (structure < 0) { bias -= 5; reasons.push("Cấu trúc LH/LL"); }

    bias = Math.max(-100, Math.min(100, bias));

    return {
      ...spec,
      close, ema20, ema50, ema200, rsi14,
      macdHistogram: macdData.histogram,
      atr14, structure, bias, reasons
    };
  }

  function findPivots(candles, span, timeframeWeight) {
    const out = [];
    for (let i = span; i < candles.length - span; i++) {
      const c = candles[i];
      let isHigh = true;
      let isLow = true;
      for (let j = i - span; j <= i + span; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) isHigh = false;
        if (candles[j].low <= c.low) isLow = false;
      }
      if (isHigh) out.push({ type: "resistance", price: c.high, time: c.closeTime, weight: timeframeWeight });
      if (isLow) out.push({ type: "support", price: c.low, time: c.closeTime, weight: timeframeWeight });
    }
    return out;
  }

  function buildZones(allData, currentPrice, mode) {
    const cfg = MODES[mode];
    const points = [];
    let anchorAtr = NaN;

    for (const item of allData) {
      const pivots = findPivots(item.candles.slice(-140), cfg.pivotSpan, item.spec.weight);
      points.push(...pivots);
      if (!Number.isFinite(anchorAtr) && Number.isFinite(item.analysis.atr14)) anchorAtr = item.analysis.atr14;
    }

    const threshold = Math.max(
      currentPrice * cfg.zonePct,
      Number.isFinite(anchorAtr) ? anchorAtr * (mode === "short" ? 0.30 : 0.45) : 0
    );

    function cluster(type) {
      const filtered = points
        .filter(p => p.type === type)
        .sort((a,b) => a.price - b.price);

      const clusters = [];
      for (const p of filtered) {
        let best = null;
        let bestDist = Infinity;
        for (const c of clusters) {
          const dist = Math.abs(c.center - p.price);
          if (dist <= threshold && dist < bestDist) {
            best = c;
            bestDist = dist;
          }
        }
        if (!best) {
          clusters.push({ center: p.price, points: [p] });
        } else {
          best.points.push(p);
          best.center = best.points.reduce((s,x) => s + x.price * x.weight, 0) /
                        best.points.reduce((s,x) => s + x.weight, 0);
        }
      }

      return clusters.map(c => {
        const prices = c.points.map(x => x.price);
        const tfWeight = c.points.reduce((s,x) => s + x.weight, 0);
        const latest = Math.max(...c.points.map(x => x.time));
        const ageDays = Math.max(0, (Date.now() - latest) / 86400000);
        const recency = Math.max(0.35, 1 - Math.min(ageDays, 120) / 150);
        const strengthScore = c.points.length * 1.6 + (tfWeight / 30) * 0.85 * recency;
        const pad = threshold * 0.18;
        return {
          type,
          center: c.center,
          low: Math.min(...prices) - pad,
          high: Math.max(...prices) + pad,
          touches: c.points.length,
          strengthScore,
          label: strengthScore >= 8.5 ? "VERY STRONG" : strengthScore >= 5.2 ? "STRONG" : "NORMAL"
        };
      });
    }

    const supports = cluster("support")
      .filter(z => z.center < currentPrice * 1.002)
      .sort((a,b) => b.center - a.center)
      .slice(0, 4);

    const resistances = cluster("resistance")
      .filter(z => z.center > currentPrice * 0.998)
      .sort((a,b) => a.center - b.center)
      .slice(0, 4);

    return { supports, resistances };
  }

  function distancePct(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Infinity;
    return Math.abs(a - b) / Math.abs(b);
  }

  function decideSignal(tfAnalyses, zones, currentPrice, mode) {
    const cfg = MODES[mode];
    const weightedBias = tfAnalyses.reduce((sum, t) => sum + t.bias * (t.weight / 100), 0);
    const score = Math.round(Math.abs(weightedBias));
    const direction = weightedBias > 0 ? "LONG" : weightedBias < 0 ? "SHORT" : "WAIT";
    const reasons = [];

    const majorA = tfAnalyses[0];
    const majorB = tfAnalyses[1];
    const trigger = tfAnalyses.at(-1);

    const support = zones.supports[0];
    const resistance = zones.resistances[0];

    const nearSupport = support ? distancePct(currentPrice, support.center) <= (mode === "short" ? 0.012 : 0.035) : false;
    const nearResistance = resistance ? distancePct(currentPrice, resistance.center) <= (mode === "short" ? 0.012 : 0.035) : false;

    const majorLong = majorA.bias > 10 && majorB.bias > 10;
    const majorShort = majorA.bias < -10 && majorB.bias < -10;

    let kind = "WAIT";

    if (weightedBias >= cfg.signalThreshold && majorLong && trigger.bias > 5 && trigger.rsi14 < 72) {
      kind = nearSupport || mode === "swing" ? "LONG" : "WATCH LONG";
    } else if (weightedBias <= -cfg.signalThreshold && majorShort && trigger.bias < -5 && trigger.rsi14 > 28) {
      kind = nearResistance || mode === "swing" ? "SHORT" : "WATCH SHORT";
    } else if (weightedBias >= cfg.watchThreshold) {
      kind = "WATCH LONG";
    } else if (weightedBias <= -cfg.watchThreshold) {
      kind = "WATCH SHORT";
    }

    reasons.push(`Bias tổng hợp: ${weightedBias >= 0 ? "+" : ""}${weightedBias.toFixed(1)} / 100.`);
    reasons.push(`${majorA.label}: ${biasLabel(majorA.bias)} (${majorA.bias}).`);
    reasons.push(`${majorB.label}: ${biasLabel(majorB.bias)} (${majorB.bias}).`);
    reasons.push(`${trigger.label}: ${biasLabel(trigger.bias)} (${trigger.bias}), RSI ${trigger.rsi14.toFixed(1)}.`);

    if (support) reasons.push(`Support gần nhất: ${fmtNumber(support.low)} – ${fmtNumber(support.high)} (${support.label}).`);
    if (resistance) reasons.push(`Resistance gần nhất: ${fmtNumber(resistance.low)} – ${fmtNumber(resistance.high)} (${resistance.label}).`);

    if (kind === "WATCH LONG" && !nearSupport) reasons.push("Xu hướng thiên tăng nhưng giá chưa ở vùng support đủ gần.");
    if (kind === "WATCH SHORT" && !nearResistance) reasons.push("Xu hướng thiên giảm nhưng giá chưa ở vùng resistance đủ gần.");
    if (kind === "WAIT") reasons.push("Các khung thời gian chưa tạo đủ đồng thuận để hình thành setup.");

    return { kind, score, weightedBias, reasons, support, resistance, direction };
  }

  function buildTradePlan(signal, tfAnalyses, zones, currentPrice) {
    const longLike = signal.kind.includes("LONG");
    const shortLike = signal.kind.includes("SHORT");
    if (!longLike && !shortLike) return null;

    const atrRef = tfAnalyses.at(-1).atr14 || currentPrice * 0.01;
    let entryLow, entryHigh, sl, tp1, tp2;

    if (longLike) {
      const support = zones.supports[0];
      entryLow = support ? Math.max(support.low, currentPrice - atrRef * 0.45) : currentPrice - atrRef * 0.25;
      entryHigh = currentPrice + atrRef * 0.08;
      const entryMid = (entryLow + entryHigh) / 2;
      sl = support ? Math.min(support.low - atrRef * 0.32, entryMid - atrRef * 0.9) : entryMid - atrRef * 1.25;
      const risk = Math.max(entryMid - sl, atrRef * 0.35);
      const validRes = zones.resistances.filter(z => z.center > entryMid + risk * 1.15);
      tp1 = validRes[0]?.center || entryMid + risk * 1.5;
      tp2 = validRes[1]?.center || Math.max(entryMid + risk * 2.4, tp1 + risk * 0.7);
      return makePlan("LONG", entryLow, entryHigh, sl, tp1, tp2);
    }

    const resistance = zones.resistances[0];
    entryLow = currentPrice - atrRef * 0.08;
    entryHigh = resistance ? Math.min(resistance.high, currentPrice + atrRef * 0.45) : currentPrice + atrRef * 0.25;
    const entryMid = (entryLow + entryHigh) / 2;
    sl = resistance ? Math.max(resistance.high + atrRef * 0.32, entryMid + atrRef * 0.9) : entryMid + atrRef * 1.25;
    const risk = Math.max(sl - entryMid, atrRef * 0.35);
    const validSup = zones.supports.filter(z => z.center < entryMid - risk * 1.15);
    tp1 = validSup[0]?.center || entryMid - risk * 1.5;
    tp2 = validSup[1]?.center || Math.min(entryMid - risk * 2.4, tp1 - risk * 0.7);
    return makePlan("SHORT", entryLow, entryHigh, sl, tp1, tp2);
  }

  function makePlan(direction, entryLow, entryHigh, sl, tp1, tp2) {
    const mid = (entryLow + entryHigh) / 2;
    const risk = direction === "LONG" ? mid - sl : sl - mid;
    const reward1 = direction === "LONG" ? tp1 - mid : mid - tp1;
    const reward2 = direction === "LONG" ? tp2 - mid : mid - tp2;
    return {
      direction, entryLow, entryHigh, sl, tp1, tp2,
      rr1: risk > 0 ? reward1 / risk : NaN,
      rr2: risk > 0 ? reward2 / risk : NaN
    };
  }

  function biasLabel(bias) {
    if (bias >= 25) return "BULLISH";
    if (bias <= -25) return "BEARISH";
    return "NEUTRAL";
  }

  function signalCss(kind) {
    if (kind === "LONG") return "long";
    if (kind === "SHORT") return "short";
    if (kind.startsWith("WATCH")) return "watch";
    return "wait";
  }

  function renderAnalysis(result) {
    state.lastAnalysis = result;
    el.lastUpdated.textContent = nowLabel(result.timestamp);

    el.signalBadge.className = `signal-badge ${signalCss(result.signal.kind)}`;
    el.signalBadge.textContent = result.signal.kind;
    el.signalScore.textContent = `${result.signal.score}/100`;
    el.scoreMeter.style.width = `${Math.min(100, result.signal.score)}%`;

    const summaryMap = {
      LONG: "Xu hướng đa khung đang đồng thuận tăng và setup đã đạt điều kiện kích hoạt.",
      SHORT: "Xu hướng đa khung đang đồng thuận giảm và setup đã đạt điều kiện kích hoạt.",
      "WATCH LONG": "Thiên hướng tăng, nhưng chưa đủ điều kiện để nâng thành LONG.",
      "WATCH SHORT": "Thiên hướng giảm, nhưng chưa đủ điều kiện để nâng thành SHORT.",
      WAIT: "Chưa có sự đồng thuận đủ rõ giữa các khung thời gian."
    };
    el.signalSummary.textContent = summaryMap[result.signal.kind] || summaryMap.WAIT;

    renderPlan(result.plan);
    renderZones(el.supportZones, result.zones.supports);
    renderZones(el.resistanceZones, result.zones.resistances);
    renderTimeframes(result.timeframes);
    renderReasons(result.signal.reasons);
    saveHistory(result);
    renderHistory();
  }

  function renderPlan(plan) {
    if (!plan) {
      el.planDirection.textContent = "—";
      el.entryValue.textContent = el.slValue.textContent = el.tp1Value.textContent = el.tp2Value.textContent = "—";
      el.rrValue.textContent = "R:R —";
      return;
    }
    el.planDirection.textContent = plan.direction;
    el.entryValue.textContent = `${fmtNumber(plan.entryLow)} – ${fmtNumber(plan.entryHigh)}`;
    el.slValue.textContent = fmtNumber(plan.sl);
    el.tp1Value.textContent = fmtNumber(plan.tp1);
    el.tp2Value.textContent = fmtNumber(plan.tp2);
    el.rrValue.textContent = `R:R TP1 ≈ ${Number.isFinite(plan.rr1) ? plan.rr1.toFixed(2) : "—"} · TP2 ≈ ${Number.isFinite(plan.rr2) ? plan.rr2.toFixed(2) : "—"}`;
  }

  function renderZones(container, zones) {
    if (!zones.length) {
      container.className = "zone-list empty-state";
      container.textContent = "Không tìm thấy vùng phù hợp gần giá hiện tại.";
      return;
    }
    container.className = "zone-list";
    container.innerHTML = zones.map(z => {
      const cls = z.label === "VERY STRONG" ? "very" : z.label === "STRONG" ? "strong" : "";
      return `<div class="zone-item">
        <div>
          <div class="zone-price">${fmtNumber(z.low)} – ${fmtNumber(z.high)}</div>
          <div class="zone-meta">${z.touches} pivot trong cụm · trung tâm ${fmtNumber(z.center)}</div>
        </div>
        <div class="zone-strength ${cls}">${z.label}</div>
      </div>`;
    }).join("");
  }

  function renderTimeframes(rows) {
    el.timeframeRows.innerHTML = rows.map(t => {
      const label = biasLabel(t.bias);
      const cls = label === "BULLISH" ? "bias-bull" : label === "BEARISH" ? "bias-bear" : "bias-neutral";
      return `<tr>
        <td><strong>${t.label}</strong></td>
        <td>${t.weight}%</td>
        <td class="${cls}">${label}</td>
        <td class="${cls}">${t.bias >= 0 ? "+" : ""}${t.bias}</td>
        <td>${fmtNumber(t.rsi14)}</td>
        <td>${fmtNumber(t.ema20)}</td>
        <td>${fmtNumber(t.ema50)}</td>
        <td>${fmtNumber(t.ema200)}</td>
        <td>${fmtNumber(t.macdHistogram)}</td>
      </tr>`;
    }).join("");
  }

  function renderReasons(reasons) {
    el.reasonList.innerHTML = reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function analyzeSelected() {
    const generation = ++state.analysisGeneration;
    state.fetchController?.abort("superseded");
    const controller = new AbortController();
    state.fetchController = controller;

    const symbol = state.symbol;
    const mode = state.mode;
    const cfg = MODES[mode];

    setBusy(true);
    try {
      const datasets = await Promise.all(cfg.timeframes.map(async spec => {
        const candles = await fetchKlines(symbol, spec.interval, spec.limit, controller.signal);
        if (candles.length < 210) throw new Error(`${spec.label}: không đủ dữ liệu.`);
        return { spec, candles, analysis: analyzeTimeframe(candles, spec) };
      }));

      if (generation !== state.analysisGeneration || symbol !== state.symbol || mode !== state.mode) return;

      const currentPrice = datasets.at(-1).candles.at(-1).close;
      const timeframes = datasets.map(x => x.analysis);
      const zones = buildZones(datasets, currentPrice, mode);
      const signal = decideSignal(timeframes, zones, currentPrice, mode);
      const plan = buildTradePlan(signal, timeframes, zones, currentPrice);

      renderAnalysis({
        symbol, mode, currentPrice, timeframes, zones, signal, plan,
        timestamp: Date.now()
      });

      if (el.livePrice.textContent === "—") el.livePrice.textContent = fmtNumber(currentPrice);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      showToast(`Lỗi phân tích: ${error.message || error}`);
      el.apiStatus.textContent = "API ERROR";
    } finally {
      if (generation === state.analysisGeneration) setBusy(false);
    }
  }

  function historyKey() { return "bsw.history.v1"; }
  function getHistory() { return safeParse(localStorage.getItem(historyKey()), []); }

  function saveHistory(result) {
    const history = getHistory();
    history.unshift({
      timestamp: result.timestamp,
      symbol: result.symbol,
      mode: result.mode,
      kind: result.signal.kind,
      score: result.signal.score,
      price: result.currentPrice
    });
    localStorage.setItem(historyKey(), JSON.stringify(history.slice(0, 50)));
  }

  function renderHistory() {
    const history = getHistory();
    if (!history.length) {
      el.historyRows.innerHTML = `<tr><td colspan="6" class="empty-cell">Chưa có lịch sử.</td></tr>`;
      return;
    }
    el.historyRows.innerHTML = history.slice(0, 15).map(h => `
      <tr>
        <td>${nowLabel(h.timestamp)}</td>
        <td>${escapeHtml(h.symbol)}</td>
        <td>${h.mode === "short" ? "Ngắn hạn" : "Dài hạn"}</td>
        <td class="${signalCss(h.kind) === "long" ? "bias-bull" : signalCss(h.kind) === "short" ? "bias-bear" : "bias-neutral"}">${escapeHtml(h.kind)}</td>
        <td>${h.score}/100</td>
        <td>${fmtNumber(h.price)}</td>
      </tr>`).join("");
  }

  function disconnectWebSocket() {
    clearTimeout(state.wsTimer);
    if (state.websocket) {
      try {
        state.websocket.onclose = null;
        state.websocket.close();
      } catch {}
    }
    state.websocket = null;
  }

  function connectWebSocket() {
    disconnectWebSocket();
    const symbolAtConnect = state.symbol.toLowerCase();
    const base = WS_BASES[state.wsRetry % WS_BASES.length];
    const url = `${base}/${symbolAtConnect}@ticker`;

    el.wsDot.className = "status-dot";
    el.wsStatus.textContent = "Đang kết nối giá...";

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleWsReconnect();
      return;
    }
    state.websocket = ws;

    ws.onopen = () => {
      state.wsRetry = 0;
      el.wsDot.className = "status-dot online";
      el.wsStatus.textContent = "Realtime";
    };

    ws.onmessage = (event) => {
      if (state.symbol.toLowerCase() !== symbolAtConnect) return;
      try {
        const msg = JSON.parse(event.data);
        const price = Number(msg.c);
        const change = Number(msg.P);
        if (Number.isFinite(price)) el.livePrice.textContent = fmtNumber(price);
        if (Number.isFinite(change)) {
          el.priceChange.textContent = fmtPct(change);
          el.priceChange.style.color = change >= 0 ? "var(--green)" : "var(--red)";
        }
      } catch {}
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };

    ws.onclose = () => {
      if (state.websocket !== ws) return;
      el.wsDot.className = "status-dot offline";
      el.wsStatus.textContent = "Mất kết nối";
      scheduleWsReconnect();
    };
  }

  function scheduleWsReconnect() {
    clearTimeout(state.wsTimer);
    state.wsRetry += 1;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(state.wsRetry, 5))) + Math.floor(Math.random() * 700);
    state.wsTimer = setTimeout(connectWebSocket, delay);
  }

  function switchMode(mode) {
    if (!MODES[mode] || state.mode === mode) return;
    state.mode = mode;
    localStorage.setItem("bsw.mode", mode);
    syncModeUI();
    state.analysisGeneration++;
    state.fetchController?.abort("mode changed");
    analyzeSelected();
  }

  function switchSymbol(symbol) {
    if (!SYMBOLS.includes(symbol) || state.symbol === symbol) return;
    state.symbol = symbol;
    localStorage.setItem("bsw.symbol", symbol);
    state.analysisGeneration++;
    state.fetchController?.abort("symbol changed");
    el.livePrice.textContent = "—";
    el.priceChange.textContent = "—";
    connectWebSocket();
    analyzeSelected();
  }

  function setupEvents() {
    el.symbolSelect.addEventListener("change", e => switchSymbol(e.target.value));
    el.shortModeBtn.addEventListener("click", () => switchMode("short"));
    el.swingModeBtn.addEventListener("click", () => switchMode("swing"));
    el.analyzeBtn.addEventListener("click", analyzeSelected);
    el.clearHistoryBtn.addEventListener("click", () => {
      localStorage.removeItem(historyKey());
      renderHistory();
      showToast("Đã xóa lịch sử trên thiết bị.");
    });

    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      el.installBtn.classList.remove("hidden");
    });

    el.installBtn.addEventListener("click", async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      el.installBtn.classList.add("hidden");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && (!state.websocket || state.websocket.readyState > 1)) {
        connectWebSocket();
      }
    });

    window.addEventListener("online", () => {
      connectWebSocket();
      analyzeSelected();
    });
  }

  function setupAutoRefresh() {
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) analyzeSelected();
    }, 5 * 60 * 1000);
  }

  async function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      } catch (error) {
        console.warn("Service worker:", error);
      }
    }
  }

  function init() {
    initSymbolSelect();
    syncModeUI();
    setupEvents();
    renderHistory();
    connectWebSocket();
    setupAutoRefresh();
    registerServiceWorker();
    analyzeSelected();
  }

  init();
})();
