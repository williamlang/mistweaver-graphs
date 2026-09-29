import type { PullAnalysis } from '../mw/analyze.js'
import { darkTheme, COLORS, VEGA_SCHEMA, type Visualization } from './types.js'

export interface TrendMetric {
  id: string
  title: string
  value: (p: PullAnalysis) => number
  format: string // d3 format for the value
  badge?: string // e.g. the night average, shown next to the title
  domain?: [number, number]
}

export function pullLabel(p: PullAnalysis): string {
  return p.kill ? 'Kill' : p.bossPct !== null ? `Wipe ${p.bossPct.toFixed(1)}%` : 'Wipe'
}

// One bar per pull in night order, colored by kill/wipe, with the night average as a
// dashed rule. Clicking a bar opens that pull.
export function pullTrend(
  pulls: PullAnalysis[],
  metric: TrendMetric,
  pullHref: (p: PullAnalysis) => string,
  average: number,
): Visualization {
  const rows = pulls.map((p, i) => ({
    idx: i + 1,
    boss: p.name,
    result: pullLabel(p),
    outcome: p.kill ? 'Kill' : 'Wipe',
    duration: `${Math.floor(p.durationMs / 60000)}:${String(Math.floor(p.durationMs / 1000) % 60).padStart(2, '0')}`,
    value: metric.value(p),
    href: pullHref(p),
  }))

  return {
    id: metric.id,
    title: metric.title,
    badge: metric.badge,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 160,
      layer: [
        {
          data: { values: rows },
          mark: { type: 'bar', cornerRadiusEnd: 4, cursor: 'pointer', width: { band: 0.8 } },
          encoding: {
            x: { field: 'idx', type: 'ordinal', title: 'Pull', axis: { labelAngle: 0 } },
            y: {
              field: 'value',
              type: 'quantitative',
              title: null,
              axis: { format: metric.format, tickCount: 4 },
              ...(metric.domain ? { scale: { domain: metric.domain } } : {}),
            },
            color: {
              field: 'outcome',
              type: 'nominal',
              scale: { domain: ['Kill', 'Wipe'], range: [COLORS.kill, COLORS.wipe] },
              legend: { orient: 'top', title: null },
            },
            href: { field: 'href' },
            tooltip: [
              { field: 'value', type: 'quantitative', title: metric.title, format: metric.format },
              { field: 'boss', title: 'Boss' },
              { field: 'result', title: 'Result' },
              { field: 'duration', title: 'Duration' },
              { field: 'idx', title: 'Pull #' },
            ],
          },
        },
        {
          data: { values: [{ avg: average }] },
          mark: { type: 'rule', strokeDash: [4, 4], color: COLORS.inkMuted, strokeWidth: 1 },
          encoding: {
            y: { field: 'avg', type: 'quantitative' },
            tooltip: [{ field: 'avg', type: 'quantitative', title: 'Night average', format: metric.format }],
          },
        },
      ],
      config: darkTheme,
    },
  }
}
