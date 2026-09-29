import type { Report, Actor } from '../wcl/types.js'
import type { PullAnalysis } from './analyze.js'
import { getReport, getMonks, bossPulls, loadPulls } from './night.js'
import { CHARACTER_NAME } from '../config.js'

export interface Source {
  code: string
  report: Report
  monk: Actor | null // null when the chosen Monk isn't in this report
}

export interface MultiLoad {
  sources: Source[]
  monkName: string | null
  monkNames: string[] // every Monk seen across the reports, most reports first
  pulls: PullAnalysis[] // every boss pull, across reports, in real-time order
}

// Actor ids are local to each report, so across reports the Monk is matched by name:
// the requested one, else WCL_CHARACTER_NAME, else whoever appears in the most reports.
export async function loadMulti(codes: string[], name: string | null, cutoff: number | null): Promise<MultiLoad> {
  const reports = await Promise.all(codes.map(code => getReport(code)))

  const seen = new Map<string, { name: string; count: number }>()
  for (const r of reports) {
    for (const n of new Set(getMonks(r).map(m => m.name))) {
      const k = n.toLowerCase()
      const e = seen.get(k) ?? { name: n, count: 0 }
      e.count++
      seen.set(k, e)
    }
  }
  const monkNames = [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map(e => e.name)

  const wanted = [name, CHARACTER_NAME].find(n => n && seen.has(n.toLowerCase()))
  const monkName = wanted ? seen.get(wanted.toLowerCase())!.name : monkNames[0] ?? null

  const sources: Source[] = reports.map((report, i) => ({
    code: codes[i],
    report,
    monk: monkName ? getMonks(report).find(m => m.name.toLowerCase() === monkName.toLowerCase()) ?? null : null,
  }))

  const loaded = await Promise.all(sources.map(s =>
    s.monk ? loadPulls(s.code, s.report, bossPulls(s.report, s.monk.id), s.monk.id, cutoff) : Promise.resolve([]),
  ))
  const pulls = loaded.flat().sort((a, b) => (a.reportStartTime + a.startMs) - (b.reportStartTime + b.startMs))

  return { sources, monkName, monkNames, pulls }
}

export function pullKey(p: PullAnalysis): string {
  return `${p.reportCode}:${p.fightId}`
}

// "Sep 28" for a report, from its start time.
export function nightLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Reports from the URL list or pasted text: dedupe, keep order.
export function parseCodes(raw: string | undefined): string[] {
  const out: string[] = []
  for (const c of (raw ?? '').split(/[\s,]+/)) if (/^[A-Za-z0-9:]{8,40}$/.test(c) && !out.includes(c)) out.push(c)
  return out
}
