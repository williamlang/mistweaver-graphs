import type { HealingEntry, HealingTableData } from '../wcl/types.js'
import { darkTheme, type Visualization } from './types.js'

interface Row {
  name: string
  hits: number
  critPct: number
  avgEffectivePerHit: number
  pctOverheal: number
}

export function castBreakdown(table: HealingTableData): Visualization {
  const rows: Row[] = table.entries
    .filter((e: HealingEntry) => e.hitCount > 0)
    .map((e: HealingEntry) => {
      const totalHits = e.hitCount + e.tickCount
      const effective = e.total ?? 0 // WCL's `total` already excludes overheal
      return {
        name: e.name,
        hits: totalHits,
        critPct: totalHits > 0 ? Math.round((e.critHitCount / totalHits) * 100) : 0,
        avgEffectivePerHit: totalHits > 0 ? Math.round(effective / totalHits) : 0,
        pctOverheal: effective + (e.overheal ?? 0) > 0 ? Math.round(((e.overheal ?? 0) / (effective + (e.overheal ?? 0))) * 100) : 0,
      }
    })
    .sort((a, b) => b.hits - a.hits)

  return {
    id: 'cast-breakdown',
    title: 'Hits & Efficiency',
    spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: Math.max(200, rows.length * 28),
      data: { values: rows },
      mark: 'bar',
      encoding: {
        x: {
          field: 'hits',
          type: 'quantitative',
          title: 'Hits',
        },
        y: {
          field: 'name',
          type: 'nominal',
          sort: { field: 'hits', order: 'descending' },
          title: null,
        },
        color: {
          field: 'avgEffectivePerHit',
          type: 'quantitative',
          scale: { scheme: 'greens' },
          legend: { title: 'Avg Eff/Hit', format: '~s' },
        },
        tooltip: [
          { field: 'name', type: 'nominal', title: 'Ability' },
          { field: 'hits', type: 'quantitative', title: 'Hits' },
          { field: 'critPct', type: 'quantitative', title: 'Crit %', format: 'd' },
          { field: 'avgEffectivePerHit', type: 'quantitative', title: 'Avg Eff/Hit', format: ',.0f' },
          { field: 'pctOverheal', type: 'quantitative', title: 'OH %', format: 'd' },
        ],
      },
      config: darkTheme,
    },
  }
}
