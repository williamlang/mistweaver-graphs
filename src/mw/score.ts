import type { PullAnalysis } from './analyze.js'
import type { Grade } from './spells.js'

// A 0-100 performance score per pull, built only from things the Monk controls and the
// dashboard already grades. HPS, overheal and CPM are left out: they depend on the fight,
// the raid and the comp, so they say little about play on their own. Each metric goes
// through a curve whose anchors sit on its existing grade thresholds (85 at "good", 65
// at "could be better"), so a component's score agrees with its colour elsewhere.

export interface ScoreComponent {
  key: string
  name: string
  value: string  // the metric as shown, e.g. "82.4%"
  score: number  // 0..100
  weight: number // share of the total after renormalising, 0..1
  lost: number   // points this component cost the total
}

export interface PullScore {
  score: number
  components: ScoreComponent[]
}

type Curve = Array<[number, number]>

// Cast efficiency, on WoWAnalyzer's bands: 80% good, 65% average issue, 45% major issue.
const EFFICIENCY: Curve = [[0, 0], [0.45, 40], [0.65, 65], [0.8, 85], [0.9, 95], [1, 100]]
// Active time: 90% good, 80% could be better.
const ACTIVE: Curve = [[0.5, 0], [0.7, 40], [0.8, 65], [0.9, 85], [0.97, 100]]
// Mana left when the boss dies is healing never cast. A little is fine; half a bar is not.
const MANA_LEFT: Curve = [[0.1, 100], [0.25, 75], [0.4, 45], [0.6, 0]]

function curve(c: Curve, x: number): number {
  if (x <= c[0][0]) return c[0][1]
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i]
    if (x <= x1) {
      const [x0, y0] = c[i - 1]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return c[c.length - 1][1]
}

const WEIGHTS = { rem: 30, active: 25, cooldowns: 20, kick: 15, mana: 10 }

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export function scorePull(p: PullAnalysis): PullScore {
  // Each cooldown counts by how many casts the pull allowed, so holding a 3 minute
  // Revival through a 1 minute wipe costs less than sitting on Chi-Ji the whole time.
  const cdPossible = p.cooldowns.reduce((s, c) => s + Math.max(c.possible, c.casts.length), 0)
  const cdScore = cdPossible > 0
    ? p.cooldowns.reduce((s, c) => s + curve(EFFICIENCY, c.efficiency) * Math.max(c.possible, c.casts.length), 0) / cdPossible
    : 100
  const cdCasts = p.cooldowns.reduce((s, c) => s + c.casts.length, 0)

  const parts: Array<Omit<ScoreComponent, 'weight' | 'lost'> & { w: number }> = [
    { key: 'rem', name: 'Renewing Mist uptime', value: pct(p.rem.uptimePct), score: curve(EFFICIENCY, p.rem.uptimePct), w: WEIGHTS.rem },
    { key: 'active', name: 'Active time', value: pct(p.activeTimePct), score: curve(ACTIVE, p.activeTimePct), w: WEIGHTS.active },
    { key: 'cooldowns', name: 'Major cooldowns', value: `${cdCasts}/${Math.max(cdCasts, Math.round(cdPossible))} casts`, score: cdScore, w: WEIGHTS.cooldowns },
    { key: 'kick', name: `${p.kick.name} uptime`, value: pct(p.kick.uptimePct), score: curve(EFFICIENCY, p.kick.uptimePct), w: WEIGHTS.kick },
  ]
  // On a wipe the mana you had left is not a mistake, so it only counts on kills.
  if (p.kill) parts.push({ key: 'mana', name: 'Mana left at the kill', value: pct(p.mana.endPct), score: curve(MANA_LEFT, p.mana.endPct), w: WEIGHTS.mana })

  const total = parts.reduce((s, c) => s + c.w, 0)
  const components = parts.map(({ w, ...c }) => ({ ...c, weight: w / total, lost: ((100 - c.score) * w) / total }))
  return { score: components.reduce((s, c) => s + c.score * c.weight, 0), components }
}

export function gradeScore(score: number): Grade {
  if (score >= 85) return 'good'
  if (score >= 65) return 'ok'
  return 'bad'
}
