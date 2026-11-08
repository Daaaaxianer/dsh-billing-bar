/**
 * dsh-billing-bar — Host half.
 *
 * Publishes one read-only JSON snapshot on a loopback HTTP route so the Client
 * half can render the peak/off-peak bar and the balance chip:
 *   GET /dsh-billing-bar/status?range=today|7d|30d
 *
 * The snapshot owns three facts:
 *   - the DeepSeek time-of-day billing phase, when the next phase starts, and
 *     today's 24-hour peak/off-peak profile;
 *   - the signed-in account balance (recharge + granted wallets);
 *   - estimated spend per model and per day for the requested range, folded
 *     from this machine's session logs.
 *
 * Everything is derived from durable state: the session log is the source of
 * truth for usage, and the account service is the source of truth for money.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import zlib from 'node:zlib'
import { promisify } from 'node:util'

const ROUTE = '/dsh-billing-bar/status'
const DAY_MS = 86400000
/** Asia/Shanghai is a fixed UTC+8 offset, and the DeepSeek schedule is published in Beijing time. */
const OFFSET_MS = 8 * 3600000
/** Peak windows, in minutes from local midnight (Beijing): 09:00-12:00 and 14:00-18:00. */
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

/**
 * Chinese statutory holidays, Beijing calendar. DeepSeek bills every hour of a
 * statutory holiday at the off-peak rate. Source: 国办发明电〔2025〕7号 (2026
 * arrangement). Extend this list when the next year's notice is published.
 */
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07'
])

/**
 * Published DeepSeek list prices in CNY per 1M tokens, [off-peak, peak].
 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (2026-10).
 */
const PRICE_CLASSES = {
  flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  pro: { hit: [0.15, 0.30], miss: [4.5, 9], out: [13.5, 27] }
}

/** Model id to price class. Unknown models are reported without a cost. */
function priceClassOf(model) {
  const id = String(model ?? '').toLowerCase()
  if (!id) return null
  if (!id.includes('deepseek')) return null
  if (id.includes('pro') || id.includes('reasoner')) return 'pro'
  if (id.includes('flash')) return 'flash'
  return null
}

function beijingDate(ms) {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10)
}

function startOfBeijingDay(ms) {
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS
}

/** `peak` inside a published peak window on a working day, `offPeak` otherwise. */
function phaseAt(ms) {
  const local = new Date(ms + OFFSET_MS)
  const weekday = local.getUTCDay()
  if (weekday === 0 || weekday === 6 || HOLIDAYS.has(local.toISOString().slice(0, 10))) return 'offPeak'
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60
  return PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end) ? 'peak' : 'offPeak'
}

/**
 * The current phase's edges: when it started and when it becomes the other
 * phase. Both are found by probing the published boundary instants; a holiday
 * or a weekend simply leaves no transition inside that day.
 */
function phaseSpan(ms) {
  const todayStart = Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS
  const candidates = []
  for (let day = -1; day <= 12; day += 1) {
    for (const minutes of [0, 9 * 60, 12 * 60, 14 * 60, 18 * 60]) {
      candidates.push(todayStart + day * DAY_MS + minutes * 60000 - OFFSET_MS)
    }
  }
  candidates.sort((a, b) => a - b)
  let previous = null
  let next = null
  for (const candidate of candidates) {
    if (phaseAt(candidate) === phaseAt(candidate - 1)) continue
    if (candidate <= ms) previous = candidate
    else if (next === null) next = candidate
  }
  return {
    current: phaseAt(ms),
    since: previous,
    next: next === null ? null : { at: next, phase: phaseAt(next) }
  }
}

/** Stop cost of one assistant message, or null when the model has no published price. */
function callCost(usage, model, atMs) {
  const priceClass = priceClassOf(model)
  if (!priceClass) return null
  const price = PRICE_CLASSES[priceClass]
  const tier = phaseAt(atMs) === 'peak' ? 1 : 0
  return (
    ((usage.inputTokens ?? 0) * price.miss[tier] +
      (usage.cacheReadTokens ?? 0) * price.hit[tier] +
      (usage.outputTokens ?? 0) * price.out[tier]) /
    1000000
  )
}

// ── session log reading ─────────────────────────────────────────────────────
// DSH appends one Zstandard frame per commit, so a log is a frame sequence and
// each frame decodes on its own.

const ZSTD_MAGIC = 4247762216
const zstdDecompress = typeof zlib.zstdDecompress === 'function' ? promisify(zlib.zstdDecompress) : null

/** One complete frame boundary, or null when the tail is incomplete or invalid. */
function scanFrame(bytes, start) {
  let offset = start
  if (bytes.length - offset < 4) return null
  if (bytes.readUInt32LE(offset) !== ZSTD_MAGIC) return null
  offset += 4
  if (offset === bytes.length) return null
  const descriptor = bytes.readUInt8(offset)
  offset += 1
  if ((descriptor & 24) !== 0) return null
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 32) !== 0
  const checksum = (descriptor & 4) !== 0
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (bytes.length - offset < remainingHeaderBytes) return null
  offset += remainingHeaderBytes
  for (;;) {
    if (bytes.length - offset < 3) return null
    const blockHeader = bytes.readUIntLE(offset, 3)
    offset += 3
    const lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 3
    const blockSize = blockHeader >>> 3
    if (blockType === 3) return null
    const payloadBytes = blockType === 1 ? 1 : blockSize
    if (bytes.length - offset < payloadBytes) return null
    offset += payloadBytes
    if (lastBlock) break
  }
  if (checksum) {
    if (bytes.length - offset < 4) return null
    offset += 4
  }
  return offset
}

/** Decompress a `.jsonl.zstd` log frame by frame, keeping complete frames only. */
async function decodeLog(bytes, compressed) {
  if (!compressed) return bytes.toString('utf8')
  if (!zstdDecompress) return ''
  const chunks = []
  let offset = 0
  while (offset < bytes.length) {
    const end = scanFrame(bytes, offset)
    if (end === null) break
    try {
      chunks.push(await zstdDecompress(bytes.subarray(offset, end), { maxOutputLength: 64 * 1024 * 1024 }))
    } catch {
      break
    }
    offset = end
  }
  return Buffer.concat(chunks).toString('utf8')
}

const LOG_NAME = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/

/** The newest generation of one session's log, matching how DSH replays it. */
function pickLog(entries) {
  const candidates = []
  for (const entry of entries) {
    const match = LOG_NAME.exec(entry.name)
    if (!match) continue
    candidates.push({ name: entry.name, version: Number(match[1] ?? 0), compressed: Boolean(match[2]) })
  }
  candidates.sort((a, b) => b.version - a.version || Number(b.compressed) - Number(a.compressed))
  return candidates[0] ?? null
}

async function safeReaddir(directory, options) {
  try {
    return await readdir(directory, options)
  } catch {
    return []
  }
}

/** Half of the rolling strip window: the bar shows six hours back and six ahead. */
const WINDOW_SIDE_MS = 6 * 3600000

/**
 * The 12-hour billing strip centred on `now`: a list of contiguous segments,
 * each entirely peak or entirely off-peak. Phase only changes on the hour, so
 * walking the hour marks inside the window finds every boundary exactly.
 */
function rollingWindow(nowMs) {
  const from = nowMs - WINDOW_SIDE_MS
  const to = nowMs + WINDOW_SIDE_MS
  const segments = []
  let start = from
  let peak = phaseAt(start) === 'peak'
  for (let boundary = Math.ceil(from / 3600000) * 3600000; boundary < to; boundary += 3600000) {
    const next = phaseAt(boundary) === 'peak'
    if (next === peak) continue
    segments.push({ from: start, to: boundary, peak })
    start = boundary
    peak = next
  }
  segments.push({ from: start, to, peak })
  return { from, to, segments }
}

/**
 * Fold every committed assistant message at or after `fromMs` into per-day,
 * per-model estimate buckets. Only logs touched inside the window (plus a small
 * clock-skew buffer) can hold matching events, so older frames are never
 * decompressed.
 */
async function collectUsage(fromMs) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const root = join(home, 'sessions')
  const byDate = new Map()

  for (const project of await safeReaddir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    for (const session of await safeReaddir(join(root, project.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const directory = join(root, project.name, session.name)
      const entries = await safeReaddir(directory, { withFileTypes: true })
      const log = pickLog(entries.filter(entry => entry.isFile()))
      if (log === null) continue
      const path = join(directory, log.name)
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      if (info.mtimeMs < fromMs - 6 * 3600000) continue
      if (info.size > 256 * 1024 * 1024) continue
      let bytes
      try {
        bytes = await readFile(path)
      } catch {
        continue
      }
      const text = await decodeLog(bytes, log.compressed)
      if (!text) continue
      for (const line of text.split('\n')) {
        if (!line.includes('"assistant/message"')) continue
        let record
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        if (record?.type !== 'assistant/message') continue
        const data = record.data ?? {}
        const time = Number(data.time ?? record.time)
        if (!Number.isFinite(time) || time < fromMs) continue
        const usage = data.usage
        if (!usage) continue
        const date = beijingDate(time)
        const bucket = byDate.get(date) ?? { models: new Map(), total: 0, calls: 0, unpriced: 0 }
        bucket.calls += 1
        const model = data.message?.source?.model ?? 'unknown'
        const cost = callCost(usage, model, time)
        if (cost === null) {
          bucket.unpriced += 1
        } else {
          bucket.total += cost
          const row = bucket.models.get(model) ?? { model, cost: 0, calls: 0 }
          row.cost += cost
          row.calls += 1
          bucket.models.set(model, row)
        }
        byDate.set(date, bucket)
      }
    }
  }

  return byDate
}

/** Project the day buckets onto one range: daily series, per-model totals, and the sum. */
function summarizeRange(byDate, days, nowMs) {
  const todayStart = startOfBeijingDay(nowMs)
  const dates = []
  for (let back = days - 1; back >= 0; back -= 1) dates.push(beijingDate(todayStart - back * DAY_MS))

  const models = new Map()
  const series = []
  let total = 0
  let calls = 0
  let unpriced = 0

  for (const date of dates) {
    const bucket = byDate.get(date)
    const cost = bucket?.total ?? 0
    total += cost
    calls += bucket?.calls ?? 0
    unpriced += bucket?.unpriced ?? 0
    if (bucket) {
      for (const [model, row] of bucket.models) {
        const aggregate = models.get(model) ?? { model, cost: 0, calls: 0 }
        aggregate.cost += row.cost
        aggregate.calls += row.calls
        models.set(model, aggregate)
      }
    }
    series.push({ date, cost, calls: bucket?.calls ?? 0 })
  }

  return {
    total,
    calls,
    unpricedCalls: unpriced,
    models: [...models.values()].sort((a, b) => b.cost - a.cost),
    days: series
  }
}

/** Read recharge and granted wallet balances, plus the official platform links. */
async function readBalance(ctx) {
  const account = ctx.get('deepseekAccount')
  if (!account) return { status: 'unavailable', reason: 'no-account-service' }
  let links
  try {
    const state = await account.getState()
    links = { topUp: state?.links?.topUpUrl, usage: state?.links?.usageUrl }
  } catch {
    links = undefined
  }
  try {
    const details = await account.getBalance({
      version: '1.0.0',
      locale: 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
    })
    if (!details || details.status !== 'ready') return { status: 'unavailable', reason: 'signed-out', links }
    const wallets = details.value ?? []
    const bonusWallets = details.bonusWallets ?? []
    const pick = list => list.filter(wallet => wallet.currency === 'CNY').reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0)
    const recharge = pick(wallets)
    const bonus = pick(bonusWallets)
    return {
      status: 'ready',
      currency: 'CNY',
      recharge,
      bonus,
      total: recharge + bonus,
      links
    }
  } catch (error) {
    return { status: 'unavailable', reason: String(error?.message ?? error), links }
  }
}

// ── snapshot cache ──────────────────────────────────────────────────────────

/** Selectable ranges, in days, with the cache lifetime each one uses. */
const RANGES = {
  today: { days: 1, ttl: 30000 },
  '7d': { days: 7, ttl: 90000 },
  '30d': { days: 30, ttl: 180000 }
}
const BALANCE_TTL_MS = 120000

function createCache(ctx) {
  const usage = new Map()
  const balance = { at: 0, value: null, pending: null }

  async function cachedBalance() {
    const now = Date.now()
    if (balance.value !== null && now - balance.at < BALANCE_TTL_MS) return balance.value
    if (balance.pending !== null) return balance.pending
    balance.pending = (async () => {
      try {
        balance.value = await readBalance(ctx)
        balance.at = Date.now()
        return balance.value
      } finally {
        balance.pending = null
      }
    })()
    return balance.pending
  }

  async function cachedUsage(key) {
    const { days, ttl } = RANGES[key]
    const slot = usage.get(key) ?? { at: 0, value: null, pending: null }
    usage.set(key, slot)
    const now = Date.now()
    if (slot.value !== null && now - slot.at < ttl) return slot.value
    if (slot.pending !== null) return slot.pending
    slot.pending = (async () => {
      try {
        const from = startOfBeijingDay(now) - (days - 1) * DAY_MS
        const byDate = await collectUsage(from)
        slot.value = summarizeRange(byDate, days, Date.now())
        slot.at = Date.now()
        return slot.value
      } finally {
        slot.pending = null
      }
    })()
    return slot.pending
  }

  return async function snapshot(range) {
    const key = Object.hasOwn(RANGES, range) ? range : 'today'
    const now = Date.now()
    const [usageValue, balanceValue] = await Promise.all([cachedUsage(key), cachedBalance()])
    return {
      checkedAt: now,
      phase: { ...phaseSpan(now), date: beijingDate(now) },
      window: rollingWindow(now),
      balance: balanceValue,
      range: key,
      usage: usageValue
    }
  }
}

// ── plugin ──────────────────────────────────────────────────────────────────

/**
 * Registers the status route once the web carrier exists.
 *
 * At boot the carrier is not necessarily available when this row is applied.
 * Reading `ctx.get('webServer')` once and giving up there leaves the plugin
 * alive but routeless until someone toggles it — the "shows nothing until I
 * switch it off and on" symptom. `ctx.inject` instead applies this half as soon
 * as the service is there, and re-applies it if the carrier restarts.
 */
export function apply(ctx) {
  const snapshot = createCache(ctx)
  ctx.inject(['webServer'], hostCtx => {
    hostCtx.effect(() =>
      hostCtx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        resource: async request => {
          let body
          try {
            const range = new URL(request.url).searchParams.get('range') ?? 'today'
            body = JSON.stringify(await snapshot(range))
          } catch (error) {
            body = JSON.stringify({ error: String(error?.message ?? error) })
          }
          return new Response(body, {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store'
            }
          })
        }
      })
    )
    // Warm the snapshot so the first Client request does not wait for the scan.
    void snapshot('today').catch(() => {})
  })
}
