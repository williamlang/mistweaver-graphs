import type { PullAnalysis, StepPoint } from '../mw/analyze.js'
import { darkTheme, COLORS, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

function valueAt(series: StepPoint[], t: number): number {
  let v = series[0]?.v ?? 0
  for (const p of series) {
    if (p.t > t) break
    v = p.v
  }
  return v
}

// Active Renewing Mists (and Enveloping Mists) on the raid, sampled each second.
export function hotCount(p: PullAnalysis): Visualization {
  const secs = Math.floor(p.durationMs / 1000)
  const rows = Array.from({ length: secs + 1 }, (_, s) => ({
    t: s,
    clock: clock(s),
    'Renewing Mist': valueAt(p.remSeries, s * 1000),
    'Enveloping Mist': valueAt(p.envSeries, s * 1000),
  }))

  return {
    id: 'hot-count',
    title: 'Active HoTs on the raid',
    badge: `${p.remAvg.toFixed(1)} avg ReMs · ${Math.round(p.remCoverage * 100)}% of raid`,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 220,
      data: { values: rows },
      layer: [
        {
          transform: [{ fold: ['Renewing Mist', 'Enveloping Mist'], as: ['series', 'count'] }],
          mark: { type: 'line', interpolate: 'step-after', strokeWidth: 2 },
          encoding: {
            x: { field: 't', type: 'quantitative', title: null, axis: clockAxis },
            y: { field: 'count', type: 'quantitative', title: 'Targets' },
            color: {
              field: 'series',
              type: 'nominal',
              scale: { domain: ['Renewing Mist', 'Enveloping Mist'], range: [COLORS.rem, COLORS.env] },
              legend: { orient: 'top', title: null },
            },
          },
        },
        {
          data: { values: [{ avg: p.remAvg }] },
          mark: { type: 'rule', strokeDash: [4, 4], color: COLORS.rem, strokeWidth: 1 },
          encoding: { y: { field: 'avg', type: 'quantitative' } },
        },
        {
          params: [{
            name: 'hover',
            select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointermove', clear: 'pointerout' },
          }],
          mark: { type: 'rule', color: COLORS.inkMuted },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            opacity: { condition: { param: 'hover', empty: false, value: 0.7 }, value: 0 },
            tooltip: [
              { field: 'clock', title: 'Time' },
              { field: 'Renewing Mist', type: 'quantitative' },
              { field: 'Enveloping Mist', type: 'quantitative' },
            ],
          },
        },
      ],
      config: darkTheme,
    },
  }
}
