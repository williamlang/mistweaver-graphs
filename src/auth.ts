import fs from 'fs'
import path from 'path'
import {
  TOKEN_PATH,
  CLIENT_ID,
  CLIENT_SECRET,
  WCL_TOKEN_URL,
  WCL_AUTHORIZE_URL,
  REDIRECT_URI,
} from './config.js'

interface TokenData {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
  refresh_token?: string
}

export function loadToken(): TokenData | null {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return null
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as TokenData
    if (data.expires_at < Date.now()) return null
    return data
  } catch {
    return null
  }
}

export function saveToken(raw: Omit<TokenData, 'expires_at'>): void {
  const dir = path.dirname(TOKEN_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const data: TokenData = {
    ...raw,
    expires_at: Date.now() + raw.expires_in * 1000,
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2))
}

export async function exchangeCode(code: string): Promise<Omit<TokenData, 'expires_at'>> {
  const res = await fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<Omit<TokenData, 'expires_at'>>
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
  })
  return `${WCL_AUTHORIZE_URL}?${params}`
}
