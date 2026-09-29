import type { PullAnalysis } from '../mw/analyze.js'
import { darkTheme, COLORS, VEGA_SCHEMA, type Visualization } from './types.js'
import { clockAxis, clock } from './time.js'

// One row per spell: a tick for every cast, and an amber band wherever the spell sat
// ready and unused (for Renewing Mist: capped at max charges). TFT gets ticks only.
export function cooldownTimeline(p: PullAnalysis): Visualization {
  const rot = (key: string) => p.rotational.find(r => r.key === key)
  const rows: string[] = []
  const casts: Array<{ row: string; t: number; clock: string }> = []
  const ready: Array<{ row: string; start: number; end: number; from: string; to: string; secs: number }> = []

  const addCasts = (row: string, times: number[]) => {
    rows.push(row)
    for (const t of times) casts.push({ row, t: t / 1000, clock: clock(t / 1000) })
  }
  const addReady = (row: string, windows: Array<{ start: number; end: number }>) => {
    for (const w of windows) {
      if (w.end - w.start < 500) continue
      ready.push({
        row, start: w.start / 1000, end: w.end / 1000,
        from: clock(w.start / 1000), to: clock(w.end / 1000), secs: Math.round((w.end - w.start) / 100) / 10,
      })
    }
  }

  addCasts('Renewing Mist', p.rem.casts)
  addReady('Renewing Mist', p.rem.capped)
  const kick = rot('kick')
  if (kick) {
    addCasts(p.kick.name, kick.casts)
    addReady(p.kick.name, p.kick.idle)
  }
  const tft = rot('tft')
  if (tft) addCasts('Thunder Focus Tea', tft.casts)
  for (const cd of p.cooldowns) {
    addCasts(cd.name, cd.casts)
    addReady(cd.name, cd.segments.filter(s => s.state === 'capped'))
  }

  const durSec = p.durationMs / 1000
  const y = { field: 'row', type: 'nominal', title: null, sort: rows, scale: { domain: rows } }

  return {
    id: 'cooldown-timeline',
    title: 'Cooldowns — casts and time spent ready but unused',
    spec: {
      $schema: VEGA_SCHEMA,
      width: 'container',
      height: rows.length * 30,
      layer: [
        {
          data: { values: ready },
          mark: { type: 'bar', color: COLORS.warning, opacity: 0.35, height: { band: 0.7 } },
          encoding: {
            x: { field: 'start', type: 'quantitative', title: null, axis: clockAxis, scale: { domain: [0, durSec] } },
            x2: { field: 'end' },
            y,
            tooltip: [
              { field: 'secs', type: 'quantitative', title: 'Ready, unused (s)' },
              { field: 'row', title: 'Spell' },
              { field: 'from', title: 'From' },
              { field: 'to', title: 'To' },
            ],
          },
        },
        {
          data: { values: casts },
          mark: { type: 'tick', color: COLORS.ink, thickness: 2, bandSize: 18 },
          encoding: {
            x: { field: 't', type: 'quantitative' },
            y,
            tooltip: [
              { field: 'clock', title: 'Cast at' },
              { field: 'row', title: 'Spell' },
            ],
          },
        },
      ],
      config: darkTheme,
    },
  }
}
