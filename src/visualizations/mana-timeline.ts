import type { PullAnalysis } from '../mw/analyze.js'
import { darkTheme, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

// Mana % sampled at each cast.
export function manaTimeline(p: PullAnalysis): Visualization {
  const rows = p.mana.series.map(s => ({ t: s.t / 1000, clock: clock(s.t / 1000), pct: s.v }))
  return {
    id: 'mana-timeline',
    title: 'Mana',
    badge: `ended at ${Math.round(p.mana.endPct * 100)}%`,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 160,
      data: { values: rows },
      layer: [
        {
          mark: { type: 'line', color: '#3987e5', strokeWidth: 2 },
          encoding: {
            x: { field: 't', type: 'quantitative', title: null, axis: clockAxis },
            y: { field: 'pct', type: 'quantitative', title: null, axis: { format: '.0%' }, scale: { domain: [0, 1] } },
          },
        },
        {
          params: [{
            name: 'hover',
            select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointermove', clear: 'pointerout' },
          }],
          mark: { type: 'rule', color: '#a6adc8' },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            opacity: { condition: { param: 'hover', empty: false, value: 0.7 }, value: 0 },
            tooltip: [
              { field: 'pct', type: 'quantitative', title: 'Mana', format: '.0%' },
              { field: 'clock', title: 'Time' },
            ],
          },
        },
      ],
      config: darkTheme,
    },
  }
}
