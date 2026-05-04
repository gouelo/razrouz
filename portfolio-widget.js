// Yoel's Stock Portfolio Widget
// Scriptable iOS Widget — v2.0
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

const CACHE_KEY      = "yoel_portfolio_v2_cache";
const CACHE_DURATION = 10; // minutes

// ─── Colors ────────────────────────────────────────────────────────────────
const COLOR = {
  bg:      new Color("#111111"),
  title:   new Color("#ffffff"),
  hero:    new Color("#ffffff"),
  usd:     new Color("#888888"),
  gain:    new Color("#00e676"),
  loss:    new Color("#ff4444"),
  neutral: new Color("#888888"),
  footer:  new Color("#555555"),
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtILS(n) {
  if (n >= 1_000_000) return `₪${fmt(n / 1_000_000, 2)}M`;
  if (n >= 1_000)     return `₪${fmt(n / 1_000, 1)}K`;
  return `₪${fmt(n, 0)}`;
}

function fmtUSD(n) {
  if (n >= 1_000_000) return `$${fmt(n / 1_000_000, 2)}M`;
  if (n >= 1_000)     return `$${fmt(n / 1_000, 1)}K`;
  return `$${fmt(n, 0)}`;
}

function pctStr(pct) {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${fmt(pct, 2)}%`;
}

function pctColor(pct) {
  if (pct > 0) return COLOR.gain;
  if (pct < 0) return COLOR.loss;
  return COLOR.neutral;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
function cacheGet() {
  try {
    const fm   = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    const obj = JSON.parse(fm.readString(path));
    const ageMin = (Date.now() - obj.timestamp) / 60000;
    if (ageMin > CACHE_DURATION) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function cacheGetStale() {
  try {
    const fm   = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return null;
  }
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
    price: meta.regularMarketPrice  ?? 0,
    prev:  meta.chartPreviousClose  ?? meta.previousClose ?? 0,
  };
}

// ─── Fetch all tickers in parallel ──────────────────────────────────────────
async function fetchAll() {
  const tickers = Object.keys(PORTFOLIO);
  // Include ILS=X for exchange rate
  const allSymbols = [...tickers, "ILS=X"];

  const results = await Promise.all(
    allSymbols.map(sym =>
      fetchTicker(sym).catch(e => ({ symbol: sym, price: 0, prev: 0, error: true }))
    )
  );

  const quotes  = {};
  let   ilsRate = null;

  for (const r of results) {
    if (r.symbol === "ILS=X") {
      if (!r.error && r.price > 0) ilsRate = r.price;
    } else {
      if (!r.error) {
        quotes[r.symbol] = { price: r.price, prev: r.prev };
      }
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
    stocks.push({ ticker, qty, price: q.price, pct, value, prevVal });
  }

  const dayChangePct = totalPrevUSD > 0
    ? ((totalUSD - totalPrevUSD) / totalPrevUSD) * 100
    : 0;

  const topGainers = stocks
    .filter(s => s.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  const topLosers = stocks
    .filter(s => s.pct < 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  return { totalUSD, dayChangePct, topGainers, topLosers, stockCount: stocks.length };
}

// ─── Widget Builder ──────────────────────────────────────────────────────────
function buildWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLOR.bg;
  w.setPadding(12, 14, 10, 14);
  w.url = "stocks://";

  // ── Error state ─────────────────────────────────────────────────────────
  if (!data) {
    const col = w.addStack();
    col.layoutVertically();
    col.centerAlignContent();

    const t = col.addText("תיק מניות 📊");
    t.textColor = COLOR.title;
    t.font = Font.boldSystemFont(12);

    col.addSpacer(8);

    const e = col.addText("⚠️ שגיאה בטעינת נתונים");
    e.textColor = COLOR.loss;
    e.font = Font.systemFont(11);

    return w;
  }

  const { quotes, ilsRate, fromCache, stale } = data;
  const { totalUSD, dayChangePct, topGainers, topLosers, stockCount } = computeStats(quotes);
  const totalILS = ilsRate && ilsRate > 0 ? totalUSD * ilsRate : null;

  // ── Header row: title left, date/time right ─────────────────────────────
  const now     = new Date();
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const dateStr = now.toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit",
    timeZone: "Asia/Jerusalem",
  });

  const header = w.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();

  const titleT = header.addText("תיק מניות 📊");
  titleT.textColor = COLOR.title;
  titleT.font = Font.systemFont(10);

  header.addSpacer();

  const dateT = header.addText(`${dateStr}  ${timeStr}`);
  dateT.textColor = COLOR.neutral;
  dateT.font = Font.systemFont(9);

  w.addSpacer(6);

  // ── Hero: ILS amount ─────────────────────────────────────────────────────
  const heroILS = totalILS !== null ? fmtILS(totalILS) : "₪---";
  const heroText = w.addText(heroILS);
  heroText.textColor = COLOR.hero;
  heroText.font = Font.boldSystemFont(32);
  heroText.minimumScaleFactor = 0.5;

  w.addSpacer(2);

  // ── USD amount (smaller, gray) ────────────────────────────────────────────
  const usdText = w.addText(fmtUSD(totalUSD));
  usdText.textColor = COLOR.usd;
  usdText.font = Font.systemFont(13);
  usdText.minimumScaleFactor = 0.7;

  w.addSpacer(4);

  // ── Day change badge ─────────────────────────────────────────────────────
  const arrow     = dayChangePct >= 0 ? "↑" : "↓";
  const badgeStr  = `${pctStr(dayChangePct)} היום ${arrow}`;
  const badgeCol  = pctColor(dayChangePct);

  const badgeRow = w.addStack();
  badgeRow.layoutHorizontally();

  const badge = badgeRow.addStack();
  badge.layoutHorizontally();
  badge.cornerRadius = 8;
  badge.backgroundColor = dayChangePct >= 0
    ? new Color("#00e67620")
    : new Color("#ff444420");
  badge.setPadding(3, 8, 3, 8);
  badge.centerAlignContent();

  const badgeText = badge.addText(badgeStr);
  badgeText.textColor = badgeCol;
  badgeText.font = Font.boldSystemFont(18);
  badgeText.minimumScaleFactor = 0.5;

  badgeRow.addSpacer();

  w.addSpacer(6);

  // ── Top movers row ───────────────────────────────────────────────────────
  const moversRow = w.addStack();
  moversRow.layoutHorizontally();

  // Gainers (left)
  const gainCol = moversRow.addStack();
  gainCol.layoutVertically();

  for (const s of topGainers) {
    const row  = gainCol.addStack();
    row.layoutHorizontally();
    row.spacing = 4;

    const nt = row.addText(s.ticker);
    nt.textColor = COLOR.hero;
    nt.font = Font.boldSystemFont(9);

    const pt = row.addText(pctStr(s.pct));
    pt.textColor = COLOR.gain;
    pt.font = Font.systemFont(9);

    gainCol.addSpacer(2);
  }

  moversRow.addSpacer();

  // Losers (right)
  const lossCol = moversRow.addStack();
  lossCol.layoutVertically();

  for (const s of topLosers) {
    const row = lossCol.addStack();
    row.layoutHorizontally();
    row.spacing = 4;

    const nt = row.addText(s.ticker);
    nt.textColor = COLOR.hero;
    nt.font = Font.boldSystemFont(9);

    const pt = row.addText(pctStr(s.pct));
    pt.textColor = COLOR.loss;
    pt.font = Font.systemFont(9);

    lossCol.addSpacer(2);
  }

  w.addSpacer();

  // ── Footer: "עודכן HH:MM" ────────────────────────────────────────────────
  const footer = w.addStack();
  footer.layoutHorizontally();

  let footerStr = `עודכן ${timeStr}`;
  if (stale) footerStr += " ⚠️";

  const footerText = footer.addText(footerStr);
  footerText.textColor = COLOR.footer;
  footerText.font = Font.systemFont(8);

  footer.addSpacer();

  const countText = footer.addText(`${stockCount}/${Object.keys(PORTFOLIO).length}`);
  countText.textColor = COLOR.footer;
  countText.font = Font.systemFont(8);

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
