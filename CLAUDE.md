# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm start          # start server (prints URL, no auto-open)
npm run dev        # start with hot-reload on file changes
```

## Setup

Copy `.env.example` to `.env` and fill in credentials:
1. Create a WarcraftLogs API client at `https://www.warcraftlogs.com/api/clients`
2. Set the redirect URI to `http://localhost:3456/callback` (must match `PORT` in `.env`)
3. Add `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`, and `WCL_CHARACTER_NAME` to `.env`

On first run, visit the printed URL and authorize with WarcraftLogs. The token is stored at `~/.config/mistweaver-graphs/token.json` and reused on subsequent runs.

## Architecture

**Runtime**: Node.js with `tsx` — no build step. TypeScript runs directly.

**Backend** (`src/`):
- `cli.ts` — entry point; validates env, starts Hono server, prints URL
- `server.ts` — Hono routes: `/` (home/auth), `/callback` (OAuth), `/report/:code`, `/report/:code/fight/:fightId`
- `auth.ts` — OAuth Authorization Code flow; token stored as JSON in `~/.config/mistweaver-graphs/token.json`
- `config.ts` — all env vars and constants in one place
- `wcl/client.ts` — `gql<T>()` helper + typed fetch functions. Injects `rateLimitData` into every query and stores latest value via `getLastRateLimit()`
- `wcl/queries.ts` — GraphQL query strings
- `wcl/types.ts` — TypeScript types for all WCL API responses

**Visualizations** (`src/visualizations/`):
Each file exports a function `(data) => Visualization` where `Visualization` contains an `id`, `title`, and a **Vega-Lite JSON spec**. The spec is serialized into the HTML as `data-spec='...'` (HTML-escaped) and rendered client-side by `vega-embed` loaded from CDN — no frontend build step.

To add a new visualization:
1. Create `src/visualizations/my-viz.ts` exporting a function that returns a `Visualization`
2. Import it in `src/dashboard/render.ts` and add `vizCard(myViz(data))` to the grid in `renderFightPage`

**Dashboard rendering** (`src/dashboard/`):
- `layout.ts` — full HTML shell with CDN scripts (Vega, Vega-Lite, vega-embed) and CSS
- `render.ts` — page assembly functions: `renderAuthPage`, `renderHomePage`, `renderReportPage`, `renderFightPage`. The `rateBadge()` helper reads `getLastRateLimit()` and injects a usage badge into every page header.

**WCL API notes**:
- Uses the `user` endpoint (`/api/v2/user`) so private reports are accessible
- The `table` and `graph` GraphQL fields return a `JSON` scalar wrapped in `{ data: { ... } }`, so actual data is at `response.reportData.report.table.data`
- Fight `startTime`/`endTime` are milliseconds relative to report start
- Monk healer is auto-detected by `subType === 'Monk'`; `WCL_CHARACTER_NAME` disambiguates when multiple Monks are in a log
- `rateLimitData` is injected into every query via string replacement in `withRateLimit()` in `client.ts`

---

## WarcraftLogs GraphQL API Reference

Full docs: `https://www.warcraftlogs.com/v2-api-docs/warcraft/`

### Top-Level Queries

| Field | Description |
|---|---|
| `reportData` | Access reports by code or filtered list |
| `characterData` | Individual characters and their rankings |
| `gameData` | Static data: abilities, classes, items, NPCs, zones |
| `worldData` | Expansions, regions, servers, encounters |
| `rateLimitData` | Current API key usage (`limitPerHour`, `pointsSpentThisHour`, `pointsResetIn`) |
| `userData` | Authorized user's id and username |

### Report Fields

```graphql
report(code: String!) {
  title, startTime, endTime, visibility, zone, guild, owner

  fights(killType: KillType, fightIDs: [Int], encounterID: Int, difficulty: Int) { ... }
  masterData(translate: Boolean) { abilities, actors, gameVersion, lang }

  # All three take the same core arguments:
  events(dataType: EventDataType, fightIDs, sourceID, targetID, startTime, endTime,
         limit, filterExpression, hostilityType, includeResources, ...) {
    data          # JSON array of raw events
    nextPageTimestamp
  }
  table(dataType: TableDataType, fightIDs, sourceID, targetID, viewBy: ViewType, ...) # JSON scalar
  graph(dataType: GraphDataType, fightIDs, sourceID, targetID, viewBy: ViewType, ...) # JSON scalar

  rankings(encounterID, fightIDs, playerMetric, difficulty, compare, timeframe)       # JSON scalar
  playerDetails(fightIDs, encounterID, difficulty, translate)                          # JSON scalar
}
```

### ReportFight Fields

`id`, `name`, `encounterID` (0=trash), `startTime`, `endTime` (ms from report start), `kill`, `difficulty`, `size`, `averageItemLevel`, `bossPercentage`, `fightPercentage`, `friendlyPlayers`, `keystoneLevel`, `keystoneAffixes`, `keystoneBonus`, `lastPhase`

### ReportActor (masterData.actors) Fields

`id` (report-local, used in events/table/graph `sourceID`/`targetID`), `name`, `type` (`"Player"` / `"NPC"` / `"Pet"`), `subType` (class name for players), `gameID`, `petOwner`

### Enums

**EventDataType**: `All`, `Buffs`, `Casts`, `CombatantInfo`, `DamageDone`, `DamageTaken`, `Deaths`, `Debuffs`, `Dispels`, `Healing`, `Interrupts`, `Resources`, `Summons`, `Threat`

**TableDataType**: `Buffs`, `Casts`, `DamageDone`, `DamageTaken`, `Deaths`, `Debuffs`, `Dispels`, `Healing`, `Interrupts`, `Resources`, `Summary`, `Summons`, `Survivability`, `Threat`

**GraphDataType**: same as TableDataType

**ViewType** (for table/graph): `Default`, `Ability`, `Source`, `Target`

**KillType**: `All`, `Encounters`, `Kills`, `Trash`, `Wipes`

**HostilityType**: `Friendlies`, `Enemies`

**ReportRankingMetricType**: `bossdps`, `bossrdps`, `default`, `dps`, `hps`, `rdps`, `tankhps`, `wdps`, `playerscore`, `playerspeed`

### table/graph JSON Shape

The `table` and `graph` scalars return `{ data: { ... } }`. For `dataType: Healing`:
- **table**: `data.entries[]` with `{ name, id, total, overheal, casts, hitCount, subentries[] }`; `data.totalTime`, `data.totalHPS`, `data.effectiveHPS`
- **graph**: `data.series[]` with Highcharts-style `{ name, type, id, pointStart, pointInterval, data: number[] }` — reconstruct timestamps as `pointStart + i * pointInterval` (ms from fight start)

### Heal Event Shape (events dataType: Healing)

```json
{ "timestamp": 1234567, "type": "heal", "sourceID": 14, "targetID": 5,
  "abilityGameID": 116670, "amount": 50000, "overheal": 10000, "absorbed": 0, "hitType": 2 }
```
Paginate via `nextPageTimestamp` — pass as `startTime` for the next request.

### Useful Query Patterns

```graphql
# Per-ability healing breakdown
table(dataType: Healing, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Ability)

# Damage taken breakdown (for survivability analysis)
table(dataType: DamageTaken, fightIDs: $fightIDs, targetID: $sourceID, viewBy: Ability)

# Buff uptimes (e.g. Renewing Mist, Enveloping Mist)
table(dataType: Buffs, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Ability)

# All casts for cast efficiency
table(dataType: Casts, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Ability)

# Filter to specific ability with filterExpression
events(dataType: Healing, filterExpression: "ability.id = 116670", ...)

# Player gear/talents for a fight
playerDetails(fightIDs: $fightIDs, translate: true)
```

### filterExpression Examples

```
ability.id = 116670                          # specific ability
source.name = "Williamx"                     # specific player
type = "heal" and overheal > 0               # overhealing events
target.type = "Player"                       # heals on players only
```

## Key URLs

- WarcraftLogs API client management: `https://www.warcraftlogs.com/api/clients`
- WarcraftLogs GraphQL explorer: `https://www.warcraftlogs.com/api/docs`
- WarcraftLogs v2 API docs: `https://www.warcraftlogs.com/v2-api-docs/warcraft/`
- OAuth token endpoint: `https://www.warcraftlogs.com/oauth/token`
