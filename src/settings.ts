// Everything the app needs to know about the viewer lives in their own browser.
// The page is static and public, so nothing here is ever embedded in the site: the
// WarcraftLogs client ID and secret are typed in on the settings page, stored in
// localStorage, and only ever sent to WarcraftLogs' token endpoint.

export const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token'
// Client-credentials tokens only work with the public ("client") endpoint, so private
// reports are out of reach without a user login.
export const WCL_API_URL = 'https://www.warcraftlogs.com/api/v2/client'
export const WCL_CLIENTS_URL = 'https://www.warcraftlogs.com/api/clients'

export interface Settings {
  clientId: string
  clientSecret: string
  characterName: string // picks you when a report has several Monks
  deathCutoff: number | null // default "ignore after N deaths"; null = off
}

const SETTINGS_KEY = 'mwg.settings'
const TOKEN_KEY = 'mwg.token'

// localStorage can throw (private windows, blocked storage), so reads and writes are guarded.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: settings last for this page load only.
  }
}

let memory: Settings | null = null

export function getSettings(): Settings {
  memory ??= { clientId: '', clientSecret: '', characterName: '', deathCutoff: null, ...read<Settings>(SETTINGS_KEY) }
  return memory
}

export function saveSettings(next: Settings): void {
  const credentialsChanged = next.clientId !== getSettings().clientId || next.clientSecret !== getSettings().clientSecret
  memory = next
  write(SETTINGS_KEY, next)
  if (credentialsChanged) clearToken()
}

export function hasCredentials(): boolean {
  const s = getSettings()
  return !!(s.clientId && s.clientSecret)
}

interface StoredToken { accessToken: string; expiresAt: number }

export function clearToken(): void {
  write(TOKEN_KEY, null)
}

// Client credentials flow: the ID and secret are exchanged for a bearer token, which is
// cached until shortly before it expires.
export async function getAccessToken(): Promise<string> {
  const cached = read<StoredToken>(TOKEN_KEY)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken

  const { clientId, clientSecret } = getSettings()
  if (!clientId || !clientSecret) throw new Error('NOT_CONFIGURED')

  const res = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    throw new Error(res.status === 401
      ? 'WarcraftLogs rejected the client ID or secret. Check them in Settings.'
      : `WarcraftLogs token request failed: ${res.status}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  write(TOKEN_KEY, { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}
