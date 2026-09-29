export const GET_REPORT = `
  query GetReport($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        endTime
        phases {
          encounterID
          phases { id name isIntermission }
        }
        fights(killType: All) {
          id
          name
          encounterID
          difficulty
          kill
          bossPercentage
          fightPercentage
          startTime
          endTime
          friendlyPlayers
          phaseTransitions { id startTime }
        }
        masterData(translate: true) {
          actors {
            id
            name
            type
            subType
          }
        }
      }
    }
  }
`

// One paginated events stream across a set of fights. Events carry a `fight` field,
// so a whole night comes back in one stream and is split per pull afterwards.
export const GET_EVENTS = `
  query GetEvents(
    $code: String!
    $dataType: EventDataType!
    $fightIDs: [Int]
    $sourceID: Int
    $targetID: Int
    $startTime: Float!
    $endTime: Float!
    $filterExpression: String
    $includeResources: Boolean
  ) {
    reportData {
      report(code: $code) {
        events(
          dataType: $dataType
          fightIDs: $fightIDs
          sourceID: $sourceID
          targetID: $targetID
          startTime: $startTime
          endTime: $endTime
          filterExpression: $filterExpression
          includeResources: $includeResources
          limit: 10000
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`

// One healing table per fight, batched into a single request with GraphQL aliases.
export function healingTablesQuery(fightIDs: number[]): string {
  const fields = fightIDs
    .map(id => `f${id}: table(dataType: Healing, fightIDs: [${id}], sourceID: $sourceID, viewBy: Ability, wipeCutoff: $wipeCutoff)`)
    .join('\n        ')
  return `
  query GetHealingTables($code: String!, $sourceID: Int!, $wipeCutoff: Int) {
    reportData {
      report(code: $code) {
        ${fields}
      }
    }
  }
`
}

export const GET_DEATHS_TABLE = `
  query GetDeaths($code: String!, $fightIDs: [Int]) {
    reportData {
      report(code: $code) {
        table(dataType: Deaths, fightIDs: $fightIDs)
      }
    }
  }
`
