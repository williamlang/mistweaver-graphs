import type { PullAnalysis } from './analyze.js'
import type { Second } from './timeline.js'
import { MIN_JUDGED_PULL_MS } from './summary.js'

export type MetricKey = 'rem' | 'kick' | 'cpm'

export const METRICS: Record<MetricKey, { label: string; short: string }> = {
  rem: { label: 'Renewing Mist uptime', short: 'ReM up' },
  kick: { label: 'Rushing Wind Kick uptime', short: 'RWK up' },
  cpm: { label: 'CPM', short: 'CPM' },
}

// Width of the rolling window used to smooth the per-second series.
export const WINDOW_S = 15

export interface Rates { seconds: number; rem: number; kick: number; cpm: number; moving: number | null }

// Metrics over any set of seconds. Seconds you spent dead, or after a wipe was already
// lost, are left out: CPM is 0 on the floor, and that is not the dip we're looking for.
export function rates(seconds: Second[]): Rates {
  const alive = seconds.filter(s => !s.dead && !s.wiping)
  const n = alive.length
  if (n === 0) return { seconds: 0, rem: 0, kick: 0, cpm: 0, moving: null }
  const known = alive.filter(s => s.moving !== null)
  return {
    seconds: n,
    rem: alive.reduce((a, s) => a + s.rem, 0) / n,
    kick: alive.reduce((a, s) => a + s.kick, 0) / n,
    cpm: (alive.reduce((a, s) => a + s.casts, 0) / n) * 60,
    moving: known.length ? known.filter(s => s.moving).length / known.length : null,
  }
}

export interface RollingPoint { t: number; rem: number | null; kick: number | null; cpm: number | null }

// Trailing-centred rolling average: the value at t covers [t - W/2, t + W/2).
export function rolling(timeline: Second[], windowS = WINDOW_S): RollingPoint[] {
  const half = Math.floor(windowS / 2)
  return timeline.map((_, i) => {
    const win = timeline.slice(Math.max(0, i - half), Math.min(timeline.length, i + half + 1))
    const r = rates(win)
    const ok = r.seconds >= Math.min(5, win.length)
    return { t: timeline[i].t, rem: ok ? r.rem : null, kick: ok ? r.kick : null, cpm: ok ? r.cpm : null }
  })
}

// ── Dips within one pull ────────────────────────────────────────────────────

export interface Dip {
  metric: MetricKey
  start: number // seconds from pull start
  end: number
  value: number    // metric over the window
  baseline: number // metric over the whole pull
  drop: number     // relative drop, 0..1
  phase: number | null
  moving: number | null
  celestial: boolean
  raidDeaths: number
  mana: number | null
}

// A dip is a window at least this far below the pull's own level.
export const MIN_DROP: Record<MetricKey, number> = { rem: 0.1, kick: 0.15, cpm: 0.25 }
const MAX_DIPS_PER_METRIC = 3

export function findDips(p: PullAnalysis): Dip[] {
  if (p.durationMs < MIN_JUDGED_PULL_MS) return []
  const tl = p.timeline
  const base = rates(tl)
  const roll = rolling(tl)
  const out: Dip[] = []

  for (const metric of ['rem', 'kick', 'cpm'] as MetricKey[]) {
    const baseline = base[metric]
    if (baseline <= 0) continue
    const candidates = roll
      .filter(r => r[metric] !== null)
      .map(r => ({ t: r.t, v: r[metric] as number }))
      .filter(c => (baseline - c.v) / baseline >= MIN_DROP[metric])
      .sort((a, b) => a.v - b.v)

    const picked: number[] = []
    for (const c of candidates) {
      if (picked.length >= MAX_DIPS_PER_METRIC) break
      if (picked.some(t => Math.abs(t - c.t) < WINDOW_S)) continue
      picked.push(c.t)
    }

    const windows: Array<[number, number]> = []
    for (const center of picked) {
      const [start, end] = widen(roll, metric, center, baseline)
      // Two low points in one stretch widen into the same window; keep it once.
      if (windows.some(([a, b]) => start < b && end > a)) continue
      windows.push([start, end])
      const win = tl.slice(start, end)
      const r = rates(win)
      out.push({
        metric,
        start,
        end,
        value: r[metric],
        baseline,
        drop: (baseline - r[metric]) / baseline,
        phase: win[Math.floor(win.length / 2)]?.phase ?? null,
        moving: r.moving,
        celestial: win.filter(s => s.celestial).length > win.length / 2,
        raidDeaths: p.deaths.filter(d => d.timeMs / 1000 >= start && d.timeMs / 1000 < end).length,
        mana: win[0]?.mana ?? null,
      })
    }
  }
  // Widening can pull a sharp dip back toward the average; drop the ones that no longer read as a dip.
  return out.filter(d => d.drop >= MIN_DROP[d.metric] * 0.6).sort((a, b) => b.drop - a.drop)
}

// Grow the window around a low point while the rolling value stays in the dip.
function widen(roll: RollingPoint[], metric: MetricKey, center: number, baseline: number): [number, number] {
  const threshold = baseline * (1 - MIN_DROP[metric] / 2)
  const low = (i: number) => roll[i] && roll[i][metric] !== null && (roll[i][metric] as number) < threshold
  let a = center
  let b = center
  while (a > 0 && low(a - 1) && center - a < 60) a--
  while (b < roll.length - 1 && low(b + 1) && b - center < 60) b++
  const half = Math.floor(WINDOW_S / 2)
  return [Math.max(0, a - half), Math.min(roll.length, b + half + 1)]
}

// ── Context: where across the night do the metrics sag ─────────────────────

export interface ContextRow { key: string; label: string; rates: Rates }

const OPENER_S = 20

export function contextBreakdown(pulls: PullAnalysis[]): ContextRow[] {
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const all = judged.flatMap(p => p.timeline)
  const pick = (f: (s: Second, p: PullAnalysis) => boolean) =>
    judged.flatMap(p => p.timeline.filter(s => f(s, p)))

  const rows: ContextRow[] = [
    { key: 'all', label: 'Whole night', rates: rates(all) },
    { key: 'standing', label: 'Standing still', rates: rates(all.filter(s => s.moving === false)) },
    { key: 'moving', label: 'Moving', rates: rates(all.filter(s => s.moving === true)) },
    { key: 'opener', label: `First ${OPENER_S}s of the pull`, rates: rates(pick(s => s.t < OPENER_S)) },
    { key: 'celestial', label: 'Yu\'lon / Chi-Ji / Conduit windows', rates: rates(all.filter(s => s.celestial)) },
    { key: 'lowmana', label: 'Mana under 20%', rates: rates(all.filter(s => s.mana !== null && s.mana < 0.2)) },
    { key: 'lastmin', label: 'Last 60s of the pull', rates: rates(pick((s, p) => s.t >= p.durationMs / 1000 - 60)) },
  ]
  return rows.filter(r => r.rates.seconds >= 10)
}

// ── Across pulls of one boss ───────────────────────────────────────────────

export interface PhaseRow {
  id: number
  name: string
  isIntermission: boolean
  pulls: number
  rates: Rates
}

export function phaseBreakdown(
  pulls: PullAnalysis[],
  phaseNames: Array<{ id: number; name: string; isIntermission: boolean }>,
): PhaseRow[] {
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const ids = [...new Set(judged.flatMap(p => p.timeline.map(s => s.phase)).filter((x): x is number => x !== null))].sort((a, b) => a - b)
  return ids.map(id => {
    const meta = phaseNames.find(ph => ph.id === id)
    return {
      id,
      name: meta?.name ?? `Phase ${id}`,
      isIntermission: meta?.isIntermission ?? false,
      pulls: judged.filter(p => p.timeline.some(s => s.phase === id)).length,
      rates: rates(judged.flatMap(p => p.timeline.filter(s => s.phase === id))),
    }
  })
}

export interface AlignedPoint { t: number; pulls: number; rem: number | null; kick: number | null; cpm: number | null }

// Average rolling value at each second from the pull, across every pull that lasted
// that long. Recurring dips (a mechanic at 2:10 every pull) survive the averaging;
// one-off dips wash out.
export function alignedAverage(pulls: PullAnalysis[]): AlignedPoint[] {
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const rolls = judged.map(p => rolling(p.timeline))
  const len = Math.max(0, ...rolls.map(r => r.length))
  const out: AlignedPoint[] = []
  for (let t = 0; t < len; t++) {
    const pts = rolls.map(r => r[t]).filter(Boolean)
    const avg = (k: MetricKey) => {
      const vs = pts.map(p => p[k]).filter((v): v is number => v !== null)
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
    }
    out.push({ t, pulls: pts.length, rem: avg('rem'), kick: avg('kick'), cpm: avg('cpm') })
  }
  return out
}
