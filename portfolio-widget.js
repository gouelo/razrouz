// Yoel's Stock Portfolio Widget
// Scriptable iOS Widget
// Version: 1.0

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

const CACHE_KEY = "yoel_portfolio_cache";
const CACHE_DURATION_MIN = 15; // minutes

// ─── Colors ────────────────────────────────────────────────────────────────
const COLOR = {
  bg:          new Color("#0d0d0d"),
  bgCard:      new Color("#1a1a1a"),
  title:       new Color("#ffffff"),
  label:       new Color("#aaaaaa"),
  value:       new Color("#ffffff"),
  gain:        new Color("#00d26a"),
  loss:        new Color("#ff4444"),
  neutral:     new Color("#888888"),
  ils:         new Color("#ffd700"),
  accent:      new Color("#3d8bff"),
};

// ─── Fonts ──────────────────────────────────────────────────────────────────
const FONT = {
  title:       Font.boldSystemFont(13),
  totalLabel:  Font.systemFont(10),
  totalUSD:    Font.boldSystemFont(26),
  totalILS:    Font.boldSystemFont(14),
  stockName:   Font.boldSystemFont(10),
  stockVal:    Font.systemFont(9),
  pct:         Font.boldSystemFont(10),
  timestamp:   Font.systemFont(8),
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtCurrency(n, symbol = "$") {
  if (n >= 1_000_000) return `${symbol}${fmt(n / 1_000_000, 2)}M`;
  if (n >= 1_000)     return `${symbol}${fmt(n / 1_000, 2)}K`;
  return `${symbol}${fmt(n, 2)}`;
}

function pctColor(pct) {
  if (pct > 0)  return COLOR.gain;
  if (pct < 0)  return COLOR.loss;
  return COLOR.neutral;
}

function pctStr(pct) {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${fmt(pct, 2)}%`;
}

// ─── Cache ──────────────────────────────────────────────────────────────────
function loadCache() {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    const raw = fm.readString(path);
    const obj = JSON.parse(raw);
    const age = (Date.now() - obj.timestamp) / 60000;
    if (age > CACHE_DURATION_MIN) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function saveCache(data) {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    fm.writeString(path, JSON.stringify({ ...data, timestamp: Date.now() }));
  } catch (e) {}
}

function loadStaleCache() {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.temporaryDirectory(), `${CACHE_KEY}.json`);
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return null;
  }
}

// ─── Data Fetching ──────────────────────────────────────────────────────────
async function fetchQuotes(tickers) {
  const symbols = tickers.join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName`;

  const req = new Request(url);
  req.headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
  };
  req.timeoutInterval = 10;

  const json = await req.loadJSON();
  const results = json?.quoteResponse?.result ?? [];

  const map = {};
  for (const r of results) {
    map[r.symbol] = {
      price: r.regularMarketPrice ?? 0,
      pct:   r.regularMarketChangePercent ?? 0,
      prev:  r.regularMarketPreviousClose ?? 0,
      name:  r.shortName ?? r.symbol,
    };
  }
  return map;
}

async function fetchExchangeRate() {
  // Try ILS=X first, fallback to USDILS=X
  for (const ticker of ["ILS=X", "USDILS=X"]) {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
      const req = new Request(url);
      req.headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json" };
      req.timeoutInterval = 8;
      const json = await req.loadJSON();
      const results = json?.quoteResponse?.result ?? [];
      if (results.length > 0 && results[0].regularMarketPrice) {
        return results[0].regularMarketPrice;
      }
    } catch (e) {}
  }
  return null;
}

// ─── Main Data Loader ───────────────────────────────────────────────────────
async function loadData() {
  const cached = loadCache();
  if (cached) return { ...cached, fromCache: true };

  let quotes = {};
  let ilsRate = null;
  let fetchError = false;

  const allTickers = Object.keys(PORTFOLIO);

  try {
    quotes = await fetchQuotes(allTickers);
  } catch (e) {
    fetchError = true;
  }

  try {
    ilsRate = await fetchExchangeRate();
  } catch (e) {}

  if (fetchError && Object.keys(quotes).length === 0) {
    const stale = loadStaleCache();
    if (stale) return { ...stale, fromCache: true, stale: true };
    return null;
  }

  const data = { quotes, ilsRate, fetchError };
  saveCache(data);
  return { ...data, fromCache: false };
}

// ─── Compute Portfolio Stats ─────────────────────────────────────────────────
function computeStats(quotes) {
  let totalUSD = 0;
  let totalPrevUSD = 0;
  const stocks = [];

  for (const [ticker, qty] of Object.entries(PORTFOLIO)) {
    const q = quotes[ticker];
    if (!q) continue;

    const value    = q.price * qty;
    const prevVal  = q.prev  * qty;
    totalUSD      += value;
    totalPrevUSD  += prevVal;

    stocks.push({ ticker, qty, price: q.price, pct: q.pct, value, prevVal, name: q.name });
  }

  const dayChangePct = totalPrevUSD > 0
    ? ((totalUSD - totalPrevUSD) / totalPrevUSD) * 100
    : 0;

  // Sort by absolute % change for top movers
  const sorted = [...stocks].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const topGainers = stocks.filter(s => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const topLosers  = stocks.filter(s => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 3);

  return { totalUSD, dayChangePct, topGainers, topLosers };
}

// ─── Widget Builder ──────────────────────────────────────────────────────────
function buildWidget(data, isPreview = false) {
  const w = new ListWidget();
  w.backgroundColor = COLOR.bg;
  w.setPadding(12, 14, 10, 14);
  w.url = "stocks://";

  if (!data) {
    // Error state
    const errStack = w.addStack();
    errStack.layoutVertically();
    errStack.centerAlignContent();

    const t1 = errStack.addText("תיק מניות 📊");
    t1.textColor = COLOR.title;
    t1.font = FONT.title;

    errStack.addSpacer(8);

    const t2 = errStack.addText("⚠️ שגיאה בטעינת נתונים");
    t2.textColor = COLOR.loss;
    t2.font = FONT.totalLabel;

    return w;
  }

  const { quotes, ilsRate, fromCache, stale } = data;
  const { totalUSD, dayChangePct, topGainers, topLosers } = computeStats(quotes);
  const totalILS = ilsRate ? totalUSD * ilsRate : null;

  // ── Header row ─────────────────────────────────────────────────────────
  const headerRow = w.addStack();
  headerRow.layoutHorizontally();
  headerRow.centerAlignContent();

  const titleText = headerRow.addText("תיק מניות 📊");
  titleText.textColor = COLOR.title;
  titleText.font = FONT.title;

  headerRow.addSpacer();

  // Day change badge
  const badgeStack = headerRow.addStack();
  badgeStack.layoutHorizontally();
  badgeStack.cornerRadius = 6;
  badgeStack.backgroundColor = dayChangePct >= 0
    ? new Color("#00d26a22")
    : new Color("#ff444422");
  badgeStack.setPadding(2, 6, 2, 6);

  const badgeText = badgeStack.addText(pctStr(dayChangePct));
  badgeText.textColor = pctColor(dayChangePct);
  badgeText.font = Font.boldSystemFont(9);

  w.addSpacer(4);

  // ── Total USD ───────────────────────────────────────────────────────────
  const usdLabel = w.addText("שווי כולל");
  usdLabel.textColor = COLOR.label;
  usdLabel.font = FONT.totalLabel;

  const usdText = w.addText(`$${fmt(totalUSD, 2)}`);
  usdText.textColor = COLOR.value;
  usdText.font = FONT.totalUSD;
  usdText.minimumScaleFactor = 0.6;

  // ── Total ILS ───────────────────────────────────────────────────────────
  if (totalILS !== null) {
    const ilsRow = w.addStack();
    ilsRow.layoutHorizontally();
    ilsRow.centerAlignContent();

    const shekelText = ilsRow.addText(`₪${fmt(totalILS, 0)}`);
    shekelText.textColor = COLOR.ils;
    shekelText.font = FONT.totalILS;

    ilsRow.addSpacer(4);

    const rateLabel = ilsRow.addText(`(1$ = ₪${fmt(ilsRate, 3)})`);
    rateLabel.textColor = COLOR.neutral;
    rateLabel.font = Font.systemFont(8);
  }

  w.addSpacer(6);

  // ── Divider ─────────────────────────────────────────────────────────────
  const divider = w.addStack();
  divider.backgroundColor = new Color("#333333");
  divider.size = new Size(0, 1);

  w.addSpacer(6);

  // ── Top Movers ──────────────────────────────────────────────────────────
  const moversRow = w.addStack();
  moversRow.layoutHorizontally();

  // Gainers column
  const gainersCol = moversRow.addStack();
  gainersCol.layoutVertically();

  const gainHeader = gainersCol.addText("↑ עולים");
  gainHeader.textColor = COLOR.gain;
  gainHeader.font = Font.boldSystemFont(9);
  gainersCol.addSpacer(2);

  for (const s of topGainers) {
    const row = gainersCol.addStack();
    row.layoutHorizontally();

    const nameT = row.addText(s.ticker);
    nameT.textColor = COLOR.value;
    nameT.font = FONT.stockName;

    row.addSpacer(3);

    const pctT = row.addText(pctStr(s.pct));
    pctT.textColor = COLOR.gain;
    pctT.font = FONT.pct;

    gainersCol.addSpacer(1);
  }

  moversRow.addSpacer();

  // Losers column
  const losersCol = moversRow.addStack();
  losersCol.layoutVertically();

  const lossHeader = losersCol.addText("↓ יורדים");
  lossHeader.textColor = COLOR.loss;
  lossHeader.font = Font.boldSystemFont(9);
  losersCol.addSpacer(2);

  for (const s of topLosers) {
    const row = losersCol.addStack();
    row.layoutHorizontally();

    const nameT = row.addText(s.ticker);
    nameT.textColor = COLOR.value;
    nameT.font = FONT.stockName;

    row.addSpacer(3);

    const pctT = row.addText(pctStr(s.pct));
    pctT.textColor = COLOR.loss;
    pctT.font = FONT.pct;

    losersCol.addSpacer(1);
  }

  w.addSpacer();

  // ── Footer: timestamp + cache indicator ─────────────────────────────────
  const footerRow = w.addStack();
  footerRow.layoutHorizontally();

  const now = new Date();
  const timeStr = now.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const dateStr = now.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Jerusalem",
  });

  let statusIcon = "";
  if (stale)      statusIcon = " ⚠️";
  else if (fromCache) statusIcon = " 🔄";

  const tsText = footerRow.addText(`עודכן: ${dateStr} ${timeStr}${statusIcon}`);
  tsText.textColor = COLOR.neutral;
  tsText.font = FONT.timestamp;

  footerRow.addSpacer();

  const stockCount = Object.keys(quotes).length;
  const countText = footerRow.addText(`${stockCount}/${Object.keys(PORTFOLIO).length} מניות`);
  countText.textColor = COLOR.neutral;
  countText.font = FONT.timestamp;

  return w;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────
async function run() {
  const data = await loadData();
  const widget = buildWidget(data);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // Preview in app
    widget.presentMedium();
  }

  Script.complete();
}

await run();
