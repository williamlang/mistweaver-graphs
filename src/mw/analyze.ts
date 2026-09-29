import type { Fight, HealingTableData, DeathEntry, WclEvent } from '../wcl/types.js'
import {
  SPELL, GCD_SPELLS, CHANNEL_BUFFS, HEART_AFFECTED, REM_COOLDOWN_MS, POOL_OF_MISTS_CDR_MS,
  majorCooldowns, rotationalSpells, detectTalents, heartRate,
  type Talents,
} from './spells.js'
import { simulateCharges, type CdEvent } from './cooldown.js'
import { buildTimeline, type Second } from './timeline.js'

// Everything the dashboard knows about one pull. Times are ms from pull start.
export interface PullAnalysis {
  fightId: number
  name: string
  encounterID: number
  difficulty: number | null
  kill: boolean
  bossPct: number | null
  startMs: number // ms from report start
  durationMs: number     // judged length: ends at the cutoff death when one applies
  fullDurationMs: number // the whole pull
  cutAtDeath: number | null // N when the pull was cut at its Nth death
  talents: Talents
  healing: { effective: number; overheal: number; hps: number; overhealPct: number }
  table: HealingTableData
  castCount: number
  castTimes: number[] // every cast, ms from pull start
  cpm: number
  gcdMs: number // median hasted 1.5s GCD
  haste: number
  activeTimePct: number
  cooldowns: CooldownResult[]
  rotational: RotationalResult[]
  rem: RemUptime
  remAvg: number
  remCoverage: number // remAvg / raid size
  raidSize: number
  kick: KickUptime
  envAvg: number
  remSeries: StepPoint[]
  envSeries: StepPoint[]
  mana: { startPct: number; endPct: number; minPct: number; series: StepPoint[] }
  castsBySpell: Record<number, number>
  deaths: Array<{ name: string; timeMs: number; killingBlow: string; isMonk: boolean }>
  monkDied: boolean
  phaseTransitions: Array<{ id: number; t: number }> // ms from pull start
  timeline: Second[]
}

export interface StepPoint { t: number; v: number }

// "Uptime" for a cooldown with no buff: the share of the pull the kick was on cooldown
// rather than sitting ready. Resets (TFT'd kicks, BoK procs) only make the real value
// lower, so this is an upper bound; the idle windows it reports are real waste.
export interface KickUptime {
  name: string
  cooldownMs: number // at median haste
  uptimePct: number
  idleMs: number
  idle: Array<{ start: number; end: number }>
}

// Renewing Mist uptime, computed the way WoWAnalyzer grades it: the share of the pull
// ReM had fewer than max charges (i.e. was recharging) rather than sitting capped.
export interface RemUptime {
  uptimePct: number
  cappedMs: number
  charges: number
  casts: number[]
  cpm: number
  missedRecharges: number // casts the model couldn't explain; treated as resets
  capped: Array<{ start: number; end: number }>
}

export interface RotationalResult {
  key: string
  name: string
  casts: number[] // cast times
  cpm: number
}

export type { ChargeSegment as CooldownSegment } from './cooldown.js'
import type { ChargeSegment } from './cooldown.js'

export interface CooldownResult {
  key: string
  name: string
  cooldownMs: number
  charges: number
  casts: number[] // cast times
  possible: number
  efficiency: number // 0..1
  cappedMs: number
  segments: ChargeSegment[]
}

export interface PullInput {
  fight: Fight              // endTime already moved to the cutoff death, if any
  fullEndTime: number
  cutoff: number | null
  monkId: number
  casts: WclEvent[]          // Casts stream for this fight, source = monk, with resources
  buffs: WclEvent[]          // TRACKED_BUFFS stream for this fight (all sources)
  combatantInfo?: WclEvent   // CombatantInfo for the monk
  positions: WclEvent[]      // heals/damage on the monk, with resources (their x/y)
  table: HealingTableData
  deaths: DeathEntry[]
}

export function analyzePull(input: PullInput): PullAnalysis {
  const { fight, monkId, table } = input
  const start = fight.startTime
  const durationMs = fight.endTime - fight.startTime
  const rel = (ts: number) => Math.max(0, Math.min(durationMs, ts - start))
  // Everything after the (cut) end of the pull is ignored, like WarcraftLogs does.
  const inPull = (e: { timestamp: number }) => e.timestamp <= fight.endTime

  const casts = input.casts
    .filter(e => e.sourceID === monkId && e.type === 'cast' && inPull(e))
    .sort((a, b) => a.timestamp - b.timestamp)
  const buffs = input.buffs
    .filter(e => e.sourceID === monkId && inPull(e))
    .sort((a, b) => a.timestamp - b.timestamp)

  const talents = detectTalents(input.combatantInfo?.talentTree)
  // Talent detection can fail (e.g. missing combatantinfo). Fall back to what was cast.
  const castIds = new Set(casts.map(c => c.abilityGameID))
  if (!input.combatantInfo) {
    talents.RUSHING_WIND_KICK = castIds.has(SPELL.RUSHING_WIND_KICK)
    talents.INVOKE_CHIJI = castIds.has(SPELL.INVOKE_CHIJI)
    talents.RESTORAL = castIds.has(SPELL.RESTORAL)
    talents.CELESTIAL_CONDUIT = castIds.has(SPELL.CELESTIAL_CONDUIT)
    talents.SHEILUNS_GIFT = castIds.has(SPELL.SHEILUNS_GIFT)
  }

  // Healing
  const total = table.entries.reduce((s, e) => s + (e.total ?? 0), 0)
  const overheal = table.entries.reduce((s, e) => s + (e.overheal ?? 0), 0)
  const secs = durationMs / 1000
  const healing = {
    effective: total,
    overheal,
    hps: secs > 0 ? total / secs : 0,
    overhealPct: total + overheal > 0 ? overheal / (total + overheal) : 0,
  }

  // GCD, haste and active time
  const gcdAt = gcdEstimator(casts)
  const gcdMs = gcdAt(null)
  const haste = Math.max(0, 1500 / gcdMs - 1)
  const monkCastStream = input.casts
    .filter(e => e.sourceID === monkId && inPull(e))
    .sort((a, b) => a.timestamp - b.timestamp)
  const activeTimePct = activeTime(monkCastStream, buffs, gcdAt, start, fight.endTime) / durationMs

  const castsBySpell: Record<number, number> = {}
  for (const c of casts) castsBySpell[c.abilityGameID] = (castsBySpell[c.abilityGameID] ?? 0) + 1

  const rates = heartRateEvents(buffs, monkId, start)
  const castEvents = (id: number): CdEvent[] =>
    casts.filter(c => c.abilityGameID === id).map(c => ({ t: rel(c.timestamp), kind: 'cast' as const }))
  const rateFor = (id: number) => (HEART_AFFECTED.has(id) ? rates : [])

  const cooldowns: CooldownResult[] = majorCooldowns(talents).map(def => {
    const sim = simulateCharges(def.cooldownMs, def.charges, [...castEvents(def.castId), ...rateFor(def.castId)], durationMs)
    const possible = sim.casts.length + sim.cappedMs / def.cooldownMs
    return {
      key: def.key,
      name: def.name,
      cooldownMs: def.cooldownMs,
      charges: def.charges,
      casts: sim.casts,
      possible,
      // WoWAnalyzer's cast efficiency: share of the pull the spell was on cooldown.
      efficiency: durationMs > 0 ? sim.onCooldownMs / durationMs : 1,
      cappedMs: sim.cappedMs,
      segments: sim.segments,
    }
  })
  const rotational = rotationalSpells(talents).map(def => {
    const times = casts.filter(c => def.castIds.includes(c.abilityGameID)).map(c => rel(c.timestamp))
    return { key: def.key, name: def.name, casts: times, cpm: durationMs > 0 ? times.length / (durationMs / 60000) : 0 }
  })

  const kickId = talents.RUSHING_WIND_KICK ? SPELL.RUSHING_WIND_KICK : SPELL.RISING_SUN_KICK

  const remCharges = talents.POOL_OF_MISTS ? 3 : 2
  const remEvents: CdEvent[] = [...castEvents(SPELL.RENEWING_MIST), ...rateFor(SPELL.RENEWING_MIST)]
  if (talents.POOL_OF_MISTS) {
    for (const c of casts) if (c.abilityGameID === kickId) remEvents.push({ t: rel(c.timestamp), kind: 'reduce', ms: POOL_OF_MISTS_CDR_MS })
  }
  const remSim = simulateCharges(REM_COOLDOWN_MS, remCharges, remEvents, durationMs)
  const rem: RemUptime = {
    uptimePct: durationMs > 0 ? remSim.onCooldownMs / durationMs : 0,
    cappedMs: remSim.cappedMs,
    charges: remCharges,
    casts: remSim.casts,
    cpm: durationMs > 0 ? remSim.casts.length / (durationMs / 60000) : 0,
    missedRecharges: remSim.missedRecharges,
    capped: remSim.segments.filter(g => g.state === 'capped'),
  }
  const kick = kickUptime(
    talents.RUSHING_WIND_KICK ? 'Rushing Wind Kick' : 'Rising Sun Kick',
    casts.filter(c => c.abilityGameID === kickId).map(c => c.timestamp),
    t => (KICK_BASE_CD_MS * gcdAt(t)) / 1500,
    start,
    fight.endTime,
  )
  kick.cooldownMs = (KICK_BASE_CD_MS * gcdMs) / 1500

  const remSeries = hotCount(buffs, SPELL.RENEWING_MIST_HOT, start, durationMs)
  const envSeries = hotCount(buffs, SPELL.ENVELOPING_MIST, start, durationMs)

  const remAvg = timeWeightedAvg(remSeries, durationMs)
  const raidSize = fight.friendlyPlayers?.length ?? 0

  const deaths = input.deaths
    .filter(d => d.fight === fight.id && inPull(d))
    .map(d => ({
      name: d.name,
      timeMs: rel(d.timestamp),
      killingBlow: d.killingBlow?.name ?? 'Unknown',
      isMonk: d.id === monkId,
    }))
    .sort((a, b) => a.timeMs - b.timeMs)

  const manaSeries = manaStats(casts, start, durationMs)
  const timeline = buildTimeline({
    fight,
    monkId,
    durationMs,
    castTimes: casts.map(c => rel(c.timestamp)),
    remRecharging: remSim.segments.filter(g => g.state === 'recharging'),
    kickIdle: kick.idle,
    positions: [...input.casts, ...input.positions].filter(inPull),
    buffs,
    chijiCasts: casts.filter(c => c.abilityGameID === SPELL.INVOKE_CHIJI).map(c => rel(c.timestamp)),
    manaSeries: manaSeries.series,
    deathTimes: deaths.filter(d => d.isMonk).map(d => d.timeMs),
    wipeFrom: wipeLostAt(fight, deaths.map(d => d.timeMs), raidSize),
  })

  return {
    fightId: fight.id,
    name: fight.name,
    encounterID: fight.encounterID,
    difficulty: fight.difficulty,
    kill: !!fight.kill,
    bossPct: fight.bossPercentage,
    startMs: start,
    durationMs,
    fullDurationMs: input.fullEndTime - start,
    cutAtDeath: fight.endTime < input.fullEndTime ? input.cutoff : null,
    talents,
    healing,
    table,
    castCount: casts.length,
    castTimes: casts.map(c => rel(c.timestamp)),
    cpm: durationMs > 0 ? casts.length / (durationMs / 60000) : 0,
    gcdMs,
    haste,
    activeTimePct: Math.min(1, activeTimePct),
    cooldowns,
    rotational,
    rem,
    remAvg,
    remCoverage: raidSize > 0 ? remAvg / raidSize : 0,
    raidSize,
    kick,
    envAvg: timeWeightedAvg(envSeries, durationMs),
    remSeries,
    envSeries,
    mana: manaSeries,
    castsBySpell,
    deaths,
    monkDied: deaths.some(d => d.isMonk),
    phaseTransitions: (fight.phaseTransitions ?? [])
      .filter(p => p.startTime < fight.endTime)
      .map(p => ({ id: p.id, t: Math.max(0, p.startTime - start) })),
    timeline,
  }
}

// The hasted GCD is the typical spacing between back-to-back GCD casts. Gaps shorter
// than 750ms (the GCD floor) are spell queue noise; gaps above 1.5s include idle time.
// Haste moves during a pull (lust, procs), so the estimate is the median of nearby gaps.
const GCD_WINDOW_MS = 20_000
const GCD_ANCHORS = new Set<number>([SPELL.RENEWING_MIST, SPELL.TIGER_PALM, SPELL.BLACKOUT_KICK, SPELL.INVOKE_YULON, SPELL.INVOKE_CHIJI, SPELL.REVIVAL, SPELL.RESTORAL])
const KICK_BASE_CD_MS = 12_000 // hasted

function gcdEstimator(casts: WclEvent[]): (ts: number | null) => number {
  // Only gaps that start on an instant 1.5s-GCD spell measure the hasted GCD. Hardcasts
  // log `cast` at the end of the cast, and Soothing Mist / RWK run on shorter GCDs.
  const gcdCasts = casts.filter(c => GCD_SPELLS.has(c.abilityGameID))
  const samples: Array<{ t: number; gap: number }> = []
  for (let i = 1; i < gcdCasts.length; i++) {
    if (!GCD_ANCHORS.has(gcdCasts[i - 1].abilityGameID)) continue
    const gap = gcdCasts[i].timestamp - gcdCasts[i - 1].timestamp
    if (gap >= 750 && gap <= 1500) samples.push({ t: gcdCasts[i].timestamp, gap })
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const global = samples.length >= 10 ? median(samples.map(s => s.gap)) : 1500
  return ts => {
    if (ts === null) return global
    const near = samples.filter(s => Math.abs(s.t - ts) <= GCD_WINDOW_MS).map(s => s.gap)
    return near.length >= 5 ? median(near) : global
  }
}

function kickUptime(
  name: string,
  castTs: number[],
  cdAt: (ts: number) => number,
  start: number,
  end: number,
): KickUptime {
  const idle: Array<{ start: number; end: number }> = []
  // Ready from the pull until the first cast, then ready again one cooldown after each cast.
  let readyAt = start
  for (const t of castTs) {
    if (t > readyAt) idle.push({ start: readyAt - start, end: t - start })
    readyAt = t + cdAt(t)
  }
  if (end > readyAt) idle.push({ start: readyAt - start, end: end - start })
  const idleMs = idle.reduce((s, w) => s + (w.end - w.start), 0)
  const dur = end - start
  return { name, cooldownMs: 0, uptimePct: dur > 0 ? 1 - idleMs / dur : 0, idleMs, idle }
}

// Active time = union of GCDs, hardcast windows (begincast → cast) and channels.
function activeTime(
  allCasts: WclEvent[],
  buffs: WclEvent[],
  gcdAt: (ts: number) => number,
  start: number,
  end: number,
): number {
  // A hardcast's GCD starts at begincast, so the window is begin → max(cast, begin + GCD).
  const intervals: Array<[number, number]> = []
  const begins = new Map<number, number>()
  for (const e of allCasts) {
    if (e.type === 'begincast') {
      begins.set(e.abilityGameID, e.timestamp)
      continue
    }
    if (e.type !== 'cast') continue
    const began = begins.get(e.abilityGameID)
    begins.delete(e.abilityGameID)
    const s = began ?? e.timestamp
    if (GCD_SPELLS.has(e.abilityGameID)) intervals.push([s, Math.max(e.timestamp, s + gcdAt(s))])
    else if (began !== undefined) intervals.push([s, e.timestamp])
  }

  const open = new Map<string, number>()
  for (const b of buffs) {
    if (!CHANNEL_BUFFS.has(b.abilityGameID)) continue
    const key = `${b.abilityGameID}:${b.targetID}`
    if (b.type === 'applybuff') open.set(key, b.timestamp)
    else if (b.type === 'removebuff') {
      intervals.push([open.get(key) ?? start, b.timestamp])
      open.delete(key)
    }
  }
  for (const s of open.values()) intervals.push([s, end])

  intervals.sort((a, b) => a[0] - b[0])
  let covered = 0
  let curS = -Infinity
  let curE = -Infinity
  for (const [s0, e0] of intervals) {
    const s = Math.max(s0, start)
    const e = Math.min(e0, end)
    if (e <= s) continue
    if (s > curE) {
      if (curE > curS) covered += curE - curS
      curS = s
      curE = e
    } else curE = Math.max(curE, e)
  }
  if (curE > curS) covered += curE - curS
  return covered
}

// On a wipe, the point where 30% of the raid is dead. What happens after that is the
// raid dying, not the monk's play, so the dip finder ignores it.
const WIPE_LOST_SHARE = 0.3

function wipeLostAt(fight: Fight, deathTimes: number[], raidSize: number): number | null {
  if (fight.kill || raidSize === 0) return null
  const n = Math.ceil(raidSize * WIPE_LOST_SHARE)
  const sorted = [...deathTimes].sort((a, b) => a - b)
  return sorted.length >= n ? sorted[n - 1] : null
}

// Cooldown-rate changes from Heart of the Jade Serpent buffs on the monk.
function heartRateEvents(buffs: WclEvent[], monkId: number, start: number): CdEvent[] {
  const ids = new Set<number>([SPELL.HEART_OF_THE_JADE_SERPENT, SPELL.HEART_OF_THE_JADE_SERPENT_UNITY, SPELL.HEART_OF_THE_JADE_SERPENT_AVATAR])
  const mine = buffs.filter(b => ids.has(b.abilityGameID) && b.targetID === monkId)
  // A buff whose first event is a removal was already up when the pull started.
  const active = new Set<number>()
  for (const id of ids) if (mine.find(b => b.abilityGameID === id)?.type === 'removebuff') active.add(id)
  const out: CdEvent[] = active.size ? [{ t: 0, kind: 'rate', rate: heartRate(active) }] : []
  for (const b of mine) {
    if (b.type === 'applybuff') active.add(b.abilityGameID)
    else if (b.type === 'removebuff') active.delete(b.abilityGameID)
    else continue
    out.push({ t: Math.max(0, b.timestamp - start), kind: 'rate', rate: heartRate(active) })
  }
  return out
}

// Number of targets carrying the monk's HoT over time, as a step series.
// A target whose first event is a removal had the HoT from before the pull.
function hotCount(buffs: WclEvent[], abilityId: number, start: number, durationMs: number): StepPoint[] {
  const events = buffs.filter(b => b.abilityGameID === abilityId && (b.type === 'applybuff' || b.type === 'removebuff'))
  const active = new Set<number>()
  const seen = new Set<number>()
  let initial = 0
  for (const e of events) {
    const t = e.targetID ?? -1
    if (!seen.has(t)) {
      seen.add(t)
      if (e.type === 'removebuff') initial++
    }
  }
  let count = initial
  const series: StepPoint[] = [{ t: 0, v: count }]
  for (const e of events) {
    const t = e.targetID ?? -1
    if (e.type === 'applybuff' && !active.has(t)) {
      active.add(t)
      count++
    } else if (e.type === 'removebuff') {
      if (active.has(t)) active.delete(t)
      count = Math.max(0, count - 1)
    } else continue
    series.push({ t: Math.max(0, Math.min(durationMs, e.timestamp - start)), v: count })
  }
  series.push({ t: durationMs, v: count })
  return series
}

function timeWeightedAvg(series: StepPoint[], durationMs: number): number {
  if (durationMs <= 0) return 0
  let sum = 0
  for (let i = 0; i < series.length - 1; i++) sum += series[i].v * (series[i + 1].t - series[i].t)
  return sum / durationMs
}

function manaStats(casts: WclEvent[], start: number, durationMs: number) {
  const series: StepPoint[] = []
  for (const c of casts) {
    const mana = c.classResources?.find(r => r.type === 0)
    if (!mana || !mana.max) continue
    series.push({ t: Math.max(0, c.timestamp - start), v: mana.amount / mana.max })
  }
  if (series.length === 0) return { startPct: 1, endPct: 1, minPct: 1, series }
  return {
    startPct: series[0].v,
    endPct: series[series.length - 1].v,
    minPct: Math.min(...series.map(p => p.v)),
    series,
  }
}

export function cooldown(p: PullAnalysis, key: string): CooldownResult | undefined {
  return p.cooldowns.find(c => c.key === key)
}
