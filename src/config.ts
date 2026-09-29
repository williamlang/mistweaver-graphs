import 'dotenv/config'
import path from 'path'
import os from 'os'

export const PORT = parseInt(process.env.PORT ?? '3456', 10)
export const CLIENT_ID = process.env.WCL_CLIENT_ID ?? ''
export const CLIENT_SECRET = process.env.WCL_CLIENT_SECRET ?? ''
export const CHARACTER_NAME = process.env.WCL_CHARACTER_NAME ?? ''
// Like WarcraftLogs' "ignore after X deaths": every pull ends at its Nth death.
// Blank or 0 = off. Overridden per page with ?cutoff=N (0 turns it off).
export const DEFAULT_DEATH_CUTOFF = parseInt(process.env.WCL_DEATH_CUTOFF ?? '', 10) || null
export const REDIRECT_URI = `http://localhost:${PORT}/callback`

export const TOKEN_PATH = path.join(os.homedir(), '.config', 'mistweaver-graphs', 'token.json')

export const WCL_AUTHORIZE_URL = 'https://www.warcraftlogs.com/oauth/authorize'
export const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token'
export const WCL_API_URL = 'https://www.warcraftlogs.com/api/v2/user'
