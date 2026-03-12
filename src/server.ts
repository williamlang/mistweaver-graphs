import { Hono } from 'hono'
import type { Context } from 'hono'
import { loadToken, exchangeCode, saveToken, getAuthUrl } from './auth.js'
import { fetchReport } from './wcl/client.js'
import {
  renderAuthPage,
  renderHomePage,
  renderReportPage,
  renderFightPage,
  renderErrorPage,
} from './dashboard/render.js'

export const app = new Hono()

function isAuthenticated(c: Context): boolean {
  return !!loadToken()
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

// Home — show auth prompt or log code form
app.get('/', c => {
  if (!loadToken()) return c.html(renderAuthPage(getAuthUrl()))
  return c.html(renderHomePage())
})

// Report overview with fight list
app.get('/report/:code', async c => {
  if (!isAuthenticated(c)) return c.redirect('/')

  const { code } = c.req.param()
  try {
    const report = await fetchReport(code)
    return c.html(await renderReportPage(code, report))
  } catch (err) {
    return c.html(renderErrorPage(String(err), '/'), 500)
  }
})

// Fight dashboard — fightId = number or "all"
app.get('/report/:code/fight/:fightId', async c => {
  if (!isAuthenticated(c)) return c.redirect('/')

  const { code, fightId } = c.req.param()
  try {
    const report = await fetchReport(code)
    const id = fightId === 'all' ? null : parseInt(fightId, 10)
    if (fightId !== 'all' && isNaN(id!)) {
      return c.html(renderErrorPage('Invalid fight ID.', `/report/${code}`), 400)
    }
    return c.html(await renderFightPage(code, report, id))
  } catch (err) {
    return c.html(renderErrorPage(String(err), `/report/${code}`), 500)
  }
})
