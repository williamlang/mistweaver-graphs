import type { HealingEntry, HealingTableData } from '../wcl/types.js'
import { darkTheme, type Visualization } from './types.js'

interface Row {
  name: string
  casts: number
  hitsPerCast: number
  avgEffectivePerCast: number
  avgOverhealPerCast: number
  pctOverheal: number
}

export function castBreakdown(table: HealingTableData): Visualization {
  const rows: Row[] = table.entries
    .filter((e: HealingEntry) => e.casts > 0)
    .map((e: HealingEntry) => ({
      name: e.name,
      casts: e.casts,
      hitsPerCast: e.casts > 0 ? Math.round((e.hitCount / e.casts) * 10) / 10 : 0,
      avgEffectivePerCast: e.casts > 0 ? Math.round((e.total - e.overheal) / e.casts) : 0,
      avgOverhealPerCast: e.casts > 0 ? Math.round(e.overheal / e.casts) : 0,
      pctOverheal: e.total > 0 ? Math.round((e.overheal / e.total) * 100) : 0,
    }))
    .sort((a, b) => b.casts - a.casts)

  return {
    id: 'cast-breakdown',
    title: 'Cast Counts & Efficiency',
    spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: Math.max(200, rows.length * 28),
      data: { values: rows },
      mark: 'bar',
      encoding: {
        x: {
          field: 'casts',
          type: 'quantitative',
          title: 'Casts',
        },
        y: {
          field: 'name',
          type: 'nominal',
          sort: { field: 'casts', order: 'descending' },
          title: null,
        },
        color: {
          field: 'avgEffectivePerCast',
          type: 'quantitative',
          scale: { scheme: 'greens' },
          legend: { title: 'Avg Eff/Cast', format: '~s' },
        },
        tooltip: [
          { field: 'name', type: 'nominal', title: 'Ability' },
          { field: 'casts', type: 'quantitative', title: 'Casts' },
          { field: 'hitsPerCast', type: 'quantitative', title: 'Hits/Cast' },
          { field: 'avgEffectivePerCast', type: 'quantitative', title: 'Avg Eff/Cast', format: ',.0f' },
          { field: 'avgOverhealPerCast', type: 'quantitative', title: 'Avg OH/Cast', format: ',.0f' },
          { field: 'pctOverheal', type: 'quantitative', title: 'OH %', format: 'd' },
        ],
      },
      config: darkTheme,
    },
  }
}
