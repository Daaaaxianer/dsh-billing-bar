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
.dbb-inner{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,720px);display:flex;align-items:center;justify-content:flex-end;gap:8px;font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary);user-select:none}
.dbb-cell{position:relative;display:inline-flex}
.dbb-bar{display:inline-flex;align-items:center;gap:7px;height:22px;padding:0 9px 0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:default;transition:border-color .15s ease}
.dbb-bar:hover,.dbb-bar:focus-visible,.dbb-balance:hover,.dbb-balance:focus-visible{border-color:var(--dsw-alias-border-l2);outline:none}
.dbb-label{font-size:11px;color:var(--dsw-alias-label-primary);letter-spacing:.02em;white-space:nowrap}
.dbb-strip{position:relative;display:block;width:112px;height:8px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.dbb-now{position:absolute;top:-1px;bottom:-1px;width:2px;transform:translateX(-1px);background:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-bg-layer-2);border-radius:1px}
.dbb-balance{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;cursor:pointer}
.dbb-balance[data-pinned="1"]{border-color:var(--dsw-alias-border-l2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dbb-tip{position:absolute;right:0;bottom:calc(100% + 8px);z-index:40;min-width:176px;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.7;pointer-events:none;white-space:nowrap}
.dbb-tip-head{color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.dbb-tip-strong{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dbb-tip-row{display:flex;justify-content:space-between;gap:20px;color:var(--dsw-alias-label-secondary)}
.dbb-tip-row b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-tip-hint{margin-top:5px;padding-top:5px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-dot{display:inline-block;width:6px;height:6px;border-radius:999px;background:var(--dbb-accent);margin-right:6px;vertical-align:1px}
.dbb-legend{display:flex;gap:12px;margin-top:5px;padding-top:5px;border-top:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.dbb-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.dbb-pop-wrap{position:absolute;right:0;bottom:calc(100% + 6px);z-index:41;padding-bottom:6px}
.dbb-pop{width:262px;padding:10px 12px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px rgba(0,0,0,.26);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:1.6}
.dbb-pop-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dbb-pop-title{color:var(--dsw-alias-label-secondary)}
.dbb-pop-balance{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.dbb-tabs{display:flex;gap:2px;margin:8px 0 2px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.dbb-tab{flex:1;height:22px;padding:0;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dbb-tab:hover{color:var(--dsw-alias-label-primary)}
.dbb-tab[data-on="1"]{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.16)}
.dbb-pop-sep{margin:8px -12px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dbb-pop-total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:8px}
.dbb-pop-total b{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.dbb-pop-muted{color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-chart{display:flex;align-items:flex-end;gap:2px;height:34px;margin:7px 0 2px}
.dbb-cbar{flex:1;min-width:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-brand-primary);opacity:.75}
.dbb-cbar[data-zero="1"]{opacity:.18}
.dbb-models{margin-top:6px;display:flex;flex-direction:column;gap:2px;max-height:110px;overflow-y:auto}
.dbb-model{display:flex;justify-content:space-between;gap:14px;color:var(--dsw-alias-label-secondary)}
.dbb-model b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-pop-foot{margin-top:7px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:3px;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.dbb-pop-foot span,.dbb-recharge{display:flex;justify-content:space-between;gap:12px}
.dbb-pop-foot b,.dbb-recharge b{font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dbb-recharge{color:var(--dsw-alias-brand-primary);text-decoration:none;cursor:pointer}
.dbb-recharge:hover span{text-decoration:underline}
.dbb-recharge b{color:var(--dsw-alias-brand-primary)}
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
      const lastLoad = React.useRef(0)
      const closeTimer = React.useRef(null)
      const rangeRef = React.useRef('today')
      const seq = React.useRef(0)
      const pinnedRef = React.useRef(false)
      const balanceCell = React.useRef(null)

      const load = React.useCallback(async (nextRange) => {
        const wanted = nextRange ?? rangeRef.current
        const at = Date.now()
        if (wanted === rangeRef.current && at - lastLoad.current < 3000) return
        lastLoad.current = at
        rangeRef.current = wanted
        if (typeof fetch !== 'function') {
          setFailed(true)
          return
        }
        const ticket = ++seq.current
        setLoading(true)
        try {
          const response = await fetch(`${STATUS_URL}?range=${encodeURIComponent(wanted)}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (ticket !== seq.current) return
          setData(payload)
          setFailed(false)
        } catch {
          if (ticket === seq.current) setFailed(true)
        } finally {
          if (ticket === seq.current) setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        load('today')
        const poll = setInterval(() => load(), POLL_MS)
        const tick = setInterval(() => setNow(Date.now()), 1000)
        return () => {
          clearInterval(poll)
          clearInterval(tick)
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
        h('div', { className: 'dbb-tip-head' }, dict.phaseTitle),
        failed
          ? h('div', { className: 'dbb-tip-row' }, h('span', null, dict.unavailable))
          : data === null
            ? h('div', { className: 'dbb-tip-row' }, h('span', null, dict.loading))
            : [
                h('div', { key: 'head' },
                  h('span', { className: 'dbb-dot' }),
                  h('span', { className: 'dbb-tip-strong' }, peak ? dict.peak : dict.offPeak)),
                data.phase.next
                  ? h('div', { key: 'next', className: 'dbb-tip-row' },
                      h('span', null, `${duration(remaining)}${dict.into}${data.phase.next.phase === 'peak' ? dict.peak : dict.offPeak}`),
                      h('b', null, clock(data.phase.next.at)))
                  : null,
                h('div', { key: 'legend', className: 'dbb-legend' },
                  h('span', null, h('i', { style: { background: 'var(--dsw-alias-state-warn-primary)' } }), dict.legendPeak),
                  h('span', null, h('i', { style: { background: 'var(--dsw-alias-state-success-primary)' } }), dict.legendOff)),
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

          h('div', { className: 'dbb-pop-sep' }),

          failed
            ? h('div', { className: 'dbb-pop-muted', style: { marginTop: 8 } }, dict.unavailable)
            : usage === null
              ? h('div', { className: 'dbb-pop-muted', style: { marginTop: 8 } }, dict.loading)
              : [
                  h('div', { key: 'total', className: 'dbb-pop-total' },
                    h('span', { className: 'dbb-pop-muted' }, dict.total),
                    h('b', null, shortMoney(usage.total))),
                  h('div', { key: 'calls', className: 'dbb-pop-muted' },
                    `${usage.calls} ${dict.calls}${usage.unpricedCalls > 0 ? ` · ${usage.unpricedCalls} ${dict.unpriced}` : ''}`),
                  showChart
                    ? h('div', { key: 'chart', className: 'dbb-chart' },
                        usage.days.map(entry => h('span', {
                          key: entry.date,
                          className: 'dbb-cbar',
                          'data-zero': entry.cost > 0 ? '0' : '1',
                          title: `${entry.date} ${shortMoney(entry.cost)}`,
                          style: { height: `${Math.max(entry.cost > 0 ? 8 : 3, Math.round(entry.cost / chartMax * 100))}%` }
                        })))
                    : null,
                  usage.models.length > 0
                    ? h('div', { key: 'models', className: 'dbb-models' },
                        usage.models.map(model => h('div', { className: 'dbb-model', key: model.model },
                          h('span', null, model.model),
                          h('b', null, shortMoney(model.cost)))))
                    : h('div', { key: 'none', className: 'dbb-pop-muted', style: { marginTop: 6 } }, dict.noUsage),
                  h('div', { key: 'foot', className: 'dbb-pop-foot' },
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
          h('div', { className: 'dbb-inner', style: { '--dbb-accent': peak ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' } },
          h('div', {
            className: 'dbb-cell',
            onMouseEnter: () => openPanel('phase'),
            onMouseLeave: scheduleClose
          },
            h('div', {
              className: 'dbb-bar',
              tabIndex: 0,
              onFocus: () => openPanel('phase'),
              onBlur: scheduleClose
            },
              h('span', { className: 'dbb-label' }, phaseLabel),
              h('span', {
                className: 'dbb-strip',
                style: stops.length > 0 ? { background: `linear-gradient(to right, ${stops.join(',')})` } : undefined
              },
                day === null ? null : h('span', { className: 'dbb-now', style: { left: '50%' } }))),
            open === 'phase' ? phaseTip : null),

          h('div', {
            className: 'dbb-cell',
            ref: balanceCell,
            onMouseEnter: () => openPanel('balance'),
            onMouseLeave: scheduleClose
          },
            h('div', {
              className: 'dbb-balance',
              tabIndex: 0,
              'data-pinned': pinned ? '1' : '0',
              onClick: togglePin,
              onFocus: () => openPanel('balance'),
              onBlur: scheduleClose
            }, balanceLabel),
            open === 'balance' ? balancePanel : null
          )))
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
