// Yoel's Stock Portfolio Widget
// Scriptable iOS Widget — v4.0 (Apple Stocks Style)
// Medium size ~338×158pt

// ─── Portfolio Configuration ───────────────────────────────────────────────
const PORTFOLIO = {
  AI:   10, AMD:   6, AMZN:  7, ARKG: 29, COIN:  5,
  CRSP: 33, CRWD:  4, DRTS: 404, ICLN: 24, IONQ: 37,
  LAES: 355, LWLG: 170, MBLY: 27, NTLA: 163, NVDA:  6,
  PLTR: 11, QBTS: 24, QS:  105, RIVN: 35, RKLB: 27,
  SYM:  15, UPST: 52
}

const TICKERS = Object.keys(PORTFOLIO)
const CACHE_KEY = "yoel_portfolio_v4_cache"
const CACHE_DURATION_MS = 8 * 60 * 1000 // 8 minutes
const USD_ILS_RATE = 3.65 // fallback; fetched live below

// ─── Headers ──────────────────────────────────────────────────────────────
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
}

// ─── Cache Helpers ────────────────────────────────────────────────────────
function loadCache() {
  const fm = FileManager.local()
  const path = fm.joinPath(fm.cacheDirectory(), CACHE_KEY + ".json")
  if (!fm.fileExists(path)) return null
  try {
    const raw = fm.readString(path)
    const data = JSON.parse(raw)
    if (Date.now() - data.timestamp < CACHE_DURATION_MS) return data
  } catch (e) {}
  return null
}

function saveCache(data) {
  const fm = FileManager.local()
  const path = fm.joinPath(fm.cacheDirectory(), CACHE_KEY + ".json")
  try {
    fm.writeString(path, JSON.stringify({ ...data, timestamp: Date.now() }))
  } catch (e) {}
}

// ─── Fetch helpers ────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const req = new Request(url)
  req.headers = HEADERS
  req.timeoutInterval = 10
  return await req.loadJSON()
}

// ─── Current price fetch ──────────────────────────────────────────────────
async function fetchCurrentPrice(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d&includePrePost=false`
    const json = await fetchJSON(url)
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) return null
    return {
      ticker,
      price: meta.regularMarketPrice,
      prev: meta.chartPreviousClose
    }
  } catch (e) {
    return null
  }
}

// ─── Intraday sparkline fetch ─────────────────────────────────────────────
async function fetchIntraday(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d&includePrePost=false`
    const json = await fetchJSON(url)
    const result = json?.chart?.result?.[0]
    if (!result) return null
    const timestamps = result.timestamps || result.timestamp
    const closes = result.indicators?.quote?.[0]?.close
    if (!timestamps || !closes) return null
    const map = {}
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) map[timestamps[i]] = closes[i]
    }
    return { ticker, map }
  } catch (e) {
    return null
  }
}

// ─── Fetch ILS rate ───────────────────────────────────────────────────────
async function fetchILSRate() {
  try {
    const url = "https://query2.finance.yahoo.com/v8/finance/chart/ILS=X?interval=1d&range=2d&includePrePost=false"
    const json = await fetchJSON(url)
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
    return price || USD_ILS_RATE
  } catch (e) {
    return USD_ILS_RATE
  }
}

// ─── Build sparkline values ───────────────────────────────────────────────
function buildSparkline(intradayResults) {
  // Collect all timestamps across all tickers
  const tickerMaps = {}
  for (const r of intradayResults) {
    if (r) tickerMaps[r.ticker] = r.map
  }

  const allTimestamps = new Set()
  for (const map of Object.values(tickerMaps)) {
    for (const ts of Object.keys(map)) allTimestamps.add(Number(ts))
  }

  const sortedTs = Array.from(allTimestamps).sort((a, b) => a - b)
  if (sortedTs.length === 0) return []

  // At each timestamp compute portfolio value using available tickers
  const values = sortedTs.map(ts => {
    let total = 0
    let counted = 0
    for (const [ticker, qty] of Object.entries(PORTFOLIO)) {
      const map = tickerMaps[ticker]
      if (!map) continue
      const price = map[ts]
      if (price != null) {
        total += price * qty
        counted++
      }
    }
    return counted > 0 ? total : null
  })

  // Filter out leading/trailing nulls but keep internal ones
  let first = values.findIndex(v => v != null)
  let last = values.length - 1
  while (last >= 0 && values[last] == null) last--
  return first === -1 ? [] : values.slice(first, last + 1)
}

// ─── Draw sparkline ───────────────────────────────────────────────────────
function drawSparkline(values, isPositive, width, height) {
  const ctx = new DrawContext()
  ctx.size = new Size(width, height)
  ctx.opaque = false
  ctx.respectScreenScale = true

  const color = isPositive ? new Color("#00d26a") : new Color("#ff4444")
  const fillColor = isPositive ? new Color("#00d26a", 0.15) : new Color("#ff4444", 0.15)

  const valid = values.filter(v => v != null)
  if (valid.length < 2) {
    // Draw flat horizontal line
    const linePath = new Path()
    const midY = height / 2
    linePath.move(new Point(0, midY))
    linePath.addLine(new Point(width, midY))
    ctx.setStrokeColor(color)
    ctx.setLineWidth(2)
    ctx.addPath(linePath)
    ctx.strokePath()
    return ctx.getImage()
  }

  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = max - min || 1

  const pts = []
  let prevX = null
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue
    const x = (i / (values.length - 1)) * width
    const y = height - ((values[i] - min) / range) * (height - 4) - 2
    pts.push({ x, y })
    prevX = x
  }

  if (pts.length < 2) return ctx.getImage()

  // Draw fill path
  const path = new Path()
  path.move(new Point(pts[0].x, height))
  for (const p of pts) path.addLine(new Point(p.x, p.y))
  path.addLine(new Point(pts[pts.length - 1].x, height))
  path.closeSubpath()
  ctx.setFillColor(fillColor)
  ctx.addPath(path)
  ctx.fillPath()

  // Draw line
  const linePath = new Path()
  linePath.move(new Point(pts[0].x, pts[0].y))
  for (const p of pts.slice(1)) linePath.addLine(new Point(p.x, p.y))
  ctx.setStrokeColor(color)
  ctx.setLineWidth(2)
  ctx.addPath(linePath)
  ctx.strokePath()

  return ctx.getImage()
}

// ─── Format helpers ───────────────────────────────────────────────────────
function formatILS(value) {
  const abs = Math.abs(Math.round(value))
  return "₪" + abs.toLocaleString("en-US")
}

function timeString() {
  const now = new Date()
  const h = now.getHours().toString().padStart(2, "0")
  const m = now.getMinutes().toString().padStart(2, "0")
  return `${h}:${m}`
}

// ─── Build Widget ─────────────────────────────────────────────────────────
async function buildWidget() {
  // Try cache
  const cached = loadCache()
  let quotes = null
  let sparklineValues = null
  let ilsRate = USD_ILS_RATE

  if (cached) {
    quotes = cached.quotes
    sparklineValues = cached.sparklineValues
    ilsRate = cached.ilsRate || USD_ILS_RATE
  } else {
    // Parallel fetch: all current prices + all intraday + ILS rate
    const currentRequests = TICKERS.map(t => fetchCurrentPrice(t))
    const intradayRequests = TICKERS.map(t => fetchIntraday(t))
    const ilsRequest = fetchILSRate()

    const allResults = await Promise.all([
      ...currentRequests,
      ...intradayRequests,
      ilsRequest
    ])

    const currentResults = allResults.slice(0, TICKERS.length)
    const intradayResults = allResults.slice(TICKERS.length, TICKERS.length * 2)
    ilsRate = allResults[TICKERS.length * 2] || USD_ILS_RATE

    quotes = {}
    for (const r of currentResults) {
      if (r) quotes[r.ticker] = { price: r.price, prev: r.prev }
    }

    sparklineValues = buildSparkline(intradayResults)

    saveCache({ quotes, sparklineValues, ilsRate })
  }

  // ─── Compute totals ──────────────────────────────────────────────────
  let totalValueUSD = 0
  let totalPrevUSD = 0
  let validTickers = 0

  for (const [ticker, qty] of Object.entries(PORTFOLIO)) {
    const q = quotes[ticker]
    if (!q) continue
    totalValueUSD += q.price * qty
    totalPrevUSD += q.prev * qty
    validTickers++
  }

  const hasData = validTickers > 0
  const totalValueILS = totalValueUSD * ilsRate
  const totalPrevILS = totalPrevUSD * ilsRate
  const dayChangeILS = totalValueILS - totalPrevILS
  const dayChangePct = totalPrevILS !== 0 ? (dayChangeILS / totalPrevILS) * 100 : 0
  const isPositive = dayChangeILS >= 0

  // ─── Widget layout ───────────────────────────────────────────────────
  const widget = new ListWidget()
  widget.backgroundColor = new Color("#0a0a0a")
  widget.setPadding(12, 14, 8, 14)

  const grayColor = new Color("#8e8e93")
  const white = Color.white()
  const changeColor = isPositive ? new Color("#00d26a") : new Color("#ff4444")
  const now = timeString()

  // ─── Row 1: header row ───────────────────────────────────────────────
  const headerStack = widget.addStack()
  headerStack.layoutHorizontally()
  headerStack.centerAlignContent()

  const titleLabel = headerStack.addText("📊 תיק מניות")
  titleLabel.font = Font.systemFont(10)
  titleLabel.textColor = grayColor
  titleLabel.leftAlignText()

  headerStack.addSpacer()

  const timeLabel = headerStack.addText(now)
  timeLabel.font = Font.systemFont(10)
  timeLabel.textColor = grayColor
  timeLabel.rightAlignText()

  widget.addSpacer(4)

  // ─── Row 2: Portfolio value ──────────────────────────────────────────
  const valueStack = widget.addStack()
  valueStack.layoutHorizontally()

  if (!hasData) {
    const errLabel = valueStack.addText("שגיאה בטעינה")
    errLabel.font = Font.boldSystemFont(28)
    errLabel.textColor = grayColor
    widget.addSpacer()
    return widget
  }

  const rounded = Math.round(totalValueILS)
  const valueLabel = valueStack.addText("₪" + rounded.toLocaleString("en-US"))
  valueLabel.font = Font.boldSystemFont(40)
  valueLabel.textColor = white
  valueLabel.leftAlignText()
  valueStack.addSpacer()

  widget.addSpacer(2)

  // ─── Row 3: Day change ───────────────────────────────────────────────
  const changeStack = widget.addStack()
  changeStack.layoutHorizontally()

  const sign = isPositive ? "+" : "-"
  const arrow = isPositive ? "↑" : "↓"
  const absChange = Math.abs(dayChangeILS)
  const changeStr = `היום  ${sign}${Math.round(absChange).toLocaleString("en-US")} ₪  (${sign}${Math.abs(dayChangePct).toFixed(2)}%) ${arrow}`

  const changeLabel = changeStack.addText(changeStr)
  changeLabel.font = Font.mediumSystemFont(13)
  changeLabel.textColor = changeColor
  changeLabel.leftAlignText()
  changeStack.addSpacer()

  widget.addSpacer(6)

  // ─── Row 4: Sparkline ────────────────────────────────────────────────
  // We need approximate widget width minus horizontal padding = 338 - 28 = 310
  const chartWidth = 310
  const chartHeight = 50

  const chartImg = drawSparkline(sparklineValues, isPositive, chartWidth, chartHeight)

  const imgStack = widget.addStack()
  imgStack.layoutHorizontally()
  const imgWidget = imgStack.addImage(chartImg)
  imgWidget.imageSize = new Size(chartWidth, chartHeight)
  imgWidget.leftAlignImage()
  imgStack.addSpacer()

  widget.addSpacer(4)

  // ─── Footer ──────────────────────────────────────────────────────────
  const footerStack = widget.addStack()
  footerStack.layoutHorizontally()
  footerStack.centerAlignContent()

  const updatedLabel = footerStack.addText(`עודכן ${now}`)
  updatedLabel.font = Font.systemFont(8)
  updatedLabel.textColor = grayColor
  updatedLabel.leftAlignText()

  footerStack.addSpacer()

  const countLabel = footerStack.addText(`${validTickers}/${TICKERS.length}`)
  countLabel.font = Font.systemFont(8)
  countLabel.textColor = grayColor
  countLabel.rightAlignText()

  return widget
}

// ─── Entry point ──────────────────────────────────────────────────────────
const widget = await buildWidget()

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  widget.presentMedium()
}

Script.complete()
