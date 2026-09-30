import { parseLogInput } from '../wcl/url.js'
import { getReport, resolveMonk, bossPulls } from '../mw/night.js'
import { parseCodes } from '../mw/multi.js'
import { getSettings, hasCredentials } from '../settings.js'
import {
  renderHomePage,
  renderSettingsPage,
  renderNightPage,
  renderPullPage,
  renderBossPage,
  renderMultiPage,
  renderMultiBossPage,
  renderErrorPage,
} from '../dashboard/render.js'

// Routes live in the URL hash (#/report/CODE?player=5) because a static host like
// GitHub Pages can't serve arbitrary paths. A route either renders a page or redirects.
export type RouteResult = { html: string } | { redirect: string }

function playerParam(raw: string | null): number | null {
  return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null
}

// ?cutoff=N ignores everything after the Nth death; 0 turns it off; absent = the Settings default.
function cutoffParam(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return getSettings().deathCutoff
  return parseInt(raw, 10) || null
}

const html = (h: string): RouteResult => ({ html: h })
const redirect = (to: string): RouteResult => ({ redirect: to })

export async function route(hash: string): Promise<RouteResult> {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, search = ''] = raw.split('?')
  const q = new URLSearchParams(search)
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)

  if (parts[0] === 'settings') return html(renderSettingsPage())
  if (!hasCredentials()) {
    return html(renderSettingsPage({ text: 'Add your WarcraftLogs API client to get started.', ok: false }))
  }

  try {
    if (parts.length === 0) return html(renderHomePage())
    if (parts[0] === 'go') return await go(q)

    const player = playerParam(q.get('player'))
    const cutoff = cutoffParam(q.get('cutoff'))

    if (parts[0] === 'report' && parts[1]) {
      const code = parts[1]
      if (parts.length === 2) return html(await renderNightPage(code, player, cutoff))
      if (parts[2] === 'fight' && parts[3] === 'all') return redirect(`/report/${code}${player ? `?player=${player}` : ''}`)
      if (parts[2] === 'fight' && /^\d+$/.test(parts[3] ?? '')) {
        return html(await renderPullPage(code, parseInt(parts[3], 10), player, cutoff))
      }
      if (parts[2] === 'boss' && /^\d+$/.test(parts[3] ?? '') && /^\d+$/.test(parts[4] ?? '')) {
        return html(await renderBossPage(code, parseInt(parts[3], 10), parseInt(parts[4], 10), player, cutoff))
      }
    }

    if (parts[0] === 'multi') {
      const codes = parseCodes(q.get('logs') ?? '')
      const name = q.get('name')
      if (parts.length === 1) return html(await renderMultiPage(codes, name, cutoff))
      if (parts[1] === 'boss' && /^\d+$/.test(parts[2] ?? '') && /^\d+$/.test(parts[3] ?? '')) {
        return html(await renderMultiBossPage(codes, name, cutoff, parseInt(parts[2], 10), parseInt(parts[3], 10)))
      }
    }

    return html(renderErrorPage('Page not found.', '#/'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'NOT_CONFIGURED') return html(renderSettingsPage())
    return html(renderErrorPage(message, '#/'))
  }
}

// Form target: turn pasted WCL URLs into a page. One report opens its night (or pull);
// several, or an "add reports" submit, open the by-boss comparison.
async function go(q: URLSearchParams): Promise<RouteResult> {
  const lines = (q.get('log') ?? '').split(/[\s,]+/).filter(Boolean)
  const parsedAll = lines.map(parseLogInput)
  if (parsedAll.length === 0 || parsedAll.some(p => !p)) {
    return html(renderErrorPage("That doesn't look like a WarcraftLogs report URL or code.", '#/'))
  }
  const codes = [...new Set([...parseCodes(q.get('logs') ?? ''), ...parsedAll.map(p => p!.code)])]
  if (codes.length > 1) {
    const qs = new URLSearchParams({ logs: codes.join(',') })
    const name = q.get('name')
    const cutoff = q.get('cutoff')
    if (name) qs.set('name', name)
    if (cutoff) qs.set('cutoff', cutoff)
    return redirect(`/multi?${qs.toString().replace(/%2C/g, ',')}`)
  }

  const parsed = parsedAll[0]!
  const player = parsed.source ? `?player=${parsed.source}` : ''
  if (parsed.fight === null) return redirect(`/report/${parsed.code}${player}`)
  if (parsed.fight === 'last') {
    const report = await getReport(parsed.code)
    const monk = resolveMonk(report, parsed.source)
    const last = monk ? bossPulls(report, monk.id).at(-1) : undefined
    return redirect(last ? `/report/${parsed.code}/fight/${last.id}${player}` : `/report/${parsed.code}${player}`)
  }
  return redirect(`/report/${parsed.code}/fight/${parsed.fight}${player}`)
}
