import type { HealingEntry, HealingTableData } from '../wcl/types.js'
import { darkTheme, type Visualization } from './types.js'

interface Row {
  name: string
  effective: number
  overheal: number
  hps: number
  hits: number
  pctOverheal: number
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

export function healingBreakdown(table: HealingTableData): Visualization {
  const durationSec = table.totalTime / 1000

  const rows: Row[] = table.entries
    .filter((e: HealingEntry) => e.total > 0)
    .map((e: HealingEntry) => ({
      name: e.name,
      // WCL's `total` is already effective healing; overheal is reported separately.
      effective: e.total ?? 0,
      overheal: e.overheal ?? 0,
      hps: Math.round((e.total ?? 0) / durationSec),
      hits: e.hitCount + e.tickCount,
      pctOverheal: pctOf(e.overheal ?? 0, (e.total ?? 0) + (e.overheal ?? 0)),
    }))
    .sort((a, b) => b.effective - a.effective)
    .slice(0, 20)

  return {
    id: 'healing-breakdown',
    title: 'Healing by Ability',
    spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      height: Math.max(200, rows.length * 28),
      data: { values: rows },
      transform: [
        { fold: ['effective', 'overheal'], as: ['healType', 'value'] },
      ],
      mark: 'bar',
      encoding: {
        x: {
          field: 'value',
          type: 'quantitative',
          title: 'Healing',
          stack: 'zero',
          axis: { format: '~s' },
        },
        y: {
          field: 'name',
          type: 'nominal',
          sort: { field: 'effective', order: 'descending' },
          title: null,
        },
        color: {
          field: 'healType',
          type: 'nominal',
          scale: {
            domain: ['effective', 'overheal'],
            range: ['#4ade80', '#45475a'],
          },
          legend: { orient: 'top', title: null },
        },
        tooltip: [
          { field: 'name', type: 'nominal', title: 'Ability' },
          { field: 'effective', type: 'quantitative', title: 'Effective', format: ',.0f' },
          { field: 'overheal', type: 'quantitative', title: 'Overheal', format: ',.0f' },
          { field: 'pctOverheal', type: 'quantitative', title: 'OH %', format: 'd' },
          { field: 'hps', type: 'quantitative', title: 'HPS', format: ',.0f' },
          { field: 'hits', type: 'quantitative', title: 'Hits' },
        ],
      },
      config: darkTheme,
    },
  }
}
