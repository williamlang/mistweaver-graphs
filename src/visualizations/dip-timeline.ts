import type { PullAnalysis } from '../mw/analyze.js'
import { rolling, rates, WINDOW_S, METRICS, type Dip, type MetricKey, type AlignedPoint } from '../mw/dips.js'
import { darkTheme, COLORS, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

// Stacked charts share a time axis, so every y axis reserves the same width.
const STACK_THEME = { ...darkTheme, axisY: { minExtent: 72 } }

type PhaseName = { id: number; name: string; isIntermission: boolean }

const FORMAT: Record<MetricKey, string> = { rem: '.0%', kick: '.0%', cpm: '.0f' }
// Amber is reserved for the dip bands, so the kick line uses magenta.
const METRIC_COLOR: Record<MetricKey, string> = { rem: COLORS.rem, kick: '#d55181', cpm: COLORS.kill }

function phaseSpans(p: PullAnalysis, names: PhaseName[]) {
  const dur = p.durationMs / 1000
  return p.phaseTransitions.map((ph, i) => {
    const meta = names.find(n => n.id === ph.id)
    const start = ph.t / 1000
    const end = (p.phaseTransitions[i + 1]?.t ?? p.durationMs) / 1000
    return {
      start, end: Math.min(end, dur),
      name: meta?.name ?? `Phase ${ph.id}`,
      // "Stage One: The Void's Spire" → "Stage One"; fits inside short phases.
      short: meta ? meta.name.split(':')[0] : `Phase ${ph.id}`,
      band: i % 2,
      from: clock(start), to: clock(end),
    }
  })
}

// Context strip: phases, when you were moving, cooldown windows, and deaths. Sits on
// the same time axis as the metric charts below it.
export function contextStrip(p: PullAnalysis, names: PhaseName[]): Visualization {
  const dur = p.durationMs / 1000
  const runs = (pred: (i: number) => boolean, row: string) => {
    const out: Array<{ row: string; start: number; end: number; from: string; to: string }> = []
    let s: number | null = null
    p.timeline.forEach((sec, i) => {
      if (pred(i)) { if (s === null) s = sec.t }
      else if (s !== null) { out.push({ row, start: s, end: sec.t, from: clock(s), to: clock(sec.t) }); s = null }
    })
    if (s !== null) out.push({ row, start: s, end: dur, from: clock(s), to: clock(dur) })
    return out
  }
  const rowsOrder = ['Phase', 'Moving', 'Cooldowns', 'Deaths']
  const phases = phaseSpans(p, names).map(ph => ({ ...ph, row: 'Phase' }))
  const moving = runs(i => p.timeline[i].moving === true, 'Moving')
  const celestial = runs(i => p.timeline[i].celestial, 'Cooldowns')
  const deaths = p.deaths.map(d => ({ row: 'Deaths', t: d.timeMs / 1000, clock: clock(d.timeMs / 1000), name: d.name, you: d.isMonk ? 'you' : 'raid' }))
  const y = { field: 'row', type: 'nominal', title: null, sort: rowsOrder, scale: { domain: rowsOrder.filter(r => r !== 'Phase' || phases.length) } }
  const x = { type: 'quantitative', title: null, axis: clockAxis, scale: { domain: [0, dur] } }

  return {
    id: 'context-strip',
    title: 'What was happening',
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: (phases.length ? 4 : 3) * 22,
      resolve: { scale: { color: 'independent' } },
      layer: [
        {
          data: { values: phases },
          mark: { type: 'bar', height: { band: 0.8 } },
          encoding: {
            x: { field: 'start', ...x }, x2: { field: 'end' }, y,
            color: { field: 'band', type: 'nominal', scale: { domain: [0, 1], range: ['#45475a', '#313244'] }, legend: null },
            tooltip: [{ field: 'name', title: 'Phase' }, { field: 'from', title: 'From' }, { field: 'to', title: 'To' }],
          },
        },
        {
          data: { values: phases },
          mark: { type: 'text', align: 'left', dx: 4, fontSize: 10, color: COLORS.ink },
          encoding: { x: { field: 'start', type: 'quantitative' }, y, text: { field: 'short' } },
        },
        {
          data: { values: [...moving, ...celestial] },
          mark: { type: 'bar', height: { band: 0.6 } },
          encoding: {
            x: { field: 'start', ...x }, x2: { field: 'end' }, y,
            color: { field: 'row', type: 'nominal', scale: { domain: ['Moving', 'Cooldowns'], range: [COLORS.kill, '#9085e9'] }, legend: null },
            tooltip: [{ field: 'row', title: 'State' }, { field: 'from', title: 'From' }, { field: 'to', title: 'To' }],
          },
        },
        {
          data: { values: deaths },
          mark: { type: 'tick', thickness: 2, bandSize: 14 },
          encoding: {
            x: { field: 't', type: 'quantitative' }, y,
            color: { field: 'you', type: 'nominal', scale: { domain: ['you', 'raid'], range: [COLORS.critical, COLORS.inkMuted] }, legend: null },
            tooltip: [{ field: 'name', title: 'Died' }, { field: 'clock', title: 'At' }],
          },
        },
      ],
      config: STACK_THEME,
    },
  }
}

// One metric over the pull, smoothed over a rolling window, with its pull average
// dashed and the dips the finder picked shaded amber.
export function metricTimeline(p: PullAnalysis, metric: MetricKey, dips: Dip[]): Visualization {
  const dur = p.durationMs / 1000
  const base = rates(p.timeline)[metric]
  const rows = rolling(p.timeline)
    .filter(r => r[metric] !== null)
    .map(r => ({ t: r.t, clock: clock(r.t), v: r[metric] }))
  const bands = dips.filter(d => d.metric === metric).map(d => ({
    start: d.start, end: d.end, from: clock(d.start), to: clock(d.end), v: d.value, drop: d.drop,
  }))
  const isPct = metric !== 'cpm'

  return {
    id: `dip-${metric}`,
    title: `${METRICS[metric].label} (${WINDOW_S}s rolling)`,
    badge: `pull ${isPct ? `${(base * 100).toFixed(1)}%` : base.toFixed(1)}`,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 130,
      layer: [
        {
          data: { values: bands },
          mark: { type: 'rect', color: COLORS.warning, opacity: 0.18 },
          encoding: {
            x: { field: 'start', type: 'quantitative', scale: { domain: [0, dur] }, axis: clockAxis, title: null },
            x2: { field: 'end' },
            tooltip: [
              { field: 'v', type: 'quantitative', title: 'In the dip', format: FORMAT[metric] },
              { field: 'drop', type: 'quantitative', title: 'Below pull average', format: '.0%' },
              { field: 'from', title: 'From' }, { field: 'to', title: 'To' },
            ],
          },
        },
        {
          data: { values: rows },
          mark: { type: 'line', color: METRIC_COLOR[metric], strokeWidth: 2 },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            y: {
              field: 'v', type: 'quantitative', title: null,
              axis: { format: FORMAT[metric], tickCount: 4 },
              scale: isPct ? { domain: [0, 1] } : { zero: true },
            },
          },
        },
        {
          data: { values: [{ base }] },
          mark: { type: 'rule', strokeDash: [4, 4], color: COLORS.inkMuted },
          encoding: { y: { field: 'base', type: 'quantitative' } },
        },
        {
          data: { values: rows },
          params: [{ name: `hover_${metric}`, select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointermove', clear: 'pointerout' } }],
          mark: { type: 'rule', color: COLORS.inkMuted },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            opacity: { condition: { param: `hover_${metric}`, empty: false, value: 0.7 }, value: 0 },
            tooltip: [
              { field: 'v', type: 'quantitative', title: METRICS[metric].short, format: FORMAT[metric] },
              { field: 'clock', title: 'Time' },
            ],
          },
        },
      ],
      config: STACK_THEME,
    },
  }
}

// Across pulls on one boss: every pull faint, the average bold. Dips that recur at the
// same point in the fight show up in the average; one-offs wash out.
export function alignedTimeline(
  pulls: PullAnalysis[],
  avg: AlignedPoint[],
  metric: MetricKey,
  pullLabel: (p: PullAnalysis) => string,
): Visualization {
  const each = pulls.flatMap(p => rolling(p.timeline)
    .filter(r => r[metric] !== null)
    .map(r => ({ t: r.t, v: r[metric], pull: pullLabel(p) })))
  const mean = avg.filter(a => a[metric] !== null && a.pulls >= Math.min(2, pulls.length))
    .map(a => ({ t: a.t, clock: clock(a.t), v: a[metric], pulls: a.pulls }))
  const isPct = metric !== 'cpm'
  const color = METRIC_COLOR[metric]

  return {
    id: `aligned-${metric}`,
    title: `${METRICS[metric].label} by time into the pull`,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 160,
      layer: [
        {
          data: { values: each },
          mark: { type: 'line', strokeWidth: 1, opacity: 0.25, color: COLORS.inkMuted },
          encoding: {
            x: { field: 't', type: 'quantitative', title: null, axis: clockAxis },
            y: { field: 'v', type: 'quantitative', title: null, axis: { format: FORMAT[metric], tickCount: 4 }, scale: isPct ? { domain: [0, 1] } : { zero: true } },
            detail: { field: 'pull' },
          },
        },
        {
          data: { values: mean },
          mark: { type: 'line', strokeWidth: 2.5, color },
          encoding: { x: { field: 't', type: 'quantitative' }, y: { field: 'v', type: 'quantitative' } },
        },
        {
          data: { values: mean },
          params: [{ name: `ahover_${metric}`, select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointermove', clear: 'pointerout' } }],
          mark: { type: 'rule', color: COLORS.inkMuted },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            opacity: { condition: { param: `ahover_${metric}`, empty: false, value: 0.7 }, value: 0 },
            tooltip: [
              { field: 'v', type: 'quantitative', title: `Average ${METRICS[metric].short}`, format: FORMAT[metric] },
              { field: 'clock', title: 'Time' },
              { field: 'pulls', title: 'Pulls this long' },
            ],
          },
        },
      ],
      config: STACK_THEME,
    },
  }
}
