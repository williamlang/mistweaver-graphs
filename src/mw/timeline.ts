import type { WclEvent, Fight } from '../wcl/types.js'
import { SPELL, CHIJI_WINDOW_MS } from './spells.js'

// One entry per second of the pull: how each headline metric behaved in that second,
// plus the context that tends to explain a dip. Everything the dip finder and the
// cross-pull trend views need is derived from this.
export interface Second {
  t: number              // seconds from pull start
  rem: number            // 0..1 share of the second Renewing Mist was recharging
  kick: number           // 0..1 share of the second the kick was on cooldown
  casts: number          // casts that started in this second
  moving: boolean | null // null = no position data around this second
  phase: number | null   // encounter phase id, when the boss has phases
  celestial: boolean     // inside a Yu'lon / Chi-Ji / Celestial Conduit window
  dead: boolean          // the monk was dead (excluded from judgement)
  wiping: boolean        // a wipe was already lost: 30%+ of the raid dead (excluded too)
  mana: number | null    // 0..1
}

interface Interval { start: number; end: number } // ms from pull start

// Speed above this counts as moving. Standing still reads as ~0; walking is ~7 yd/s.
const MOVING_YD_PER_SEC = 1.5
// Position samples further apart than this are too sparse to judge movement.
const MAX_POSITION_GAP_MS = 3000

export interface TimelineInput {
  fight: Fight
  monkId: number
  durationMs: number
  castTimes: number[]           // ms from pull start
  remRecharging: Interval[]     // Renewing Mist had < max charges
  kickIdle: Interval[]          // kick was ready and unused
  positions: WclEvent[]         // events carrying the monk's x/y
  buffs: WclEvent[]             // monk's buffs (source = monk), report time
  chijiCasts: number[]          // ms from pull start
  manaSeries: Array<{ t: number; v: number }>
  deathTimes: number[]          // monk deaths, ms from pull start
  wipeFrom: number | null       // ms from pull start the wipe was lost, for wipes
}

export function buildTimeline(input: TimelineInput): Second[] {
  const { fight, durationMs } = input
  const start = fight.startTime
  const secs = Math.ceil(durationMs / 1000)

  const celestial = celestialWindows(input.buffs, input.chijiCasts, start, durationMs)
  const dead = deadWindows(input.deathTimes, input.castTimes, durationMs)
  const positions = monkPositions(input.positions, input.monkId, start)
  const phases = (fight.phaseTransitions ?? [])
    .map(p => ({ id: p.id, t: p.startTime - start }))
    .sort((a, b) => a.t - b.t)

  const castCounts = new Array<number>(secs).fill(0)
  for (const t of input.castTimes) castCounts[Math.min(secs - 1, Math.floor(t / 1000))]++

  const out: Second[] = []
  let manaIdx = 0
  let posIdx = 0
  for (let i = 0; i < secs; i++) {
    const a = i * 1000
    const b = Math.min(durationMs, a + 1000)
    const len = b - a
    if (len <= 0) break

    while (manaIdx + 1 < input.manaSeries.length && input.manaSeries[manaIdx + 1].t <= a) manaIdx++
    while (posIdx + 1 < positions.length && positions[posIdx + 1].t <= a) posIdx++

    let phase: number | null = null
    for (const p of phases) if (p.t <= a + 500) phase = p.id

    out.push({
      t: i,
      rem: overlap(input.remRecharging, a, b) / len,
      kick: 1 - overlap(input.kickIdle, a, b) / len,
      casts: castCounts[i],
      moving: movingAt(positions, posIdx, a, b),
      phase,
      celestial: overlap(celestial, a, b) >= len / 2,
      dead: overlap(dead, a, b) >= len / 2,
      wiping: input.wipeFrom !== null && a >= input.wipeFrom,
      mana: input.manaSeries.length ? input.manaSeries[manaIdx].v : null,
    })
  }
  return out
}

function overlap(intervals: Interval[], a: number, b: number): number {
  let sum = 0
  for (const w of intervals) {
    if (w.end <= a) continue
    if (w.start >= b) continue
    sum += Math.min(b, w.end) - Math.max(a, w.start)
  }
  return sum
}

interface Pos { t: number; x: number; y: number }

// The monk's position comes from events where they are the resource actor: their own
// casts (resourceActor 1) and heals/damage landing on them (resourceActor 2).
function monkPositions(events: WclEvent[], monkId: number, start: number): Pos[] {
  const out: Pos[] = []
  for (const e of events) {
    if (e.x === undefined || e.y === undefined) continue
    const mine = (e.resourceActor === 1 && e.sourceID === monkId) || (e.resourceActor === 2 && e.targetID === monkId)
    if (mine) out.push({ t: e.timestamp - start, x: e.x, y: e.y })
  }
  return out.sort((a, b) => a.t - b.t)
}

// Speed over the second, measured between the last sample at/before its start and the
// first sample at/after its end.
function movingAt(pos: Pos[], idx: number, a: number, b: number): boolean | null {
  if (pos.length < 2) return null
  let i = idx
  while (i > 0 && pos[i].t > a) i--
  let j = i
  while (j < pos.length - 1 && pos[j].t < b) j++
  const p = pos[i]
  const q = pos[j]
  const dt = q.t - p.t
  if (dt <= 0 || dt > MAX_POSITION_GAP_MS) return null
  const yards = Math.hypot(q.x - p.x, q.y - p.y) / 100
  return yards / (dt / 1000) > MOVING_YD_PER_SEC
}

function celestialWindows(buffs: WclEvent[], chijiCasts: number[], start: number, durationMs: number): Interval[] {
  const out: Interval[] = []
  for (const id of [SPELL.INVOKE_YULON, SPELL.CELESTIAL_CONDUIT]) {
    let open: number | null = null
    let first = true
    for (const b of buffs) {
      if (b.abilityGameID !== id) continue
      if (id === SPELL.INVOKE_YULON && b.targetID !== b.sourceID) continue
      const t = b.timestamp - start
      if (b.type === 'applybuff') open = t
      else if (b.type === 'removebuff') {
        out.push({ start: open ?? (first ? 0 : t), end: t })
        open = null
      }
      first = false
    }
    if (open !== null) out.push({ start: open, end: durationMs })
  }
  for (const t of chijiCasts) out.push({ start: t, end: Math.min(durationMs, t + CHIJI_WINDOW_MS) })
  return out
}

// Dead from each death until the next cast (a battle res) or the end of the pull.
function deadWindows(deaths: number[], castTimes: number[], durationMs: number): Interval[] {
  return deaths.map(d => ({ start: d, end: castTimes.find(t => t > d) ?? durationMs }))
}
