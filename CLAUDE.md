# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm run dev        # Vite dev server with hot reload
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/ locally
npm run typecheck  # tsc only
```

## Setup and deployment

The app is a static site: everything, including the WarcraftLogs API calls, runs in the browser. There is no server and no credentials in the repo.

- On first visit the Settings page (`#/settings`) asks for a WarcraftLogs API client ID and secret (create one at `https://www.warcraftlogs.com/api/clients`; any redirect URL works). They are kept in the viewer's localStorage and only sent to WarcraftLogs' token endpoint (client credentials flow). Settings also holds the default character name and death cutoff.
- Client-credentials tokens only work with the public endpoint (`/api/v2/client`), so reports must be public or unlisted.
- `.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on every push to `main` (repo Settings → Pages → Source: GitHub Actions). `vite.config.ts` uses `base: './'` so the build works under `/<repo>/`.

## Architecture

**Runtime**: browser only, bundled by Vite. `index.html` holds the page shell, CSS and the Vega/Vega-Lite/vega-embed CDN scripts.

**App shell** (`src/`):
- `web/main.ts` — entry point: renders the current hash route into `#app`, embeds charts, discards results of navigations the user has already left, and handles forms (`data-route` forms navigate with their fields as the query string; the settings form is saved in-page so the secret never enters the URL)
- `web/router.ts` — hash routes: `#/` (home), `#/settings`, `#/go?log=<WCL URL>` (parses pasted URLs and redirects), `#/report/:code` (the night), `#/report/:code/fight/:fightId` (one pull), `#/report/:code/boss/:encounterId/:difficulty` (every pull on one boss: where the metrics dip), `#/multi?logs=A,B,C&name=<Monk>` (several reports, one section per boss with a by-night table and trends) and `#/multi/boss/:encounterId/:difficulty?logs=...` (one boss across those reports). `#/go` sends one pasted URL to its night and several to `#/multi`. `?player=<actorId>` picks the Monk; `?cutoff=N` ignores everything after the Nth death in each pull, like WarcraftLogs' "ignore after X deaths" (0 = off, default from Settings).
- `settings.ts` — localStorage-backed settings and the client-credentials token (cached until shortly before expiry, refetched on a 401)
- `wcl/client.ts` — `gql<T>()` helper plus `fetchReport`, `fetchEvents` (one paginated stream across many fights), `fetchHealingTables` (one table per fight, batched with GraphQL aliases), `fetchDeaths`. Injects `rateLimitData` into every query and stores latest value via `getLastRateLimit()`
- `wcl/queries.ts` — GraphQL query strings
- `wcl/types.ts` — TypeScript types for WCL API responses
- `wcl/url.ts` — parses a report code or WCL URL (`?fight=`, `#fight=last`, `source=`)

**Mistweaver analysis** (`src/mw/`), ported from WoWAnalyzer (`~/workspace/WoWAnalyzer/src/analysis/retail/monk/mistweaver`):
- `spells.ts` — spell IDs, talent entry IDs (read from combatantinfo `talentTree`), GCD and channel spell sets, major cooldown definitions, grade thresholds
- `cooldown.ts` — `simulateCharges()`, a port of WoWAnalyzer's SpellUsable/CastEfficiency: charges, cooldown-rate changes (modRate), flat reductions, and a cast at 0 charges treated as a missed recharge. Efficiency = share of the pull the spell had fewer than max charges
- `analyze.ts` — `analyzePull()` turns one pull's events into a `PullAnalysis`: Renewing Mist uptime (WoWAnalyzer's model: fixed 9s, 2 charges / 3 with Pool of Mists, Pool of Mists 1s per kick, Heart of the Jade Serpent rate buffs), Rushing Wind Kick uptime (share of the pull on cooldown), CPM, active time, major cooldown efficiency, active HoT counts, mana, deaths
- `night.ts` — loads every boss pull of a report in one batch of requests and caches each `PullAnalysis` in memory (a listed fight has ended, so it never changes; the report itself is cached 30s for live logs)
- `summary.ts` — duration-weighted night/boss summaries and boss grouping
- `multi.ts` — `loadMulti()` loads several reports in parallel. Actor ids are per report, so the Monk is matched by name (`?name=`, else `WCL_CHARACTER_NAME`, else the Monk in the most reports); pulls are merged in real-time order and carry `reportCode`/`monkId` so links work across reports
- `timeline.ts` — `buildTimeline()`: one entry per second of a pull with ReM/kick on-cooldown share, casts, and context (moving from the monk's x/y, boss phase, cooldown window, mana, dead, lost-wipe tail). Position comes from heals/damage landing on the monk (`resourceActor: 2`) plus their casts (`resourceActor: 1`), sampled every ~200ms
- `dips.ts` — everything derived from the timeline: `rates()` over any set of seconds (dead and lost-wipe seconds excluded), 15s `rolling()` series, `findDips()` per pull, `contextBreakdown()` (standing/moving/opener/cooldowns/low mana/last minute), `phaseBreakdown()` and `alignedAverage()` across pulls of a boss

Deliberate modelling choices: Renewing Mist uptime follows WoWAnalyzer exactly; on the reference log ~7.5% of ReM casts still land at 0 simulated charges (reduction WoWAnalyzer doesn't model either), handled as missed recharges like SpellUsable does. TFT is tracked as a rate. RWK uptime assumes no resets, so it is an upper bound and its idle windows are real waste. The hasted GCD is estimated from gaps after instant 1.5s spells, locally, so lust is followed. Pulls under 20s are shown but excluded from averages.

**Visualizations** (`src/visualizations/`):
Each file exports a function returning a `Visualization` (`id`, `title`, optional `badge`, and a **Vega-Lite JSON spec**). The spec is serialized into the HTML as `data-spec='...'` (HTML-escaped) and rendered client-side by `vega-embed` loaded from CDN — no frontend build step. Shared colors live in `COLORS` in `types.ts` (validated for the dark card surface); `time.ts` formats pull-relative seconds as m:ss.

To add a new visualization:
1. Create `src/visualizations/my-viz.ts` exporting a function that returns a `Visualization`
2. Import it in `src/dashboard/render.ts` and add `vizCard(myViz(pull))` to the grid in `renderPullPage` (or a trend to `renderNightPage`)

**Dashboard rendering** (`src/dashboard/`):
- `layout.ts` — sets the tab title and returns the page body (the shell is `index.html`)
- `render.ts` — `renderAuthPage`, `renderHomePage`, `renderNightPage` (headline tiles, pull-by-pull table grouped by boss, per-pull trend charts), `renderPullPage` (headline tiles with comparison to your other pulls on the boss, HoT count, cooldown timeline, CPM, HPS, mana, breakdowns, deaths). Names from the API go through `esc()`.

**WCL API notes**:
- Uses the public `client` endpoint (`/api/v2/client`) with a client-credentials token; private reports would need the user endpoint and a login
- The `table` and `graph` GraphQL fields return a `JSON` scalar wrapped in `{ data: { ... } }`, so actual data is at `response.reportData.report.table.data`
- In the Healing table, `total` is already effective healing; `overheal` is separate (do not subtract it)
- `events(dataType: Buffs, sourceID: X)` returns auras *on* X, not auras X applied. For the monk's HoTs on the raid, filter by `ability.id IN (...)` and check `sourceID` client-side
- Events carry a `fight` field, so one stream over many `fightIDs` can be split per pull
- `wipeCutoff: N` on `table`/`events`/`graph` ends every fight (kills too) at its Nth death. `night.ts` does the same by moving each fight's `endTime` to that death and fetching the healing tables with `wipeCutoff`, so HPS matches the site
- Fight `startTime`/`endTime` are milliseconds relative to report start
- Monk healer is auto-detected by `subType === 'Monk'`; the Settings character name disambiguates when multiple Monks are in a log
- The API and token endpoints send CORS headers for any origin, which is what makes the browser-only build possible
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
