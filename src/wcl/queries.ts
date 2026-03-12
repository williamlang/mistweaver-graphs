export const GET_REPORT = `
  query GetReport($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        endTime
        fights(killType: All) {
          id
          name
          difficulty
          kill
          startTime
          endTime
          friendlyPlayers
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

export const GET_HEALING_TABLE = `
  query GetHealingTable($code: String!, $fightIDs: [Int], $sourceID: Int!) {
    reportData {
      report(code: $code) {
        table(
          dataType: Healing
          fightIDs: $fightIDs
          sourceID: $sourceID
          viewBy: Ability
        )
      }
    }
  }
`

export const GET_HEAL_EVENTS = `
  query GetHealEvents(
    $code: String!
    $fightIDs: [Int]
    $sourceID: Int!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code) {
        events(
          dataType: Healing
          fightIDs: $fightIDs
          sourceID: $sourceID
          startTime: $startTime
          endTime: $endTime
          limit: 10000
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`
