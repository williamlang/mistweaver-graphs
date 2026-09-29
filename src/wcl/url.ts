// Accepts a bare report code or any WarcraftLogs report URL, e.g.
//   https://www.warcraftlogs.com/reports/AbC123xyz?fight=12&type=healing&source=5
//   https://www.warcraftlogs.com/reports/AbC123xyz#fight=last
export interface ParsedLog {
  code: string
  fight: number | 'last' | null
  source: number | null
}

export function parseLogInput(input: string): ParsedLog | null {
  const text = input.trim()
  if (/^[A-Za-z0-9:]{8,40}$/.test(text)) return { code: text, fight: null, source: null }

  const m = text.match(/reports\/([A-Za-z0-9:]+)/)
  if (!m) return null
  // WCL uses both ?fight= and #fight= depending on the page.
  const params = new URLSearchParams(text.split(/[?#]/).slice(1).join('&'))
  const fightParam = params.get('fight')
  const fight = fightParam === 'last' ? 'last' : fightParam && /^\d+$/.test(fightParam) ? Number(fightParam) : null
  const sourceParam = params.get('source')
  return { code: m[1], fight, source: sourceParam && /^\d+$/.test(sourceParam) ? Number(sourceParam) : null }
}
