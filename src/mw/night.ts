import type { Report, Fight, Actor, WclEvent, DeathEntry } from '../wcl/types.js'
import { fetchReport, fetchEvents, fetchHealingTables, fetchDeaths } from '../wcl/client.js'
import { analyzePull, type PullAnalysis } from './analyze.js'
import { TRACKED_BUFFS } from './spells.js'
import { CHARACTER_NAME } from '../config.js'

// Reports can be live-logged, so the fight list goes stale quickly. A fight that
// appears in the list has ended, so its analysis never changes and is cached forever.
const REPORT_TTL_MS = 30_000
const reportCache = new Map<string, { at: number; report: Report }>()
const pullCache = new Map<string, PullAnalysis>()

export async function getReport(code: string): Promise<Report> {
  const hit = reportCache.get(code)
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.report
  const report = await fetchReport(code)
  reportCache.set(code, { at: Date.now(), report })
  return report
}

export function getMonks(report: Report): Actor[] {
  return report.masterData.actors.filter(a => a.type === 'Player' && a.subType === 'Monk')
}

export function resolveMonk(report: Report, playerID: number | null): Actor | null {
  const monks = getMonks(report)
  if (monks.length === 0) return null
  if (playerID) return monks.find(m => m.id === playerID) ?? monks[0]
  if (CHARACTER_NAME) {
    const mine = monks.find(m => m.name.toLowerCase() === CHARACTER_NAME.toLowerCase())
    if (mine) return mine
  }
  return monks[0]
}

// Boss pulls the monk took part in, in report order.
export function bossPulls(report: Report, monkId: number): Fight[] {
  return report.fights.filter(f => f.encounterID > 0 && f.friendlyPlayers?.includes(monkId))
}

// WarcraftLogs' "ignore after X deaths": the pull ends at its Nth death, kill or wipe.
// This matches the API's `wipeCutoff`, which the healing tables are fetched with.
function cutAtDeath(fight: Fight, deaths: DeathEntry[], cutoff: number | null): Fight {
  if (!cutoff) return fight
  const times = deaths.filter(d => d.fight === fight.id).map(d => d.timestamp).sort((a, b) => a - b)
  if (times.length < cutoff) return fight
  return { ...fight, endTime: Math.min(fight.endTime, times[cutoff - 1]) }
}

function byFight(events: WclEvent[]): Map<number, WclEvent[]> {
  const out = new Map<number, WclEvent[]>()
  for (const e of events) {
    let list = out.get(e.fight)
    if (!list) out.set(e.fight, (list = []))
    list.push(e)
  }
  return out
}

export async function loadPulls(code: string, fights: Fight[], monkId: number, cutoff: number | null = null): Promise<PullAnalysis[]> {
  const key = (f: Fight) => `${code}:${monkId}:${f.id}:${cutoff ?? 0}`
  const missing = fights.filter(f => !pullCache.has(key(f)))

  if (missing.length > 0) {
    const ids = missing.map(f => f.id)
    const start = Math.min(...missing.map(f => f.startTime))
    const end = Math.max(...missing.map(f => f.endTime))

    const [casts, buffs, info, tables, deaths, healsOn, damageOn] = await Promise.all([
      fetchEvents(code, 'Casts', ids, start, end, { sourceID: monkId, includeResources: true }),
      // Buffs filtered by sourceID only returns auras *on* that actor, which misses the
      // HoTs the monk puts on the raid. Filter by ability and pick the source ourselves.
      fetchEvents(code, 'Buffs', ids, start, end, { filterExpression: `ability.id IN (${TRACKED_BUFFS.join(', ')})` }),
      fetchEvents(code, 'CombatantInfo', ids, start, end, { sourceID: monkId }),
      fetchHealingTables(code, ids, monkId, cutoff),
      fetchDeaths(code, ids),
      // Heals and damage landing on the monk carry their position (resourceActor 2),
      // sampled every ~200ms — dense enough to tell moving from standing.
      fetchEvents(code, 'Healing', ids, start, end, { targetID: monkId, includeResources: true }),
      fetchEvents(code, 'DamageTaken', ids, start, end, { targetID: monkId, includeResources: true }),
    ])

    const castsBy = byFight(casts)
    const buffsBy = byFight(buffs)
    const infoBy = byFight(info)
    const positionsBy = byFight([...healsOn, ...damageOn])

    for (const fight of missing) {
      const table = tables.get(fight.id)
      if (!table) continue
      pullCache.set(key(fight), analyzePull({
        fight: cutAtDeath(fight, deaths, cutoff),
        fullEndTime: fight.endTime,
        cutoff,
        monkId,
        casts: castsBy.get(fight.id) ?? [],
        buffs: buffsBy.get(fight.id) ?? [],
        combatantInfo: infoBy.get(fight.id)?.find(e => e.sourceID === monkId),
        positions: positionsBy.get(fight.id) ?? [],
        table,
        deaths,
      }))
    }
  }

  return fights.map(f => pullCache.get(key(f))).filter((p): p is PullAnalysis => !!p)
}
