// Yoel's Stock Portfolio Widget
// Scriptable iOS Widget — v3.0 (Visual Redesign)
// Uses Yahoo Finance v8/chart endpoint (v7/quote blocked on Scriptable)

// ─── Portfolio Configuration ───────────────────────────────────────────────
const PORTFOLIO = {
  AI:   10,
  AMD:   6,
  AMZN:  7,
  ARKG: 29,
  COIN:  5,
  CRSP: 33,
  CRWD:  4,
  DRTS: 404,
  ICLN: 24,
  IONQ: 37,
  LAES: 355,
  LWLG: 170,
  MBLY: 27,
  NTLA: 163,
  NVDA:  6,
  PLTR: 11,
  QBTS: 24,
  QS:  105,
  RIVN: 35,
  RKLB: 27,
  SYM:  15,
  UPST: 52,
};

const CACHE_KEY      = "yoel_portfolio_v3_cache";
const CACHE_DURATION = 10; // minutes

// ─── Colors ────────────────────────────────────────────────────────────────
const C = {
  bg:       new Color("#0a0a0a"),
  white:    new Color("#ffffff"),
  gray:     new Color("#888888"),
  dimGray:  new Color("#444444"),
  gain:     new Color("#00d26a"),
  loss:     new Color("#ff4444"),
  gainBg:   new Color("#00d26a22"),
  lossBg:   new Color("#ff444422"),
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtILSFull(n) {
  // Full number with commas, no K/M abbreviation
  return "₪" + Math.round(n).toLocaleString("en-US");
}

function fmtUSD(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pctStr(pct) {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
function cacheGet() {
  try {
    const fm   = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    const obj  = JSON.parse(fm.readString(path));
    const age  = (Date.now() - obj.timestamp) / 60000;
    if (age > CACHE_DURATION) return null;
    return obj;
  } catch (e) { return null; }
}

function cacheGetStale() {
  try {
    const fm   = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (e) { return null; }
}

function cachePut(data) {
  try {
    const fm   = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    fm.writeString(path, JSON.stringify({ ...data, timestamp: Date.now() }));
  } catch (e) {}
}

// ─── Fetch single ticker via v8/chart ───────────────────────────────────────
async function fetchTicker(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=false`;
  const req = new Request(url);
  req.headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    "Accept": "application/json",
  };
  req.timeoutInterval = 12;
  const json = await req.loadJSON();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`No meta for ${symbol}`);
  return {
    symbol,
    price: meta.regularMarketPrice ?? 0,
    prev:  meta.chartPreviousClose ?? meta.previousClose ?? 0,
  };
}

// ─── Fetch all tickers in parallel ──────────────────────────────────────────
async function fetchAll() {
  const tickers    = Object.keys(PORTFOLIO);
  const allSymbols = [...tickers, "ILS=X"];

  const results = await Promise.all(
    allSymbols.map(sym =>
      fetchTicker(sym).catch(() => ({ symbol: sym, price: 0, prev: 0, error: true }))
    )
  );

  const quotes  = {};
  let   ilsRate = null;

  for (const r of results) {
    if (r.symbol === "ILS=X") {
      if (!r.error && r.price > 0) ilsRate = r.price;
    } else if (!r.error) {
      quotes[r.symbol] = { price: r.price, prev: r.prev };
    }
  }

  return { quotes, ilsRate };
}

// ─── Load Data (with cache) ──────────────────────────────────────────────────
async function loadData() {
  const cached = cacheGet();
  if (cached) return { ...cached, fromCache: true };

  let quotes  = {};
  let ilsRate = null;
  let fetchOk = false;

  try {
    const result = await fetchAll();
    quotes  = result.quotes;
    ilsRate = result.ilsRate;
    fetchOk = Object.keys(quotes).length > 0;
  } catch (e) {}

  if (!fetchOk) {
    const stale = cacheGetStale();
    if (stale) return { ...stale, fromCache: true, stale: true };
    return null;
  }

  const data = { quotes, ilsRate };
  cachePut(data);
  return { ...data, fromCache: false };
}

// ─── Compute Portfolio Stats ─────────────────────────────────────────────────
function computeStats(quotes) {
  let totalUSD     = 0;
  let totalPrevUSD = 0;
  const stocks     = [];

  for (const [ticker, qty] of Object.entries(PORTFOLIO)) {
    const q = quotes[ticker];
    if (!q || q.price === 0) continue;
    const value   = q.price * qty;
    const prevVal = q.prev  * qty;
    totalUSD     += value;
    totalPrevUSD += prevVal;
    const pct = q.prev > 0 ? ((q.price - q.prev) / q.prev) * 100 : 0;
    stocks.push({ ticker, qty, price: q.price, pct, value });
  }

  const dayChangePct = totalPrevUSD > 0
    ? ((totalUSD - totalPrevUSD) / totalPrevUSD) * 100
    : 0;

  const sorted    = [...stocks].sort((a, b) => b.pct - a.pct);
  const topGainers = sorted.filter(s => s.pct > 0).slice(0, 3);
  const topLosers  = sorted.filter(s => s.pct < 0).reverse().slice(0, 3);

  return { totalUSD, dayChangePct, topGainers, topLosers, stockCount: stocks.length };
}

// ─── Draw Gradient Background Image ─────────────────────────────────────────
// Returns an Image with a dark background + subtle colored glow in bottom-left
function drawBackground(widthPt, heightPt, isGreen) {
  const ctx  = new DrawContext();
  ctx.size   = new Size(widthPt * 2, heightPt * 2); // 2x for retina
  ctx.opaque = true;

  // Base fill: very dark
  ctx.setFillColor(C.bg);
  ctx.fillRect(new Rect(0, 0, widthPt * 2, heightPt * 2));

  // Bottom-left glow: draw several concentric ellipses with low alpha
  const glowColor = isGreen
    ? new Color("#00b450", 0.08)
    : new Color("#ff3c3c", 0.08);

  // Layered glow: 3 passes, each bigger and more transparent
  const cx = 0;
  const cy = heightPt * 2;
  const radii = [
    { rx: widthPt * 1.2, ry: heightPt * 1.2, alpha: 0.10 },
    { rx: widthPt * 0.8, ry: heightPt * 0.8, alpha: 0.12 },
    { rx: widthPt * 0.45, ry: heightPt * 0.45, alpha: 0.14 },
  ];

  for (const { rx, ry, alpha } of radii) {
    const col = isGreen ? new Color("#00b450", alpha) : new Color("#ff3c3c", alpha);
    ctx.setFillColor(col);
    // Draw ellipse anchored at bottom-left corner
    ctx.fillEllipse(new Rect(cx - rx, cy - ry, rx * 2, ry * 2));
  }

  return ctx.getImage();
}

// ─── Draw Vertical Bar Chart ──────────────────────────────────────────────────
// Returns an Image: 6 bars (top 3 gainers green + top 3 losers red), sorted by |%|
function drawBarChart(topGainers, topLosers, widthPt, heightPt) {
  const scale  = 2; // retina
  const W      = widthPt  * scale;
  const H      = heightPt * scale;

  const ctx    = new DrawContext();
  ctx.size     = new Size(W, H);
  ctx.opaque   = false; // transparent background (overlays on widget bg)

  // All bars: gainers first (green), then losers (red)
  const bars = [
    ...topGainers.map(s => ({ ticker: s.ticker, pct: s.pct,  color: new Color("#00d26a") })),
    ...topLosers.map(s  => ({ ticker: s.ticker, pct: s.pct,  color: new Color("#ff4444") })),
  ];

  if (bars.length === 0) return ctx.getImage();

  const n          = bars.length;
  const labelH     = 18 * scale;  // space for ticker name at bottom
  const pctH       = 14 * scale;  // space for % label above bar
  const barAreaH   = H - labelH - pctH - 4 * scale;
  const gapRatio   = 0.25;
  const totalGaps  = (n - 1) * gapRatio;
  const barW       = W / (n + totalGaps);
  const gap        = barW * gapRatio;

  const maxAbs     = Math.max(...bars.map(b => Math.abs(b.pct)), 0.01);

  for (let i = 0; i < bars.length; i++) {
    const b      = bars[i];
    const x      = i * (barW + gap);
    const barH   = Math.max((Math.abs(b.pct) / maxAbs) * barAreaH, 3 * scale);
    const barTop = pctH + 2 * scale + (barAreaH - barH);

    // Bar fill with rounded top corners (simulate via rect + ellipse cap)
    ctx.setFillColor(b.color);
    const r = Math.min(4 * scale, barW / 2);
    // Full bar rect
    ctx.fillRect(new Rect(x, barTop + r, barW, barH - r));
    // Top cap ellipse
    ctx.fillEllipse(new Rect(x, barTop, barW, r * 2));

    // % label above bar
    const pctLabel = (b.pct >= 0 ? "+" : "") + b.pct.toFixed(1) + "%";
    ctx.setTextColor(b.color);
    ctx.setFont(Font.boldSystemFont(9 * scale));
    const pctRect = new Rect(x - gap / 2, barTop - pctH, barW + gap, pctH);
    ctx.drawTextInRect(pctLabel, pctRect);

    // Ticker name below bar
    ctx.setTextColor(new Color("#aaaaaa"));
    ctx.setFont(Font.mediumSystemFont(8 * scale));
    const lblRect = new Rect(x - gap / 2, barTop + barH + 2 * scale, barW + gap, labelH);
    ctx.drawTextInRect(b.ticker, lblRect);
  }

  return ctx.getImage();
}

// ─── Build Widget ─────────────────────────────────────────────────────────────
function buildWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(10, 12, 8, 12);
  w.url = "stocks://";

  // ── Error state ────────────────────────────────────────────────────────────
  if (!data) {
    const bgImg = drawBackground(338, 158, false);
    w.backgroundImage = bgImg;

    const t = w.addText("📊 תיק מניות");
    t.textColor = C.white;
    t.font = Font.boldSystemFont(11);
    w.addSpacer(12);
    const e = w.addText("⚠️ שגיאה בטעינת נתונים");
    e.textColor = C.loss;
    e.font = Font.systemFont(12);
    return w;
  }

  const { quotes, ilsRate, stale } = data;
  const { totalUSD, dayChangePct, topGainers, topLosers, stockCount } = computeStats(quotes);
  const totalILS  = ilsRate && ilsRate > 0 ? totalUSD * ilsRate : null;
  const isGreen   = dayChangePct >= 0;

  // ── Background: dark + glow ────────────────────────────────────────────────
  const bgImg = drawBackground(338, 158, isGreen);
  w.backgroundImage = bgImg;

  // ── Time string ────────────────────────────────────────────────────────────
  const now     = new Date();
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });

  // ── TOP ROW: title left, time right ────────────────────────────────────────
  const topRow = w.addStack();
  topRow.layoutHorizontally();
  topRow.centerAlignContent();

  const titleT = topRow.addText("📊 תיק מניות");
  titleT.textColor = C.gray;
  titleT.font = Font.mediumSystemFont(10);

  topRow.addSpacer();

  const timeT = topRow.addText(timeStr);
  timeT.textColor = C.dimGray;
  timeT.font = Font.systemFont(10);

  w.addSpacer(4);

  // ── HERO: ILS total, very large ────────────────────────────────────────────
  const heroStr  = totalILS !== null ? fmtILSFull(totalILS) : "₪---";
  const heroText = w.addText(heroStr);
  heroText.textColor = C.white;
  heroText.font = Font.boldSystemFont(38);
  heroText.minimumScaleFactor = 0.4;
  heroText.lineLimit = 1;

  w.addSpacer(3);

  // ── SECOND ROW: USD left + day-change pill right ───────────────────────────
  const secondRow = w.addStack();
  secondRow.layoutHorizontally();
  secondRow.centerAlignContent();

  const usdText = secondRow.addText(fmtUSD(totalUSD));
  usdText.textColor = C.gray;
  usdText.font = Font.mediumSystemFont(13);
  usdText.minimumScaleFactor = 0.7;

  secondRow.addSpacer(10);

  // Pill badge
  const arrow    = isGreen ? "↑" : "↓";
  const badgeStr = `${pctStr(dayChangePct)} ${arrow} היום`;
  const badgeCol = isGreen ? C.gain : C.loss;
  const badgeBg  = isGreen ? C.gainBg : C.lossBg;

  const pill = secondRow.addStack();
  pill.layoutHorizontally();
  pill.cornerRadius = 10;
  pill.backgroundColor = badgeBg;
  pill.setPadding(3, 9, 3, 9);
  pill.centerAlignContent();

  const pillText = pill.addText(badgeStr);
  pillText.textColor = badgeCol;
  pillText.font = Font.boldSystemFont(14);
  pillText.minimumScaleFactor = 0.6;

  secondRow.addSpacer();

  w.addSpacer(6);

  // ── CHART: vertical bars, top 3 gainers + top 3 losers ────────────────────
  const chartH  = 50;
  const chartW  = 314; // widget inner width (338 - 12 - 12 padding)
  const chartImg = drawBarChart(topGainers, topLosers, chartW, chartH);

  const chartStack = w.addStack();
  chartStack.layoutHorizontally();
  const chartView = chartStack.addImage(chartImg);
  chartView.imageSize = new Size(chartW, chartH);
  chartView.resizable = false;
  chartStack.addSpacer();

  w.addSpacer();

  // ── FOOTER: "עודכן HH:MM" left, "22/22" right ─────────────────────────────
  const footer = w.addStack();
  footer.layoutHorizontally();

  const updLabel = stale ? `עודכן ${timeStr} ⚠️` : `עודכן ${timeStr}`;
  const footerLeft = footer.addText(updLabel);
  footerLeft.textColor = C.dimGray;
  footerLeft.font = Font.systemFont(9);

  footer.addSpacer();

  const countText = footer.addText(`${stockCount}/${Object.keys(PORTFOLIO).length}`);
  countText.textColor = C.dimGray;
  countText.font = Font.systemFont(9);

  return w;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────
async function run() {
  const data   = await loadData();
  const widget = buildWidget(data);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    widget.presentMedium();
  }

  Script.complete();
}

await run();
