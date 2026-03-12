// Each visualization is a function that takes processed data and returns a VegaSpec.
// The spec is serialized to JSON by the server and rendered client-side via vega-embed.
export interface VegaSpec {
  $schema: string
  [key: string]: unknown
}

export interface Visualization {
  id: string
  title: string
  spec: VegaSpec
}

// Dark theme config shared across all visualizations
export const darkTheme = {
  background: '#1e1e2e',
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
