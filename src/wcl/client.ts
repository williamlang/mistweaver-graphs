import { loadToken } from '../auth.js'
import { WCL_API_URL } from '../config.js'
import { GET_REPORT, GET_HEALING_TABLE, GET_HEAL_EVENTS } from './queries.js'
import type {
  Report,
  ReportResponse,
  HealingTableData,
  HealingTableResponse,
  HealEvent,
  HealEventsResponse,
  RateLimitData,
} from './types.js'

// Last known rate limit — updated on every API call, read by the dashboard
let lastRateLimit: RateLimitData | null = null

export function getLastRateLimit(): RateLimitData | null {
  return lastRateLimit
}

// Inject rateLimitData into every query so we always get fresh usage stats
function withRateLimit(query: string): string {
  return query.trimEnd().replace(/}(\s*)$/, `  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }\n}$1`)
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = loadToken()
  if (!token) throw new Error('NOT_AUTHENTICATED')

  const res = await fetch(WCL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: withRateLimit(query), variables }),
  })

  if (!res.ok) throw new Error(`WCL API error: ${res.status} ${await res.text()}`)

  const json = (await res.json()) as {
    data?: T & { rateLimitData?: RateLimitData }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(`GraphQL: ${json.errors.map(e => e.message).join(', ')}`)
  }

  if (json.data?.rateLimitData) {
    lastRateLimit = json.data.rateLimitData
  }

  return json.data as T
}

export async function fetchReport(code: string): Promise<Report> {
  const data = await gql<ReportResponse>(GET_REPORT, { code })
  return data.reportData.report
}

export async function fetchHealingTable(
  code: string,
  fightIDs: number[] | null,
  sourceID: number,
): Promise<HealingTableData> {
  const data = await gql<HealingTableResponse>(GET_HEALING_TABLE, {
    code,
    fightIDs: fightIDs ?? undefined,
    sourceID,
  })
  const raw = data.reportData.report.table
  return (raw as unknown as { data: HealingTableData }).data
}

export async function fetchHealEvents(
  code: string,
  fightIDs: number[] | null,
  sourceID: number,
  startTime: number,
  endTime: number,
): Promise<HealEvent[]> {
  const events: HealEvent[] = []
  let nextPage: number | null = startTime

  while (nextPage !== null) {
    const result: HealEventsResponse = await gql<HealEventsResponse>(GET_HEAL_EVENTS, {
      code,
      fightIDs: fightIDs ?? undefined,
      sourceID,
      startTime: nextPage,
      endTime,
    })
    const page = result.reportData.report.events
    events.push(...page.data)
    nextPage = page.nextPageTimestamp
  }

  return events
}
