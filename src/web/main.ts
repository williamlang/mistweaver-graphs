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

// Copy buttons (NSRT reminders): clipboard API, with a textarea fallback for browsers
// that block it, and a short "Copied" confirmation on the button.
document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-copy]')
  if (!button) return
  void copyText(button.dataset.copy ?? '').then(ok => {
    const label = button.textContent
    button.textContent = ok ? 'Copied' : 'Copy failed'
    button.classList.toggle('copied', ok)
    setTimeout(() => { button.textContent = label; button.classList.remove('copied') }, 1500)
  })
})

// Sortable tables: clicking a header sorts by that column's data-sort values, highest
// first unless the header says data-first="asc"; clicking it again flips the order.
// Rows are sorted within each group (the run of rows after a .boss-row), so the
// pull-by-pull table keeps its bosses together. Cells with an empty data-sort go last.
document.addEventListener('click', event => {
  const th = (event.target as HTMLElement).closest<HTMLTableCellElement>('table.sortable th')
  if (!th) return
  const table = th.closest('table')!
  const col = th.cellIndex
  const current = th.getAttribute('aria-sort')
  const asc = current ? current === 'descending' : th.dataset.first === 'asc'
  table.querySelectorAll('th[aria-sort]').forEach(h => h.removeAttribute('aria-sort'))
  th.setAttribute('aria-sort', asc ? 'ascending' : 'descending')

  const key = (row: HTMLTableRowElement) => {
    const v = row.cells[col]?.dataset.sort
    return v === undefined || v === '' ? null : Number(v)
  }
  const tbody = table.tBodies[0]
  const groups: HTMLTableRowElement[][] = [[]]
  for (const row of [...tbody.rows]) {
    if (row.classList.contains('boss-row')) groups.push([row])
    else groups[groups.length - 1].push(row)
  }
  for (const group of groups) {
    const head = group[0]?.classList.contains('boss-row') ? group.shift()! : null
    group.sort((a, b) => {
      const x = key(a)
      const y = key(b)
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return asc ? x - y : y - x
    })
    if (head) tbody.appendChild(head)
    group.forEach(row => tbody.appendChild(row))
  }
})

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

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
