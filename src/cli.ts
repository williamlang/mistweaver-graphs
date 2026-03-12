import { serve } from '@hono/node-server'
import { app } from './server.js'
import { PORT, CLIENT_ID, CLIENT_SECRET } from './config.js'
import { loadToken } from './auth.js'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set in .env')
  console.error('Copy .env.example to .env and fill in your credentials.')
  console.error('Create a client at: https://www.warcraftlogs.com/api/clients')
  process.exit(1)
}

const url = `http://localhost:${PORT}`

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\nMistweaver Graphs → ${url}`)
  if (!loadToken()) {
    console.log(`  Authorize at ${url} to connect WarcraftLogs`)
  }
  console.log('  Press Ctrl+C to stop\n')
})
