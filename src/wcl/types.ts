export interface RateLimitData {
  limitPerHour: number
  pointsSpentThisHour: number
  pointsResetIn: number
}

export interface Fight {
  id: number
  name: string
  encounterID: number // 0 = trash
  difficulty: number | null
  kill: boolean | null
  bossPercentage: number | null
  fightPercentage: number | null
  startTime: number // ms from report start
  endTime: number   // ms from report start
  friendlyPlayers: number[]
  phaseTransitions: Array<{ id: number; startTime: number }> | null
}

export interface EncounterPhases {
  encounterID: number
  phases: Array<{ id: number; name: string; isIntermission: boolean }>
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
  phases: EncounterPhases[] | null
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
  name: string
  guid: number
  total: number
  overheal: number
  hitCount: number
  tickCount: number
  critHitCount: number
  missCount: number
  // Note: no `casts` field on healing table entries — use hitCount or fetch dataType: Casts separately
}

export interface HealingTableData {
  totalTime: number
  entries: HealingEntry[]
}

export interface DeathEntry {
  name: string
  id: number
  type: string // class
  timestamp: number
  fight: number
  killingBlow?: { name: string; guid: number }
}

// Raw event as WCL returns it. Only the fields we read are typed.
export interface WclEvent {
  timestamp: number // ms from report start
  type: string
  fight: number
  sourceID: number
  targetID?: number
  abilityGameID: number
  amount?: number
  overheal?: number
  resourceActor?: number // 1 = source, 2 = target: whose resources and x/y are attached
  x?: number // position, in 1/100 yards
  y?: number
  classResources?: Array<{ amount: number; max: number; type: number; cost?: number }>
  talentTree?: Array<{ id: number; rank: number; nodeID: number }>
}

export type EventDataType = 'Casts' | 'Buffs' | 'Healing' | 'DamageTaken' | 'CombatantInfo' | 'Deaths'

export interface EventsResponse {
  reportData: {
    report: {
      events: {
        data: WclEvent[]
        nextPageTimestamp: number | null
      }
    }
  }
}
