import type { WclEvent } from '../wcl/types.js'
import { darkTheme, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

const BUCKET_MS = 10_000

// Effective HPS in 10s buckets. `events` are the Healing stream for the monk, which
// also carries their pets (statue, Yu'lon) and absorbs (Life Cocoon).
export function hpsTimeline(events: WclEvent[], fightStartMs: number, durationMs: number): Visualization {
  const buckets = Math.max(1, Math.ceil(durationMs / BUCKET_MS))
  const sums = new Array<number>(buckets).fill(0)
  for (const e of events) {
    const i = Math.floor((e.timestamp - fightStartMs) / BUCKET_MS)
    if (i >= 0 && i < buckets && (e.type === 'heal' || e.type === 'absorbed')) sums[i] += e.amount ?? 0
  }
  const points = sums.map((sum, i) => ({
    t: (i * BUCKET_MS) / 1000,
    clock: clock((i * BUCKET_MS) / 1000),
    hps: Math.round(sum / (BUCKET_MS / 1000)),
  }))

  return {
    id: 'hps-timeline',
    title: 'Effective HPS (10s buckets)',
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 200,
      data: { values: points },
      layer: [
        {
          mark: { type: 'area', line: { color: '#4ade80', strokeWidth: 2 }, color: '#4ade80', fillOpacity: 0.15 },
          encoding: {
            x: { field: 't', type: 'quantitative', title: null, axis: clockAxis },
            y: { field: 'hps', type: 'quantitative', title: 'HPS', axis: { format: '~s' } },
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
              { field: 'hps', type: 'quantitative', title: 'HPS', format: ',.0f' },
              { field: 'clock', title: 'Time' },
            ],
          },
        },
      ],
      config: darkTheme,
    },
  }
}
