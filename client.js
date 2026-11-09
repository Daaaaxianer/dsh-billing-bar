/**
 * dsh-billing-bar — Client half.
 *
 * One compact row at the top-right of the composer card:
 *   - a 24-hour billing strip: every hour of today painted peak or off-peak,
 *     with a marker at the current time, so the day's shape reads at a glance;
 *   - the account balance beside it.
 *
 * Hovering the strip shows the time left in the current phase. Hovering the
 * balance opens a panel with today / 7-day / 30-day spend per model and per day.
 *
 * Layout constants mirror the shipped dock entries so the row lines up with the
 * composer card: `--dsh-composer-card-max-width` and the dock insets come from
 * the host's own composer CSS.
 */
window.__ModuleLoader__.load({
  id: 'dsh-billing-bar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STATUS_URL = '/dsh-billing-bar/status'
    const POLL_MS = 60000

    const RANGES = [
      { id: 'today', zh: '今日', en: 'Today' },
      { id: '7d', zh: '近7日', en: '7 days' },
      { id: '30d', zh: '近30日', en: '30 days' }
    ]

    const DICT = {
      zh: {
        peak: '峰价',
        offPeak: '谷价',
        balance: '余额',
        phaseTitle: '计费阶段',
        windowHint: '工作日 09:00–12:00、14:00–18:00 为峰价',
        into: '后进入',
        total: '总花费',
        calls: '次调用',
        noUsage: '该时段没有调用',
        unpriced: '次调用未定价',
        recharge: '充值余额',
        bonus: '赠送余额',
        topUpHint: '前往 DeepSeek 官方充值页面',
        unavailable: '计费服务未连接',
        noBalance: '未登录或余额不可用',
        loading: '正在读取…',
        legendPeak: '峰价',
        legendOff: '谷价'
      },
      en: {
        peak: 'Peak',
        offPeak: 'Off-peak',
        balance: 'Balance',
        phaseTitle: 'Billing phase',
        windowHint: 'Peak: weekdays 09:00–12:00 and 14:00–18:00',
        into: 'until',
        total: 'Total',
        calls: 'calls',
        noUsage: 'No calls in this period',
        unpriced: 'unpriced calls',
        recharge: 'Recharged',
        bonus: 'Granted',
        topUpHint: 'Open the DeepSeek top-up page',
        unavailable: 'Billing service unreachable',
        noBalance: 'Signed out or balance unavailable',
        loading: 'Loading…',
        legendPeak: 'Peak',
        legendOff: 'Off-peak'
      }
    }

    const CSS = `
.dbb-row{box-sizing:border-box;width:100%;padding:0 calc(var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px));display:flex;justify-content:center}
.dbb-inner{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,720px);display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:11px;line-height:1;user-select:none}
.dbb-cap{position:relative;display:inline-flex;align-items:center;height:24px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);box-shadow:0 1px 1px rgba(0,0,0,.08)}
.dbb-seg{display:inline-flex;align-items:center;gap:9px;height:100%;padding:0 11px;border-radius:999px;cursor:default;transition:background-color .14s ease}
.dbb-seg:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dbb-seg:hover,.dbb-seg:focus-visible{background:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}
.dbb-sep{width:1px;height:12px;flex:none;background:var(--dsw-alias-border-l1)}
.dbb-label{font-size:11px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dbb-tapewrap{position:relative;display:block;width:120px;height:8px}
.dbb-tape{position:absolute;inset:0;border-radius:4px;overflow:hidden;background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.dbb-needle{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;transform:translateX(-1px);border-radius:1px;background:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-bg-layer-2)}
.dbb-amount{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;letter-spacing:.01em;white-space:nowrap}
.dbb-seg-bal{padding:0 12px}
.dbb-seg-bal[data-pinned="1"]{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent)}
.dbb-tip{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;min-width:200px;padding:11px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 34px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.6;pointer-events:none;white-space:nowrap;animation:dbb-rise .13s ease-out}
.dbb-tip-head{display:flex;align-items:center;gap:7px}
.dbb-swatch{display:inline-block;width:7px;height:7px;border-radius:2px;flex:none}
.dbb-tip-strong{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dbb-tip-row{display:flex;justify-content:space-between;gap:18px;margin-top:4px;color:var(--dsw-alias-label-secondary)}
.dbb-tip-row b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-hair{margin:8px -12px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dbb-legend{display:flex;gap:14px;margin-top:8px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.dbb-legend span{display:inline-flex;align-items:center;gap:5px}
.dbb-tip-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-pop-wrap{position:absolute;right:0;bottom:calc(100% + 7px);z-index:41;padding-bottom:7px}
.dbb-pop{width:268px;padding:12px 13px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 38px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.5;animation:dbb-rise .13s ease-out}
.dbb-pop-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.dbb-pop-title{font-size:10.5px;color:var(--dsw-alias-label-secondary);padding-bottom:2px}
.dbb-pop-balance{font-size:17px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.dbb-tabs{display:flex;gap:2px;margin-top:10px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dbb-tab{flex:1;height:23px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;transition:color .12s ease}
.dbb-tab:hover{color:var(--dsw-alias-label-primary)}
.dbb-tab[data-on="1"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.14)}
.dbb-sep-h{margin:11px -13px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dbb-total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:10px}
.dbb-total b{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.dbb-sub{color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-chart{display:flex;align-items:flex-end;gap:2px;height:36px;margin-top:10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dbb-cbar{flex:1;min-width:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary);opacity:.62;transition:height .18s ease, opacity .12s ease}
.dbb-cbar[data-zero="1"]{opacity:.16}
.dbb-cbar[data-today="1"]{opacity:1}
.dbb-models{margin-top:10px;display:flex;flex-direction:column;gap:3px;max-height:112px;overflow-y:auto}
.dbb-model{display:flex;justify-content:space-between;gap:14px;color:var(--dsw-alias-label-secondary)}
.dbb-model b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-foot{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-foot > span,.dbb-recharge{display:flex;justify-content:space-between;gap:12px}
.dbb-foot b,.dbb-recharge b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-recharge{color:var(--dsw-alias-brand-primary);text-decoration:none;cursor:pointer}
.dbb-recharge:hover span{text-decoration:underline}
.dbb-recharge b{color:var(--dsw-alias-brand-primary)}
@keyframes dbb-rise{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.dbb-tip,.dbb-pop{animation:none}.dbb-cbar{transition:none}}
`

    const money = value => (Number.isFinite(value) ? `¥${value.toFixed(2)}` : '—')
    const shortMoney = value => {
      if (!Number.isFinite(value)) return '—'
      if (value === 0) return '¥0'
      if (value < 0.01) return `¥${value.toFixed(4)}`
      return `¥${value.toFixed(2)}`
    }
    const clock = ms => {
      const at = new Date(ms)
      return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    }
    const duration = ms => {
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours > 0) return `${hours} 小时 ${minutes} 分`
      if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
      return `${seconds} 秒`
    }

    function row(label, value, key) {
      return h('div', { className: 'dbb-tip-row', key }, h('span', null, label), h('b', null, value))
    }

    function BillingBar({ ctx }) {
      const dictIndex = String(ctx.get('locale')?.getLocale?.()?.id ?? 'zh-CN').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      const dict = DICT[dictIndex]

      const [data, setData] = React.useState(null)
      const [range, setRange] = React.useState('today')
      const [failed, setFailed] = React.useState(false)
      const [now, setNow] = React.useState(() => Date.now())
      const [open, setOpen] = React.useState(null)
      const [pinned, setPinned] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const closeTimer = React.useRef(null)
      const rangeRef = React.useRef('today')
      const seq = React.useRef(0)
      const inFlight = React.useRef(false)
      const pinnedRef = React.useRef(false)
      const balanceCell = React.useRef(null)

      /** One snapshot attempt. Resolves true when the Host answered with data. */
      const load = React.useCallback(async nextRange => {
        if (inFlight.current) return true
        const wanted = nextRange ?? rangeRef.current
        rangeRef.current = wanted
        if (typeof fetch !== 'function') {
          setFailed(true)
          return false
        }
        const ticket = ++seq.current
        inFlight.current = true
        setLoading(true)
        try {
          const response = await fetch(`${STATUS_URL}?range=${encodeURIComponent(wanted)}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (payload !== null && typeof payload === 'object' && payload.error) throw new Error(String(payload.error))
          if (ticket === seq.current) {
            setData(payload)
            setFailed(false)
          }
          return true
        } catch {
          if (ticket === seq.current) setFailed(true)
          return false
        } finally {
          inFlight.current = false
          if (ticket === seq.current) setLoading(false)
        }
      }, [])

      // Poll on a self-scheduling timer: 60 s once the Host answers, and a short
      // 1-2-4-8-15 s backoff while it does not, so a page that loads before the
      // Host route exists fills in within seconds instead of a full minute.
      React.useEffect(() => {
        let alive = true
        let timer = null
        let backoff = 1000
        const step = async () => {
          if (!alive) return
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
          const ok = await load()
          if (!alive) return
          backoff = ok ? 1000 : Math.min(backoff * 2, 15000)
          timer = setTimeout(step, ok ? POLL_MS : backoff)
        }
        void step()
        const tick = setInterval(() => setNow(Date.now()), 1000)
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return
          backoff = 1000
          void step()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          if (timer !== null) clearTimeout(timer)
          clearInterval(tick)
          document.removeEventListener('visibilitychange', onVisible)
          if (closeTimer.current !== null) clearTimeout(closeTimer.current)
        }
      }, [load])

      const nextAt = data?.phase?.next?.at ?? null
      React.useEffect(() => {
        if (nextAt !== null && now >= nextAt) load()
      }, [now, nextAt, load])

      const scheduleClose = () => {
        if (pinnedRef.current) return
        if (closeTimer.current !== null) clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => {
          if (pinnedRef.current) return
          setOpen(null)
        }, 220)
      }
      const cancelClose = () => {
        if (closeTimer.current !== null) clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      const openPanel = which => {
        cancelClose()
        setOpen(which)
        if (which === 'balance') load()
      }
      const pinBalance = () => {
        pinnedRef.current = true
        setPinned(true)
        cancelClose()
        setOpen('balance')
        load()
      }
      const unpinBalance = () => {
        pinnedRef.current = false
        setPinned(false)
        setOpen(null)
      }
      const togglePin = () => {
        if (pinnedRef.current) unpinBalance()
        else pinBalance()
      }
      const pickRange = id => {
        if (id === range) return
        setRange(id)
        load(id)
      }

      // A pinned panel survives mouse movement; it closes only on an outside
      // press, Escape, or a second press on the balance chip.
      React.useEffect(() => {
        if (!pinned) return undefined
        const onPointerDown = event => {
          if (balanceCell.current !== null && balanceCell.current.contains(event.target)) return
          pinnedRef.current = false
          setPinned(false)
          setOpen(null)
        }
        const onKeyDown = event => {
          if (event.key !== 'Escape') return
          pinnedRef.current = false
          setPinned(false)
          setOpen(null)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [pinned])

      const peak = data?.phase?.current === 'peak'
      const remaining = nextAt === null ? null : Math.max(0, nextAt - now)

      const day = data?.window ?? null
      const stops = []
      if (day) {
        const span = day.to - day.from
        for (const segment of day.segments) {
          const color = segment.peak ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)'
          const from = ((segment.from - day.from) / span * 100).toFixed(4)
          const to = ((segment.to - day.from) / span * 100).toFixed(4)
          stops.push(`${color} ${from}%`, `${color} ${to}%`)
        }
      }

      const balance = data?.balance ?? null
      const balanceReady = balance?.status === 'ready'
      const usage = data?.usage ?? null
      const phaseLabel = failed ? '—' : data === null ? '…' : peak ? dict.peak : dict.offPeak
      const balanceLabel = failed ? '—' : data === null ? '…' : balanceReady ? money(balance.total) : '—'

      const phaseTip = h('div', { className: 'dbb-tip', role: 'tooltip' },
        failed
          ? h('div', { className: 'dbb-tip-row' }, h('span', null, dict.unavailable))
          : data === null
            ? h('div', { className: 'dbb-tip-row' }, h('span', null, dict.loading))
            : [
                h('div', { key: 'head', className: 'dbb-tip-head' },
                  h('i', {
                    className: 'dbb-swatch',
                    style: { background: peak ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' }
                  }),
                  h('span', { className: 'dbb-tip-strong' }, peak ? dict.peak : dict.offPeak)),
                data.phase.next
                  ? h('div', { key: 'next', className: 'dbb-tip-row' },
                      h('span', null, `${duration(remaining)}${dict.into}${data.phase.next.phase === 'peak' ? dict.peak : dict.offPeak}`),
                      h('b', null, clock(data.phase.next.at)))
                  : null,
                h('div', { key: 'hair', className: 'dbb-hair' }),
                h('div', { key: 'legend', className: 'dbb-legend' },
                  h('span', null, h('i', { className: 'dbb-swatch', style: { background: 'var(--dsw-alias-state-warn-primary)' } }), dict.legendPeak),
                  h('span', null, h('i', { className: 'dbb-swatch', style: { background: 'var(--dsw-alias-state-success-primary)' } }), dict.legendOff)),
                h('div', { key: 'hint', className: 'dbb-tip-hint' }, dict.windowHint)
              ]
      )

      const chartMax = usage ? Math.max(...usage.days.map(entry => entry.cost), 0.0001) : 1
      const showChart = usage !== null && usage.days.length > 1

      const balancePanel = h('div', {
        className: 'dbb-pop-wrap',
        onMouseEnter: cancelClose,
        onMouseMove: cancelClose,
        onMouseLeave: scheduleClose,
        onFocus: cancelClose,
        onBlur: scheduleClose,
        // Any press inside the panel keeps it open, so tabs and the top-up link
        // never race a hover-leave.
        onClick: () => {
          if (!pinnedRef.current) pinBalance()
        }
      },
        h('div', { className: 'dbb-pop' },
          h('div', { className: 'dbb-pop-head' },
            h('span', { className: 'dbb-pop-title' }, dict.balance),
            h('b', { className: 'dbb-pop-balance' }, balanceReady ? money(balance.total) : '—')),

          h('div', { className: 'dbb-tabs' },
            RANGES.map(item => h('button', {
              key: item.id,
              type: 'button',
              className: 'dbb-tab',
              'data-on': item.id === range ? '1' : '0',
              onClick: () => pickRange(item.id)
            }, dictIndex === 'zh' ? item.zh : item.en))),

          h('div', { className: 'dbb-sep-h' }),

          failed
            ? h('div', { className: 'dbb-sub', style: { marginTop: 10 } }, dict.unavailable)
            : usage === null
              ? h('div', { className: 'dbb-sub', style: { marginTop: 10 } }, dict.loading)
              : [
                  h('div', { key: 'total', className: 'dbb-total' },
                    h('span', { className: 'dbb-sub' }, dict.total),
                    h('b', null, shortMoney(usage.total))),
                  h('div', { key: 'calls', className: 'dbb-sub' },
                    `${usage.calls} ${dict.calls}${usage.unpricedCalls > 0 ? ` · ${usage.unpricedCalls} ${dict.unpriced}` : ''}`),
                  showChart
                    ? h('div', { key: 'chart', className: 'dbb-chart' },
                        usage.days.map((entry, index) => h('span', {
                          key: entry.date,
                          className: 'dbb-cbar',
                          'data-zero': entry.cost > 0 ? '0' : '1',
                          'data-today': index === usage.days.length - 1 ? '1' : '0',
                          title: `${entry.date} ${shortMoney(entry.cost)}`,
                          style: { height: `${Math.max(entry.cost > 0 ? 8 : 3, Math.round(entry.cost / chartMax * 100))}%` }
                        })))
                    : null,
                  usage.models.length > 0
                    ? h('div', { key: 'models', className: 'dbb-models' },
                        usage.models.map(model => h('div', { className: 'dbb-model', key: model.model },
                          h('span', null, model.model),
                          h('b', null, shortMoney(model.cost)))))
                    : h('div', { key: 'none', className: 'dbb-sub', style: { marginTop: 8 } }, dict.noUsage),
                  h('div', { key: 'foot', className: 'dbb-foot' },
                    balanceReady && balance.links?.topUp
                      ? h('a', {
                          key: 'topup',
                          className: 'dbb-recharge',
                          href: balance.links.topUp,
                          target: '_blank',
                          rel: 'noreferrer',
                          title: dict.topUpHint
                        },
                          h('span', null, `${dict.recharge} ↗`),
                          h('b', null, money(balance.recharge)))
                      : h('span', null, dict.recharge, h('b', null, balanceReady ? money(balance.recharge) : '—')),
                    balanceReady && balance.bonus > 0
                      ? h('span', { key: 'bonus' }, dict.bonus, h('b', null, money(balance.bonus)))
                      : null)
                ]))

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', { className: 'dbb-row' },
          h('div', { className: 'dbb-inner' },
            h('div', { className: 'dbb-cap', ref: balanceCell },
              h('div', {
                className: 'dbb-seg',
                tabIndex: 0,
                onMouseEnter: () => openPanel('phase'),
                onMouseLeave: scheduleClose,
                onFocus: () => openPanel('phase'),
                onBlur: scheduleClose
              },
                h('span', { className: 'dbb-label' }, phaseLabel),
                h('span', { className: 'dbb-tapewrap' },
                  h('span', {
                    className: 'dbb-tape',
                    style: stops.length > 0 ? { background: `linear-gradient(to right, ${stops.join(',')})` } : undefined
                  }),
                  day === null ? null : h('span', { className: 'dbb-needle' }))),

              h('span', { className: 'dbb-sep' }),

              h('div', {
                className: 'dbb-seg dbb-seg-bal',
                tabIndex: 0,
                role: 'button',
                'aria-pressed': pinned ? 'true' : 'false',
                'data-pinned': pinned ? '1' : '0',
                onClick: togglePin,
                onMouseEnter: () => openPanel('balance'),
                onMouseLeave: scheduleClose,
                onFocus: () => openPanel('balance'),
                onBlur: scheduleClose
              },
                h('span', { className: 'dbb-amount' }, balanceLabel)),

              open === 'phase' ? phaseTip : null,
              open === 'balance' ? balancePanel : null)))
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const Component = props => h(BillingBar, { ...props, ctx })
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-billing-bar', order: 12 }, Component)
        )
      }
    }
  }
})
