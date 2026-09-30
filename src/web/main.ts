import { route } from './router.js'
import { getSettings, saveSettings, getAccessToken, clearToken } from '../settings.js'
import { renderSettingsPage } from '../dashboard/render.js'

// vega-embed is loaded from the CDN in index.html.
declare const vegaEmbed: (el: Element, spec: unknown, opts: Record<string, unknown>) => Promise<unknown>

const app = document.getElementById('app')!

// Each navigation gets a number; a slow page that finishes after the user has moved on
// is thrown away instead of overwriting the newer one.
let navigation = 0

async function render(): Promise<void> {
  const current = ++navigation
  app.innerHTML = '<div class="loading">Loading from WarcraftLogs…</div>'
  const result = await route(location.hash)
  if (current !== navigation) return
  if ('redirect' in result) {
    location.replace(`#${result.redirect}`)
    return
  }
  show(result.html)
}

function show(html: string): void {
  app.innerHTML = html
  window.scrollTo(0, 0)
  app.querySelectorAll<HTMLElement>('[data-spec]').forEach(el => {
    const spec = JSON.parse(el.dataset.spec!)
    vegaEmbed(el, spec, { actions: false, renderer: 'svg' }).catch(console.error)
  })
}

// Forms that navigate (paste a URL, add reports) carry data-route. Their fields become
// the route's query string, like a GET form would on a server.
document.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement
  if (form.dataset.route) {
    event.preventDefault()
    const qs = new URLSearchParams()
    new FormData(form).forEach((value, key) => qs.append(key, String(value)))
    location.hash = `${form.dataset.route}?${qs.toString()}`
  } else if (form.dataset.action === 'save-settings') {
    event.preventDefault()
    void saveFromForm(form)
  }
})

document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action="forget-settings"]')
  if (!target) return
  saveSettings({ ...getSettings(), clientId: '', clientSecret: '' })
  clearToken()
  show(renderSettingsPage({ text: 'Credentials removed from this browser.', ok: true }))
})

// Save, then prove the credentials work by fetching a token before leaving the page.
async function saveFromForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form)
  const field = (k: string) => String(data.get(k) ?? '').trim()
  saveSettings({
    clientId: field('clientId'),
    clientSecret: field('clientSecret'),
    characterName: field('characterName'),
    deathCutoff: parseInt(field('deathCutoff'), 10) || null,
  })
  try {
    await getAccessToken()
    // Already on the home route (first run shows Settings there): no hashchange will fire.
    if (location.hash === '#/' || location.hash === '') void render()
    else location.hash = '#/'
  } catch (err) {
    show(renderSettingsPage({ text: err instanceof Error ? err.message : String(err), ok: false }))
  }
}

window.addEventListener('hashchange', () => void render())
void render()
