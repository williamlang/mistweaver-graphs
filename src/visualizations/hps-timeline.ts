import type { HealEvent } from '../wcl/types.js'
import { darkTheme, type Visualization } from './types.js'

interface TimePoint {
  timeSec: number
  hps: number
}

const BUCKET_MS = 5000

export function hpsTimeline(
  events: HealEvent[],
  fightStartMs: number,
  fightEndMs: number,
): Visualization {
  const duration = fightEndMs - fightStartMs
  const buckets = Math.ceil(duration / BUCKET_MS)

  const points: TimePoint[] = Array.from({ length: buckets }, (_, i) => {
    const bucketStart = fightStartMs + i * BUCKET_MS
    const bucketEnd = bucketStart + BUCKET_MS
    const healing = events
      .filter(e => e.timestamp >= bucketStart && e.timestamp < bucketEnd)
      .reduce((sum, e) => sum + e.amount, 0)
    return {
      timeSec: Math.round((i * BUCKET_MS) / 1000),
      hps: Math.round(healing / (BUCKET_MS / 1000)),
    }
  })

  return {
    id: 'hps-timeline',
    title: 'HPS Over Time (5s buckets)',
    spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: 240,
      data: { values: points },
      mark: {
        type: 'area',
        line: { color: '#4ade80', strokeWidth: 2 },
        color: '#4ade80',
        fillOpacity: 0.15,
      },
      encoding: {
        x: {
          field: 'timeSec',
          type: 'quantitative',
          title: 'Time (seconds)',
        },
        y: {
          field: 'hps',
          type: 'quantitative',
          title: 'HPS',
          axis: { format: '~s' },
        },
        tooltip: [
          { field: 'timeSec', type: 'quantitative', title: 'Time (s)' },
          { field: 'hps', type: 'quantitative', title: 'HPS', format: ',.0f' },
        ],
      },
      config: darkTheme,
    },
  }
}
