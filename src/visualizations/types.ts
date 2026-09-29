// Each visualization is a function that takes processed data and returns a VegaSpec.
// The spec is serialized to JSON by the server and rendered client-side via vega-embed.
export interface VegaSpec {
  $schema: string
  [key: string]: unknown
}

export interface Visualization {
  id: string
  title: string
  badge?: string  // optional stat shown next to the card title
  spec: VegaSpec
}

// Dark theme config shared across all visualizations
export const darkTheme = {
  background: 'transparent',
  axis: {
    labelColor: '#cdd6f4',
    titleColor: '#cdd6f4',
    gridColor: '#313244',
    domainColor: '#45475a',
    tickColor: '#45475a',
  },
  legend: {
    labelColor: '#cdd6f4',
    titleColor: '#cdd6f4',
  },
  title: {
    color: '#cdd6f4',
  },
  view: {
    stroke: 'transparent',
  },
}

// Series and status colors, validated for the dark card surface (#181825) with the
// dataviz palette checker: lightness band, CVD separation and 3:1 contrast all pass.
export const COLORS = {
  kill: '#3987e5',
  wipe: '#d95926',
  rem: '#16a34a',
  env: '#3b82f6',
  good: '#0ca30c',
  warning: '#fab219',
  critical: '#d03b3b',
  muted: '#45475a',
  ink: '#cdd6f4',
  inkMuted: '#a6adc8',
}

export const VEGA_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json'
