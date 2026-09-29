import { Hono } from 'hono'
import { loadToken, exchangeCode, saveToken, getAuthUrl } from './auth.js'
import { parseLogInput } from './wcl/url.js'
import { DEFAULT_DEATH_CUTOFF } from './config.js'
import { getReport, resolveMonk, bossPulls } from './mw/night.js'
import { parseCodes } from './mw/multi.js'
import {
  renderAuthPage,
  renderHomePage,
  renderNightPage,
  renderPullPage,
  renderBossPage,
  renderMultiPage,
  renderMultiBossPage,
  renderErrorPage,
} from './dashboard/render.js'

export const app = new Hono()

function playerParam(raw: string | undefined): number | null {
  return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null
}

// ?cutoff=N ignores everything after the Nth death; 0 turns it off; absent = .env default.
function cutoffParam(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_DEATH_CUTOFF
  return parseInt(raw, 10) || null
}

// OAuth callback
app.get('/callback', async c => {
  const error = c.req.query('error')
  if (error) return c.html(renderErrorPage(`WarcraftLogs denied access: ${error}`), 400)

  const code = c.req.query('code')
  if (!code) return c.html(renderErrorPage('No authorization code received.'), 400)

  try {
    const tokenData = await exchangeCode(code)
    saveToken(tokenData)
    return c.redirect('/')
  } catch (err) {
    return c.html(renderErrorPage(String(err)), 500)
  }
})

// Home — show auth prompt or log URL form
app.get('/', c => {
  if (!loadToken()) return c.html(renderAuthPage(getAuthUrl()))
  return c.html(renderHomePage())
})

// Form target: turn pasted WCL URLs into a page. One report opens its night (or pull);
// several, or an "add reports" submit, open the by-boss comparison.
app.get('/go', async c => {
  const lines = (c.req.query('log') ?? '').split(/[\s,]+/).filter(Boolean)
  const parsedAll = lines.map(parseLogInput)
  if (parsedAll.some(p => !p) || parsedAll.length === 0) {
    return c.html(renderErrorPage("That doesn't look like a WarcraftLogs report URL or code."), 400)
  }
  const existing = parseCodes(c.req.query('logs'))
  const codes = [...new Set([...existing, ...parsedAll.map(p => p!.code)])]
  if (codes.length > 1) {
    const name = c.req.query('name')
    const cutoff = c.req.query('cutoff')
    const qs = new URLSearchParams({ logs: codes.join(',') })
    if (name) qs.set('name', name)
    if (cutoff) qs.set('cutoff', cutoff)
    return c.redirect(`/multi?${qs.toString().replace(/%2C/g, ',')}`)
  }

  const parsed = parsedAll[0]!

  const player = parsed.source ? `?player=${parsed.source}` : ''
  if (parsed.fight === null) return c.redirect(`/report/${parsed.code}${player}`)
  if (parsed.fight === 'last') {
    try {
      const report = await getReport(parsed.code)
      const monk = resolveMonk(report, parsed.source)
      const pulls = monk ? bossPulls(report, monk.id) : []
      const last = pulls.at(-1)
      if (!last) return c.redirect(`/report/${parsed.code}${player}`)
      return c.redirect(`/report/${parsed.code}/fight/${last.id}${player}`)
    } catch (err) {
      return c.html(renderErrorPage(String(err), '/'), 500)
    }
  }
  return c.redirect(`/report/${parsed.code}/fight/${parsed.fight}${player}`)
})

// The night: every boss pull, summarized and trended
app.get('/report/:code', async c => {
  if (!loadToken()) return c.redirect('/')

  const { code } = c.req.param()
  try {
    return c.html(await renderNightPage(code, playerParam(c.req.query('player')), cutoffParam(c.req.query('cutoff'))))
  } catch (err) {
    return c.html(renderErrorPage(String(err), '/'), 500)
  }
})

// One pull in detail
app.get('/report/:code/fight/:fightId', async c => {
  if (!loadToken()) return c.redirect('/')

  const { code, fightId } = c.req.param()
  const player = playerParam(c.req.query('player'))
  if (fightId === 'all') return c.redirect(`/report/${code}${player ? `?player=${player}` : ''}`)
  if (!/^\d+$/.test(fightId)) return c.html(renderErrorPage('Invalid fight ID.', `/report/${code}`), 400)

  try {
    return c.html(await renderPullPage(code, parseInt(fightId, 10), player, cutoffParam(c.req.query('cutoff'))))
  } catch (err) {
    return c.html(renderErrorPage(String(err), `/report/${code}`), 500)
  }
})

// Every pull on one boss: where in the fight the metrics dip, by phase and by time
app.get('/report/:code/boss/:encounterId/:difficulty', async c => {
  if (!loadToken()) return c.redirect('/')

  const { code, encounterId, difficulty } = c.req.param()
  if (!/^\d+$/.test(encounterId) || !/^\d+$/.test(difficulty)) {
    return c.html(renderErrorPage('Invalid boss.', `/report/${code}`), 400)
  }
  try {
    return c.html(await renderBossPage(code, parseInt(encounterId, 10), parseInt(difficulty, 10), playerParam(c.req.query('player')), cutoffParam(c.req.query('cutoff'))))
  } catch (err) {
    return c.html(renderErrorPage(String(err), `/report/${code}`), 500)
  }
})

// Several reports, analysed boss by boss. The Monk is matched by name across reports.
app.get('/multi', async c => {
  if (!loadToken()) return c.redirect('/')
  const codes = parseCodes(c.req.query('logs'))
  try {
    return c.html(await renderMultiPage(codes, c.req.query('name') ?? null, cutoffParam(c.req.query('cutoff'))))
  } catch (err) {
    return c.html(renderErrorPage(String(err), '/'), 500)
  }
})

app.get('/multi/boss/:encounterId/:difficulty', async c => {
  if (!loadToken()) return c.redirect('/')
  const { encounterId, difficulty } = c.req.param()
  if (!/^\d+$/.test(encounterId) || !/^\d+$/.test(difficulty)) return c.html(renderErrorPage('Invalid boss.', '/'), 400)
  const codes = parseCodes(c.req.query('logs'))
  try {
    return c.html(await renderMultiBossPage(codes, c.req.query('name') ?? null, cutoffParam(c.req.query('cutoff')),
      parseInt(encounterId, 10), parseInt(difficulty, 10)))
  } catch (err) {
    return c.html(renderErrorPage(String(err), '/'), 500)
  }
})
