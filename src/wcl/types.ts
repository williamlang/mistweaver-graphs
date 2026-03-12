export interface RateLimitData {
  limitPerHour: number
  pointsSpentThisHour: number
  pointsResetIn: number
}

export interface Fight {
  id: number
  name: string
  difficulty: number
  kill: boolean
  startTime: number // ms from report start
  endTime: number   // ms from report start
  friendlyPlayers: number[]
}

export interface Actor {
  id: number
  name: string
  type: string   // "Player", "NPC", "Pet", etc.
  subType: string // class name, e.g. "Monk"
}

export interface Report {
  title: string
  startTime: number
  endTime: number
  fights: Fight[]
  masterData: {
    actors: Actor[]
  }
}

export interface ReportResponse {
  reportData: {
    report: Report
  }
}

// Healing table — WCL returns the `table` field as a JSON scalar
export interface HealingEntry {
  id: number
  name: string
  total: number
  overheal: number
  casts: number
  hitCount: number
  subentries?: HealingEntry[]
}

export interface HealingTableData {
  totalTime: number
  totalHPS: number
  effectiveHPS: number
  entries: HealingEntry[]
}

export interface HealingTableResponse {
  reportData: {
    report: {
      table: {
        data: HealingTableData
      }
    }
  }
}

// Heal events for HPS timeline
export interface HealEvent {
  timestamp: number  // ms from report start
  amount: number     // effective healing (already excludes overheal in WCL)
  overheal: number
}

export interface HealEventsResponse {
  reportData: {
    report: {
      events: {
        data: HealEvent[]
        nextPageTimestamp: number | null
      }
    }
  }
}
