import type { PullAnalysis } from './analyze.js'
import type { Second } from './timeline.js'
import { rolling, rates, MIN_DROP, type MetricKey } from './dips.js'
import { groupByBoss, MIN_JUDGED_PULL_MS } from './summary.js'

// Recurring dips: the same metric falling at the same point of the same boss, pull after
// pull. A single bad stretch is a mistake; one that repeats is a habit or a mechanic you
// haven't solved yet, which is what's worth practising.

// A second counts as "low" when the rolling value is this share of MIN_DROP below the pull's
// own average. Softer than a single-pull dip, because recurrence already filters noise.
const LOW_SHARE_OF_MIN_DROP = 0.6
// A spot is recurring when at least this share of the pulls that reached it were low there…
const MIN_RECURRENCE = 0.6
// …and at least this many pulls, so two pulls agreeing by chance on a long boss is rare.
const MIN_PULLS_LOW = 2
// Mechanics drift a little between pulls, so each pull's low seconds are widened this much.
const JITTER_S = 3
const MIN_PATTERN_S = 6
// Low stretches this close together are one pattern.
const MERGE_GAP_S = 4
// A pattern that starts this early in the pull is the opener.
const OPENER_START_S = 10

export interface PatternHit {
  pull: PullAnalysis
  pullStart: number // seconds from pull start where this pull's instance begins
  value: number     // the metric over the pattern's stretch in this pull
  baseline: number  // the metric over this pull
  moving: number | null
}

export interface Pattern {
  bossName: string
  difficulty: number | null
  encounterID: number
  metric: MetricKey
  phase: number | null // phase the stretch is aligned to; null = aligned to pull start
  phaseOccurrence: number // 1 the first time the phase happens in a pull, 2 when it returns, ...
  start: number        // seconds from the phase (or pull) start
  end: number
  opener: boolean
  pullsReached: number // pulls that lasted long enough to reach this spot
  hits: PatternHit[]   // pulls that dipped here
  value: number        // average metric across hits
  baseline: number     // average of those pulls' own averages
  drop: number         // relative, 0..1
  moving: number | null
}

// Where each second of a pull sits for alignment: which phase occurrence, and how far in.
interface Slot { key: string; offset: number }

function slots(p: PullAnalysis, byPhase: boolean): Slot[] {
  if (!byPhase) return p.timeline.map(s => ({ key: 'pull', offset: s.t }))
  const out: Slot[] = []
  const seen = new Map<number, number>()
  let runPhase: number | null | undefined
  let runStart = 0
  let runKey = ''
  for (const s of p.timeline) {
    if (s.phase !== runPhase) {
      runPhase = s.phase
      runStart = s.t
      // A phase can come back (P1 → P2 → P1); each return is its own occurrence.
      const n = (seen.get(s.phase ?? -1) ?? 0) + 1
      seen.set(s.phase ?? -1, n)
      runKey = `${s.phase ?? 'none'}#${n}`
    }
    out.push({ key: runKey, offset: s.t - runStart })
  }
  return out
}

export function findPatterns(pulls: PullAnalysis[]): Pattern[] {
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const out: Pattern[] = []
  for (const group of groupByBoss(judged)) {
    if (group.pulls.length < MIN_PULLS_LOW) continue
    // Align by phase only when every pull has phase data; mixing would compare unlike spots.
    const byPhase = group.pulls.every(p => p.phaseTransitions.length > 0)
    for (const metric of ['rem', 'kick', 'cpm'] as MetricKey[]) {
      out.push(...bossPatterns(group.pulls, metric, byPhase))
    }
  }
  return out.sort((a, b) => score(b) - score(a))
}

// Recurrence first, then how deep and how long.
function score(p: Pattern): number {
  return (p.hits.length / p.pullsReached) * p.drop * Math.sqrt(p.end - p.start)
}

function bossPatterns(pulls: PullAnalysis[], metric: MetricKey, byPhase: boolean): Pattern[] {
  const threshold = MIN_DROP[metric] * LOW_SHARE_OF_MIN_DROP
  // For each alignment key: per offset, which pulls reached it and which were low there.
  const reached = new Map<string, Map<number, Set<number>>>()
  const low = new Map<string, Map<number, Set<number>>>()
  const add = (m: Map<string, Map<number, Set<number>>>, key: string, offset: number, i: number) => {
    let byOffset = m.get(key)
    if (!byOffset) m.set(key, (byOffset = new Map()))
    let set = byOffset.get(offset)
    if (!set) byOffset.set(offset, (set = new Set()))
    set.add(i)
  }

  const perPull = pulls.map((p, i) => {
    const baseline = rates(p.timeline)[metric]
    const roll = rolling(p.timeline)
    const sl = slots(p, byPhase)
    const isLow = roll.map(r => r[metric] !== null && baseline > 0 && (baseline - (r[metric] as number)) / baseline >= threshold)
    sl.forEach((s, t) => {
      if (roll[t][metric] === null) return
      add(reached, s.key, s.offset, i)
      // Widen for jitter: a low second marks its neighbours in the same phase run as low too.
      const near = isLow.slice(Math.max(0, t - JITTER_S), t + JITTER_S + 1)
      if (near.some(Boolean)) add(low, s.key, s.offset, i)
    })
    return { p, baseline, sl }
  })

  const patterns: Pattern[] = []
  for (const [key, byOffset] of reached) {
    const offsets = [...byOffset.keys()].sort((a, b) => a - b)
    const recurring = (o: number) => {
      const r = byOffset.get(o)?.size ?? 0
      const l = low.get(key)?.get(o)?.size ?? 0
      return r >= MIN_PULLS_LOW && l >= MIN_PULLS_LOW && l / r >= MIN_RECURRENCE
    }

    // Contiguous recurring offsets, with small gaps closed.
    const stretches: Array<[number, number]> = []
    for (const o of offsets) {
      if (!recurring(o)) continue
      const last = stretches.at(-1)
      if (last && o - last[1] <= MERGE_GAP_S) last[1] = o
      else stretches.push([o, o])
    }

    for (const [a, b] of stretches) {
      if (b - a + 1 < MIN_PATTERN_S) continue
      const reachedPulls = new Set<number>()
      const lowCount = new Map<number, number>()
      for (let o = a; o <= b; o++) {
        byOffset.get(o)?.forEach(i => reachedPulls.add(i))
        low.get(key)?.get(o)?.forEach(i => lowCount.set(i, (lowCount.get(i) ?? 0) + 1))
      }
      // A pull takes part when it was low for at least half the stretch.
      const len = b - a + 1
      const hits: PatternHit[] = []
      for (const [i, n] of lowCount) {
        if (n < len / 2) continue
        const { p, baseline, sl } = perPull[i]
        const seconds: Second[] = p.timeline.filter((_, t) => sl[t].key === key && sl[t].offset >= a && sl[t].offset <= b)
        if (seconds.length === 0) continue
        const r = rates(seconds)
        hits.push({ pull: p, pullStart: seconds[0].t, value: r[metric], baseline, moving: r.moving })
      }
      if (hits.length < MIN_PULLS_LOW || hits.length / reachedPulls.size < MIN_RECURRENCE) continue

      const value = hits.reduce((s, h) => s + h.value, 0) / hits.length
      const baseline = hits.reduce((s, h) => s + h.baseline, 0) / hits.length
      const drop = baseline > 0 ? (baseline - value) / baseline : 0
      if (drop < threshold) continue
      const movingHits = hits.filter(h => h.moving !== null)
      const [phaseKey, occurrence] = key.split('#')
      const phase = byPhase ? Number(phaseKey) : null
      const first = pulls[0]
      patterns.push({
        bossName: first.name,
        difficulty: first.difficulty,
        encounterID: first.encounterID,
        metric,
        phase: phase !== null && !Number.isNaN(phase) ? phase : null,
        phaseOccurrence: Number(occurrence) || 1,
        start: a,
        end: b + 1,
        opener: hits.every(h => h.pullStart <= OPENER_START_S),
        pullsReached: reachedPulls.size,
        hits: hits.sort((x, y) => (x.pull.reportStartTime + x.pull.startMs) - (y.pull.reportStartTime + y.pull.startMs)),
        value,
        baseline,
        drop,
        moving: movingHits.length ? movingHits.reduce((s, h) => s + (h.moving ?? 0), 0) / movingHits.length : null,
      })
    }
  }
  return patterns
}
