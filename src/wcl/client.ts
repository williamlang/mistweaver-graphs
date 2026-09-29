import { loadToken } from '../auth.js'
import { WCL_API_URL } from '../config.js'
import { GET_REPORT, GET_EVENTS, GET_DEATHS_TABLE, healingTablesQuery } from './queries.js'
import type {
  Report,
  ReportResponse,
  HealingTableData,
  DeathEntry,
  WclEvent,
  EventDataType,
  EventsResponse,
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

export interface EventOptions {
  sourceID?: number
  targetID?: number
  filterExpression?: string
  includeResources?: boolean
}

// Pages through one events stream covering every fight in `fightIDs`.
export async function fetchEvents(
  code: string,
  dataType: EventDataType,
  fightIDs: number[],
  startTime: number,
  endTime: number,
  opts: EventOptions = {},
): Promise<WclEvent[]> {
  const events: WclEvent[] = []
  let nextPage: number | null = startTime

  while (nextPage !== null) {
    const result: EventsResponse = await gql<EventsResponse>(GET_EVENTS, {
      code,
      dataType,
      fightIDs,
      startTime: nextPage,
      endTime,
      ...opts,
    })
    const page = result.reportData.report.events
    events.push(...page.data)
    nextPage = page.nextPageTimestamp
  }

  return events
}

const TABLES_PER_REQUEST = 15

export async function fetchHealingTables(
  code: string,
  fightIDs: number[],
  sourceID: number,
  wipeCutoff: number | null = null,
): Promise<Map<number, HealingTableData>> {
  const out = new Map<number, HealingTableData>()
  for (let i = 0; i < fightIDs.length; i += TABLES_PER_REQUEST) {
    const chunk = fightIDs.slice(i, i + TABLES_PER_REQUEST)
    const data = await gql<{ reportData: { report: Record<string, { data: HealingTableData }> } }>(
      healingTablesQuery(chunk),
      { code, sourceID, wipeCutoff },
    )
    for (const id of chunk) out.set(id, data.reportData.report[`f${id}`].data)
  }
  return out
}

export async function fetchDeaths(code: string, fightIDs: number[]): Promise<DeathEntry[]> {
  const data = await gql<{ reportData: { report: { table: { data: { entries: DeathEntry[] } } } } }>(
    GET_DEATHS_TABLE,
    { code, fightIDs },
  )
  return data.reportData.report.table.data.entries
}
