import type { PullAnalysis } from './analyze.js'

// Pulls shorter than this (instant resets, pre-pull deaths) are listed but kept out of
// averages, where their tiny denominators would swing every rate.
export const MIN_JUDGED_PULL_MS = 20_000

export interface Summary {
  pulls: number
  judged: number
  kills: number
  timeMs: number
  remUptime: number
  remCappedMs: number
  remCpm: number
  remAvg: number
  remCoverage: number
  kickUptime: number
  kickIdleMs: number
  cpm: number
  activeTime: number
  hps: number
  overhealPct: number
  monkDeaths: number
}

// Duration-weighted, so a 6 minute kill counts for more than a 40 second wipe.
export function summarize(all: PullAnalysis[]): Summary {
  const pulls = all.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const timeMs = pulls.reduce((s, p) => s + p.durationMs, 0)
  const w = (f: (p: PullAnalysis) => number) =>
    timeMs > 0 ? pulls.reduce((s, p) => s + f(p) * p.durationMs, 0) / timeMs : 0
  const effective = pulls.reduce((s, p) => s + p.healing.effective, 0)
  const overheal = pulls.reduce((s, p) => s + p.healing.overheal, 0)
  const kickIdleMs = pulls.reduce((s, p) => s + p.kick.idleMs, 0)
  const casts = pulls.reduce((s, p) => s + p.castCount, 0)

  return {
    pulls: all.length,
    judged: pulls.length,
    kills: all.filter(p => p.kill).length,
    timeMs: all.reduce((s, p) => s + p.durationMs, 0),
    remUptime: w(p => p.rem.uptimePct),
    remCappedMs: pulls.reduce((s, p) => s + p.rem.cappedMs, 0),
    remCpm: timeMs > 0 ? pulls.reduce((s, p) => s + p.rem.casts.length, 0) / (timeMs / 60000) : 0,
    remAvg: w(p => p.remAvg),
    remCoverage: w(p => p.remCoverage),
    kickUptime: timeMs > 0 ? 1 - kickIdleMs / timeMs : 0,
    kickIdleMs,
    cpm: timeMs > 0 ? casts / (timeMs / 60000) : 0,
    activeTime: w(p => p.activeTimePct),
    hps: timeMs > 0 ? effective / (timeMs / 1000) : 0,
    overhealPct: effective + overheal > 0 ? overheal / (effective + overheal) : 0,
    monkDeaths: all.filter(p => p.monkDied).length,
  }
}

export interface BossGroup {
  key: string
  name: string
  difficulty: number | null
  pulls: PullAnalysis[]
}

// Pulls grouped by encounter and difficulty, in the order each boss was first pulled.
export function groupByBoss(pulls: PullAnalysis[]): BossGroup[] {
  const groups = new Map<string, BossGroup>()
  for (const p of pulls) {
    const key = `${p.encounterID}:${p.difficulty ?? 0}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, name: p.name, difficulty: p.difficulty, pulls: [] }))
    g.pulls.push(p)
  }
  return [...groups.values()]
}

export function difficultyName(d: number | null): string {
  switch (d) {
    case 1: return 'LFR'
    case 3: return 'Normal'
    case 4: return 'Heroic'
    case 5: return 'Mythic'
    case 10: return 'M+'
    default: return ''
  }
}
