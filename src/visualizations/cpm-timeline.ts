import { darkTheme, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

const BUCKET_MS = 15_000

// Casts per minute in 15s buckets. `castTimes` are ms from pull start.
export function cpmTimeline(castTimes: number[], durationMs: number, avgCpm: number): Visualization {
  const buckets = Math.max(1, Math.ceil(durationMs / BUCKET_MS))
  const counts = new Array<number>(buckets).fill(0)
  for (const t of castTimes) counts[Math.min(buckets - 1, Math.floor(t / BUCKET_MS))]++

  const points = counts.map((n, i) => {
    // The last bucket is usually partial; scale by its real length.
    const lenSec = Math.min(BUCKET_MS, durationMs - i * BUCKET_MS) / 1000
    const startSec = (i * BUCKET_MS) / 1000
    return {
      // 2px-ish gap between neighbouring bars
      x0: startSec + 0.4,
      x1: startSec + lenSec - 0.4,
      range: `${clock(startSec)}–${clock(startSec + lenSec)}`,
      cpm: lenSec > 0 ? Math.round((n / lenSec) * 60) : 0,
    }
  })

  return {
    id: 'cpm-timeline',
    title: 'Casts per minute (15s buckets)',
    badge: `${avgCpm.toFixed(1)} avg CPM`,
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: 180,
      layer: [
        {
          data: { values: points },
          mark: { type: 'rect', color: '#3987e5', cornerRadiusTopLeft: 4, cornerRadiusTopRight: 4 },
          encoding: {
            x: { field: 'x0', type: 'quantitative', title: null, axis: clockAxis },
            x2: { field: 'x1' },
            y: { field: 'cpm', type: 'quantitative', title: 'CPM' },
            y2: { datum: 0 },
            tooltip: [
              { field: 'cpm', type: 'quantitative', title: 'CPM' },
              { field: 'range', title: 'Window' },
            ],
          },
        },
        {
          data: { values: [{ avg: avgCpm }] },
          mark: { type: 'rule', strokeDash: [4, 4], color: '#a6adc8' },
          encoding: { y: { field: 'avg', type: 'quantitative' } },
        },
      ],
      config: darkTheme,
    },
  }
}
