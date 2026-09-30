import { htmlLayout } from './layout.js'
import type { Actor } from '../wcl/types.js'
import { fetchEvents, getLastRateLimit } from '../wcl/client.js'
import { getReport, getMonks, resolveMonk, bossPulls, loadPulls } from '../mw/night.js'
import type { PullAnalysis, CooldownResult } from '../mw/analyze.js'
import { summarize, groupByBoss, difficultyName, MIN_JUDGED_PULL_MS, type Summary } from '../mw/summary.js'
import { gradeActiveTime, gradeEfficiency, type Grade } from '../mw/spells.js'
import { healingBreakdown } from '../visualizations/healing-breakdown.js'
import { hpsTimeline } from '../visualizations/hps-timeline.js'
import { castBreakdown } from '../visualizations/cast-breakdown.js'
import { cpmTimeline } from '../visualizations/cpm-timeline.js'
import { hotCount } from '../visualizations/hot-count.js'
import { cooldownTimeline } from '../visualizations/cooldown-timeline.js'
import { manaTimeline } from '../visualizations/mana-timeline.js'
import { pullTrend, pullLabel, type TrendMetric } from '../visualizations/night-trend.js'
import type { Visualization } from '../visualizations/types.js'
import { contextStrip, metricTimeline, alignedTimeline } from '../visualizations/dip-timeline.js'
import { loadMulti, nightLabel, pullKey, type MultiLoad } from '../mw/multi.js'
import { findPatterns, type Pattern } from '../mw/patterns.js'
import {
  findDips, contextBreakdown, phaseBreakdown, alignedAverage, rates, METRICS,
  type Dip, type MetricKey, type Rates, type ContextRow,
} from '../mw/dips.js'
import type { Report } from '../wcl/types.js'
import { getSettings, hasCredentials, WCL_CLIENTS_URL } from '../settings.js'

// ── Helpers ────────────────────────────────────────────────────────────────

// Names come from the WCL API (players, bosses, abilities), so they are escaped.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function playerDropdown(monks: Actor[], selectedId: number, onChangeUrl: (id: number) => string): string {
  if (monks.length <= 1) return `<span class="monk-name">${esc(monks[0]?.name ?? '')}</span>`
  const options = monks.map(m =>
    `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`,
  ).join('')
  const urlMap = Object.fromEntries(monks.map(m => [m.id, onChangeUrl(m.id)]))
  return `<select class="player-select" data-urls='${escapeAttr(JSON.stringify(urlMap))}'
    onchange="window.location=JSON.parse(this.dataset.urls)[this.value]">${options}</select>`
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function formatBigNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

function signed(x: number, digits: number, suffix = ''): string {
  const v = x.toFixed(digits)
  return `${x >= 0 ? '+' : ''}${v}${suffix}`
}

function rateBadge(): string {
  const rl = getLastRateLimit()
  if (!rl) return ''
  const used = Math.round(rl.pointsSpentThisHour)
  const usedPct = Math.round((rl.pointsSpentThisHour / rl.limitPerHour) * 100)
  const resetMin = Math.ceil(rl.pointsResetIn / 60)
  const color = usedPct >= 80 ? '#f38ba8' : usedPct >= 50 ? '#fab387' : '#a6e3a1'
  return `<div class="rate-badge" title="WarcraftLogs API points. Resets in ${resetMin}m">
    <span style="color:${color}">${used}/${rl.limitPerHour}</span>
    <span class="rate-label">pts/hr</span>
  </div>`
}

function header(breadcrumbs: string): string {
  return `<header><h1><a href="#/">Mistweaver Graphs</a></h1><nav>${breadcrumbs}</nav>${rateBadge()}
    <a class="settings-link" href="#/settings">Settings</a></header>`
}

function escapeAttr(json: string): string {
  return json.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function vizCard(viz: Visualization, wide = false): string {
  const badge = viz.badge ? `<span class="card-badge">${esc(viz.badge)}</span>` : ''
  return `
    <div class="card${wide ? ' wide' : ''}">
      <div class="card-title">${esc(viz.title)}${badge}</div>
      <div data-spec='${escapeAttr(JSON.stringify(viz.spec))}'></div>
    </div>`
}

const GRADE_LABEL: Record<Grade, string> = { good: 'Good', ok: 'Could be better', bad: 'Needs work' }
const GRADE_ICON: Record<Grade, string> = { good: '●', ok: '◐', bad: '○' }

// Status is never color alone: an icon and a hover label ride along.
function graded(text: string, grade: Grade | null): string {
  if (!grade) return text
  return `<span class="grade g-${grade}" title="${GRADE_LABEL[grade]}"><span class="grade-icon" aria-hidden="true">${GRADE_ICON[grade]}</span>${text}</span>`
}

function tile(label: string, value: string, sub = '', headline = false): string {
  return `<div class="stat${headline ? ' headline' : ''}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`
}

function cdCell(cd: CooldownResult | undefined): string {
  if (!cd) return '<td class="num muted">—</td>'
  const text = `${cd.casts.length}/${Math.max(cd.casts.length, Math.round(cd.possible))}`
  return `<td class="num" title="${esc(cd.name)}: ${cd.casts.length} casts, ~${cd.possible.toFixed(1)} possible (${pct(cd.efficiency)})">${graded(text, gradeEfficiency(cd.efficiency))}</td>`
}

// Page state lives in the query string so every link carries it: the Monk, and the
// death cutoff when it differs from the .env default (cutoff=0 means off).
function query(monkId: number, cutoff: number | null): string {
  const c = cutoff === getSettings().deathCutoff ? '' : `&cutoff=${cutoff ?? 0}`
  return `?player=${monkId}${c}`
}

function pullHref(cutoff: number | null) {
  return (p: PullAnalysis) => `#/report/${p.reportCode}/fight/${p.fightId}${query(p.monkId, cutoff)}`
}

function multiQuery(codes: string[], name: string | null, cutoff: number | null): string {
  const c = cutoff === getSettings().deathCutoff ? '' : `&cutoff=${cutoff ?? 0}`
  return `?logs=${codes.map(encodeURIComponent).join(',')}${name ? `&name=${encodeURIComponent(name)}` : ''}${c}`
}

const CUTOFF_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]

function cutoffSelect(cutoff: number | null, urlFor: (c: number | null) => string): string {
  const urls = Object.fromEntries([[0, urlFor(null)], ...CUTOFF_CHOICES.map(n => [n, urlFor(n)])])
  const opts = [`<option value="0" ${cutoff ? '' : 'selected'}>Off</option>`,
    ...CUTOFF_CHOICES.map(n => `<option value="${n}" ${cutoff === n ? 'selected' : ''}>${n} death${n === 1 ? '' : 's'}</option>`)].join('')
  return `<div class="field"><label title="Like WarcraftLogs: each pull ends at this death, kill or wipe">Ignore after</label>
    <select class="cutoff-select" data-urls='${escapeAttr(JSON.stringify(urls))}'
      onchange="window.location=JSON.parse(this.dataset.urls)[this.value]">${opts}</select></div>`
}

function cutNote(p: PullAnalysis): string {
  return p.cutAtDeath ? ` <span class="cut" title="Cut at death ${p.cutAtDeath}; the whole pull was ${formatDuration(p.fullDurationMs)}">✂</span>` : ''
}

function resultCell(p: PullAnalysis): string {
  return p.kill
    ? '<span class="result kill">Kill</span>'
    : `<span class="result wipe">${esc(pullLabel(p))}</span>`
}


// ── Dips ───────────────────────────────────────────────────────────────────

type PhaseName = { id: number; name: string; isIntermission: boolean }

function phaseNamesFor(report: Report, encounterID: number): PhaseName[] {
  return report.phases?.find(ph => ph.encounterID === encounterID)?.phases ?? []
}

function bossHref(code: string, monkId: number, cutoff: number | null, encounterID: number, difficulty: number | null) {
  return `#/report/${code}/boss/${encounterID}/${difficulty ?? 0}${query(monkId, cutoff)}`
}

function fmtMetric(metric: MetricKey, v: number): string {
  return metric === 'cpm' ? v.toFixed(1) : pct(v, 1)
}

// Small multiples share one card so the time axes line up.
function stackCard(title: string, vizs: Visualization[], footer = ''): string {
  const parts = vizs.map(v => {
    const badge = v.badge ? `<span class="card-badge">${esc(v.badge)}</span>` : ''
    return `<div class="stack-part"><div class="stack-title">${esc(v.title)}${badge}</div>
      <div data-spec='${escapeAttr(JSON.stringify(v.spec))}'></div></div>`
  }).join('')
  return `<div class="card wide"><div class="card-title">${esc(title)}</div>${parts}${footer}</div>`
}

// Deltas carry an arrow as well as a color, so "worse" never rests on color alone.
function delta(metric: MetricKey, v: number, base: number): string {
  const d = metric === 'cpm' ? v - base : (v - base) * 100
  const worse = metric === 'cpm' ? d <= -2 : d <= -1.5
  const better = metric === 'cpm' ? d >= 2 : d >= 1.5
  const text = `${d >= 0 ? '+' : ''}${d.toFixed(1)}${metric === 'cpm' ? '' : ' pts'}`
  if (worse) return `<span class="dir worse" title="Below your night average">▼ ${text}</span>`
  if (better) return `<span class="dir better" title="Above your night average">▲ ${text}</span>`
  return `<span class="delta">${text}</span>`
}

function ratesCells(r: Rates, base: Rates | null): string {
  const cell = (m: MetricKey) => `<td class="num">${fmtMetric(m, r[m])}${base ? ` ${delta(m, r[m], base[m])}` : ''}</td>`
  return `${cell('rem')}${cell('kick')}${cell('cpm')}<td class="num">${r.moving === null ? '—' : pct(r.moving)}</td>`
}

function contextTable(rows: ContextRow[]): string {
  const base = rows.find(r => r.key === 'all')?.rates ?? null
  const body = rows.map(r => `<tr${r.key === 'all' ? ' class="base-row"' : ''}>
      <td>${esc(r.label)}</td><td class="num">${formatDuration(r.rates.seconds * 1000)}</td>
      ${ratesCells(r.rates, r.key === 'all' ? null : base)}</tr>`).join('')
  return `<table class="mini context">
    <thead><tr><th>Situation</th><th class="num">Time</th><th class="num">ReM up</th><th class="num">RWK up</th><th class="num">CPM</th><th class="num">Moving</th></tr></thead>
    <tbody>${body}</tbody></table>`
}

function dipLine(d: Dip, names: PhaseName[]): string {
  const phase = d.phase !== null ? names.find(n => n.id === d.phase)?.name ?? `Phase ${d.phase}` : null
  const bits = [
    phase ? esc(phase) : null,
    d.moving !== null ? `moving ${pct(d.moving)}` : null,
    d.celestial ? 'in a cooldown window' : null,
    d.raidDeaths ? `${d.raidDeaths} raid death${d.raidDeaths === 1 ? '' : 's'}` : null,
    d.mana !== null && d.mana < 0.2 ? `mana ${pct(d.mana)}` : null,
  ].filter(Boolean)
  return `<span class="dip-time">${formatDuration(d.start * 1000)}–${formatDuration(d.end * 1000)}</span>
    <strong>${METRICS[d.metric].short} ${fmtMetric(d.metric, d.value)}</strong>
    <span class="muted">vs ${fmtMetric(d.metric, d.baseline)} for the pull (−${pct(d.drop)})</span>
    ${bits.length ? `<span class="dip-ctx">${bits.join(' · ')}</span>` : ''}`
}

function dipList(
  items: Array<{ d: Dip; p: PullAnalysis }>,
  names: (p: PullAnalysis) => PhaseName[],
  href?: (p: PullAnalysis) => string,
  label: (p: PullAnalysis) => string = p => `${p.name} · ${pullLabel(p)}`,
): string {
  if (items.length === 0) return '<p class="hint">No stretch fell clearly below the pull\'s own level.</p>'
  return `<ul class="dips">${items.map(({ d, p }) => `<li>
      ${href ? `<a href="${href(p)}">${esc(label(p))}</a> ` : ''}${dipLine(d, names(p))}</li>`).join('')}</ul>`
}


// ── Recurring dips ─────────────────────────────────────────────────────────

const ORDINAL = ['', '', '2nd', '3rd', '4th', '5th']

function patternWhere(p: Pattern, names: PhaseName[]): string {
  const span = `${formatDuration(p.start * 1000)}–${formatDuration(p.end * 1000)}`
  if (p.phase === null) return `${span} into the pull`
  const name = names.find(n => n.id === p.phase)?.name ?? `Phase ${p.phase}`
  const again = p.phaseOccurrence > 1 ? ` (${ORDINAL[p.phaseOccurrence] ?? `${p.phaseOccurrence}th`} time)` : ''
  return `${esc(name)}${again}, ${span} in`
}

function patternLine(p: Pattern, names: PhaseName[], href: (p: PullAnalysis) => string, pullLabel: (p: PullAnalysis) => string): string {
  const hits = p.hits.map(h => `<a href="${href(h.pull)}">${esc(pullLabel(h.pull))} at ${formatDuration(h.pullStart * 1000)}</a>`).join(' · ')
  return `<li>
    <strong>${esc(p.bossName)}</strong> <span class="muted">${difficultyName(p.difficulty)}</span> ·
    <strong>${METRICS[p.metric].short} ${fmtMetric(p.metric, p.value)}</strong>
    <span class="muted">vs ${fmtMetric(p.metric, p.baseline)} for those pulls (−${pct(p.drop)})</span>
    <span class="dip-ctx">${patternWhere(p, names)} · ${p.hits.length} of ${p.pullsReached} pulls${p.moving !== null ? ` · moving ${pct(p.moving)}` : ''}</span>
    <span class="dip-ctx">${hits}</span>
  </li>`
}

// Openers repeat on nearly every boss, so they're summed up per metric instead of listed.
function openerLine(metric: MetricKey, ps: Pattern[]): string {
  const bosses = [...new Set(ps.map(p => `${p.bossName} ${difficultyName(p.difficulty)}`.trim()))]
  const hits = ps.reduce((n, p) => n + p.hits.length, 0)
  const reached = ps.reduce((n, p) => n + p.pullsReached, 0)
  const value = ps.reduce((n, p) => n + p.value * p.hits.length, 0) / hits
  const baseline = ps.reduce((n, p) => n + p.baseline * p.hits.length, 0) / hits
  return `<li><strong>Opener · ${METRICS[metric].short} ${fmtMetric(metric, value)}</strong>
    <span class="muted">vs ${fmtMetric(metric, baseline)} for those pulls</span>
    <span class="dip-ctx">First seconds of the pull on ${bosses.length} boss${bosses.length === 1 ? '' : 'es'} (${hits} of ${reached} pulls): ${bosses.map(esc).join(', ')}</span></li>`
}

const MAX_PATTERNS_SHOWN = 8

function patternList(
  patterns: Pattern[],
  names: (encounterID: number) => PhaseName[],
  href: (p: PullAnalysis) => string,
  pullLabel: (p: PullAnalysis) => string,
): string {
  const openers = patterns.filter(p => p.opener)
  const rest = patterns.filter(p => !p.opener).slice(0, MAX_PATTERNS_SHOWN)
  const openerLines = (['rem', 'kick', 'cpm'] as MetricKey[])
    .map(m => [m, openers.filter(p => p.metric === m)] as const)
    .filter(([, ps]) => ps.length > 0)
    .map(([m, ps]) => openerLine(m, ps))
  if (rest.length === 0 && openerLines.length === 0) {
    return '<p class="hint">No dip repeated at the same spot across pulls of the same boss. Patterns need at least two pulls on a boss.</p>'
  }
  return `<ul class="dips">${rest.map(p => patternLine(p, names(p.encounterID), href, pullLabel)).join('')}${openerLines.join('')}</ul>
    <p class="hint">A spot counts when most pulls that reached it dipped there. Bosses with phase data are lined up by time into the phase, others by time into the pull.</p>`
}

// ── Pages ──────────────────────────────────────────────────────────────────

// The WarcraftLogs credentials are the viewer's own and stay in their browser. The form
// is saved by the page script (web/main.ts), never through the URL, so the secret doesn't
// end up in history.
export function renderSettingsPage(message: { text: string; ok: boolean } | null = null): string {
  const st = getSettings()
  const cutoffs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]
  const body = `
    ${header('<span>Settings</span>')}
    <div class="container settings">
      ${message ? `<div class="${message.ok ? 'ok-box' : 'error-box'}">${esc(message.text)}</div>` : ''}
      <form data-action="save-settings" class="settings-form" autocomplete="off">
        <h2>WarcraftLogs API client</h2>
        <p class="hint">
          Create a client at <a href="${WCL_CLIENTS_URL}" target="_blank" rel="noopener">warcraftlogs.com/api/clients</a>
          (any redirect URL works) and paste its ID and secret here. They're stored only in this browser and only
          sent to WarcraftLogs. Reports must be public or unlisted.
        </p>
        <div class="field"><label for="clientId">Client ID</label>
          <input id="clientId" name="clientId" type="text" value="${esc(st.clientId)}" required spellcheck="false"></div>
        <div class="field"><label for="clientSecret">Client secret</label>
          <input id="clientSecret" name="clientSecret" type="password" value="${esc(st.clientSecret)}" required spellcheck="false"></div>
        <h2>Defaults</h2>
        <div class="field"><label for="characterName">Your character name</label>
          <input id="characterName" name="characterName" type="text" value="${esc(st.characterName)}" placeholder="Picks you when a log has several Monks"></div>
        <div class="field"><label for="deathCutoff">Ignore after</label>
          <select id="deathCutoff" name="deathCutoff">
            <option value="0" ${st.deathCutoff ? '' : 'selected'}>Off</option>
            ${cutoffs.map(n => `<option value="${n}" ${st.deathCutoff === n ? 'selected' : ''}>${n} death${n === 1 ? '' : 's'}</option>`).join('')}
          </select></div>
        <div class="form-row"><button type="submit">Save</button>
          ${hasCredentials() ? '<button type="button" class="btn-secondary" data-action="forget-settings">Forget credentials</button>' : ''}</div>
      </form>
    </div>`
  return htmlLayout('Settings — Mistweaver Graphs', body)
}

export function renderHomePage(): string {
  const body = `
    ${header('')}
    <div class="container">
      <form class="form-row" data-route="/go">
        <div class="field grow">
          <label for="log">WarcraftLogs URLs</label>
          <textarea id="log" name="log" rows="3" autocomplete="off" required
            placeholder="https://www.warcraftlogs.com/reports/ABCdef123456&#10;One per line for several nights"></textarea>
        </div>
        <button type="submit">Analyze</button>
      </form>
      <p class="hint">
        One URL opens that night. Several (one per line) compare the nights boss by boss.
        A single URL with <code>?fight=12</code> (or <code>fight=last</code>) opens that pull directly, and <code>source=</code> picks the Monk.
      </p>
    </div>`
  return htmlLayout('Mistweaver Graphs', body)
}

export function renderErrorPage(message: string, backHref = '#/'): string {
  const body = `
    ${header(`<a href="${esc(backHref)}">← Back</a>`)}
    <div class="container">
      <div class="error-box">${esc(message)}</div>
    </div>`
  return htmlLayout('Error — Mistweaver Graphs', body)
}

// ── Night ──────────────────────────────────────────────────────────────────

function nightTiles(s: Summary): string {
  return `
    <div class="stats">
      ${tile('Renewing Mist uptime', graded(pct(s.remUptime, 1), gradeEfficiency(s.remUptime)), `${Math.round(s.remCappedMs / 1000)}s capped · ${s.remCpm.toFixed(1)} casts/min<br>${s.remAvg.toFixed(1)} avg active on the raid`, true)}
      ${tile('Rushing Wind Kick uptime', graded(pct(s.kickUptime, 1), gradeEfficiency(s.kickUptime)), `${Math.round(s.kickIdleMs / 1000)}s ready and unused`, true)}
      ${tile('CPM', s.cpm.toFixed(1), 'casts per minute', true)}
    </div>
    <div class="stats">
      ${tile('Pulls', `${s.pulls}`, `${s.kills} kill${s.kills === 1 ? '' : 's'}`)}
      ${tile('Time in combat', formatDuration(s.timeMs))}
      ${tile('Active time', graded(pct(s.activeTime, 1), gradeActiveTime(s.activeTime)))}
      ${tile('Effective HPS', formatBigNum(s.hps))}
      ${tile('Overheal', pct(s.overhealPct))}
      ${tile('Your deaths', `${s.monkDeaths}`)}
    </div>`
}

function pullTable(pulls: PullAnalysis[], s: Summary, href: (p: PullAnalysis) => string, bossLink: (p: PullAnalysis) => string): string {
  const groups = groupByBoss(pulls)
  let n = 0
  const order = new Map(pulls.map((p, i) => [p.fightId, i + 1]))
  const body = groups.map(g => {
    const killed = g.pulls.some(p => p.kill)
    const best = Math.min(...g.pulls.map(p => (p.kill ? 0 : p.bossPct ?? 100)))
    const gs = summarize(g.pulls)
    const status = killed ? 'Killed' : `Best ${best.toFixed(1)}%`
    const head = `<tr class="boss-row">
      <td colspan="3"><a class="boss-link" href="${bossLink(g.pulls[0])}" title="Trends across these pulls"><strong>${esc(g.name)}</strong></a> <span class="muted">${difficultyName(g.difficulty)} · ${g.pulls.length} pull${g.pulls.length === 1 ? '' : 's'} · ${status}</span></td>
      <td class="num hl">${pct(gs.remUptime, 1)}</td>
      <td class="num hl">${gs.remCpm.toFixed(1)}</td>
      <td class="num hl">${pct(gs.kickUptime, 1)}</td>
      <td class="num hl">${gs.cpm.toFixed(1)}</td>
      <td class="num">${pct(gs.activeTime, 1)}</td>
      <td class="num">${formatBigNum(gs.hps)}</td>
      <td colspan="7"></td>
    </tr>`
    const rows = g.pulls.map(p => {
      n++
      const short = p.durationMs < MIN_JUDGED_PULL_MS
      const c = (k: string) => p.cooldowns.find(cd => cd.key === k)
      return `<tr class="pull-row${short ? ' short' : ''}" onclick="window.location='${href(p)}'" title="${short ? 'Too short to judge; left out of averages' : 'Open this pull'}">
        <td class="num muted"><a href="${href(p)}">${order.get(p.fightId)}</a></td>
        <td>${resultCell(p)}</td>
        <td class="num">${formatDuration(p.durationMs)}${cutNote(p)}</td>
        <td class="num hl" title="${Math.round(p.rem.cappedMs / 1000)}s capped at ${p.rem.charges} charges · ${p.remAvg.toFixed(1)} avg active on the raid">${graded(pct(p.rem.uptimePct, 1), gradeEfficiency(p.rem.uptimePct))}</td>
        <td class="num hl" title="${p.rem.casts.length} Renewing Mist casts">${p.rem.cpm.toFixed(1)} <span class="delta">${signed(p.rem.cpm - s.remCpm, 1)}</span></td>
        <td class="num hl" title="${Math.round(p.kick.idleMs / 1000)}s ready and unused">${graded(pct(p.kick.uptimePct, 1), gradeEfficiency(p.kick.uptimePct))}</td>
        <td class="num hl">${p.cpm.toFixed(1)} <span class="delta">${signed(p.cpm - s.cpm, 1)}</span></td>
        <td class="num">${graded(pct(p.activeTimePct, 1), gradeActiveTime(p.activeTimePct))}</td>
        <td class="num">${formatBigNum(p.healing.hps)}</td>
        <td class="num">${pct(p.healing.overhealPct)}</td>
        ${cdCell(c('celestial'))}
        ${cdCell(c('conduit'))}
        ${cdCell(c('revival'))}
        ${cdCell(c('cocoon'))}
        <td class="num">${pct(p.mana.endPct)}</td>
        <td class="num">${p.deaths.length}${p.monkDied ? ' <span class="you-died" title="You died this pull">†</span>' : ''}</td>
      </tr>`
    }).join('')
    return head + rows
  }).join('')

  const celestialName = pulls[0]?.cooldowns.find(c => c.key === 'celestial')?.name.replace('Invoke ', '') ?? 'Celestial'
  return `
    <div class="table-wrap">
      <table class="pulls">
        <thead><tr>
          <th>#</th><th>Result</th><th class="num">Time</th>
          <th class="num hl" title="Share of the pull Renewing Mist was recharging instead of capped (WoWAnalyzer's cast efficiency)">ReM up</th>
          <th class="num hl" title="Renewing Mist casts per minute (Δ vs night)">ReM/min</th>
          <th class="num hl" title="Share of the pull Rushing Wind Kick spent on cooldown">RWK up</th>
          <th class="num hl" title="Casts per minute (Δ vs night)">CPM</th>
          <th class="num">Active</th><th class="num">HPS</th><th class="num">OH</th>
          <th class="num">${esc(celestialName)}</th><th class="num">Conduit</th><th class="num">Revival</th><th class="num">Cocoon</th>
          <th class="num">Mana end</th><th class="num">Deaths</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="hint">
      ${graded('Good', 'good')} ${graded('Could be better', 'ok')} ${graded('Needs work', 'bad')} —
      cooldown columns are casts/possible, graded like WoWAnalyzer's cast efficiency (80% / 65%).
      Pulls under ${MIN_JUDGED_PULL_MS / 1000}s are dimmed and left out of averages. ✂ marks a pull cut at the death cutoff. Click a row to open the pull.
    </p>`
}

export async function renderNightPage(code: string, playerID: number | null, cutoff: number | null): Promise<string> {
  const report = await getReport(code)
  const monks = getMonks(report)
  const monk = resolveMonk(report, playerID)
  if (!monk) return renderErrorPage('No Monk found in this report.', '#/')

  const fights = bossPulls(report, monk.id)
  const crumbs = `<a href="#/">Home</a> <span>›</span> <span>${esc(report.title)}</span>`
  const dropdown = playerDropdown(monks, monk.id, id => `#/report/${code}${query(id, cutoff)}`)
  const monkRow = `<div class="form-row"><div class="field"><label>Mistweaver</label>${dropdown}</div>
    ${cutoffSelect(cutoff, c => `#/report/${code}${query(monk.id, c)}`)}
    <a class="wcl-link" href="https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}" target="_blank" rel="noopener">Open on WarcraftLogs ↗</a></div>`

  if (fights.length === 0) {
    const body = `${header(crumbs)}<div class="container">${monkRow}
      <div class="error-box">${esc(monk.name)} has no boss pulls in this report yet.</div></div>`
    return htmlLayout(`${report.title} — Mistweaver Graphs`, body)
  }

  const pulls = await loadPulls(code, report, fights, monk.id, cutoff)
  const s = summarize(pulls)
  const href = pullHref(cutoff)
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)

  const trends: Array<[TrendMetric, number]> = [
    [{ id: 't-rem', title: 'Renewing Mist uptime', value: p => p.rem.uptimePct, format: '.0%', domain: [0, 1] }, s.remUptime],
    [{ id: 't-remcpm', title: 'Renewing Mist casts per minute', value: p => p.rem.cpm, format: '.1f' }, s.remCpm],
    [{ id: 't-kick', title: 'Rushing Wind Kick uptime', value: p => p.kick.uptimePct, format: '.0%', domain: [0, 1] }, s.kickUptime],
    [{ id: 't-cpm', title: 'CPM', value: p => p.cpm, format: '.1f' }, s.cpm],
    [{ id: 't-active', title: 'Active time', value: p => p.activeTimePct, format: '.0%', domain: [0, 1] }, s.activeTime],
    [{ id: 't-hps', title: 'Effective HPS', value: p => p.healing.hps, format: '~s' }, s.hps],
    [{ id: 't-mana', title: 'Mana at end of pull', value: p => p.mana.endPct, format: '.0%', domain: [0, 1] }, judged.length ? judged.reduce((a, p) => a + p.mana.endPct, 0) / judged.length : 0],
  ]
  const bl = (p: PullAnalysis) => bossHref(code, monk.id, cutoff, p.encounterID, p.difficulty)
  const order = new Map(pulls.map((p, i) => [pullKey(p), i + 1]))
  const nightDips = dipList(
    judged.flatMap(p => findDips(p).map(d => ({ d, p }))).sort((a, b) => b.d.drop - a.d.drop).slice(0, 5),
    p => phaseNamesFor(report, p.encounterID),
    href,
  )
  const recurring = patternList(
    findPatterns(pulls),
    id => phaseNamesFor(report, id),
    href,
    p => `#${order.get(pullKey(p))}`,
  )
  const trendCards = trends.map(([m, avg]) => vizCard(pullTrend(judged, { ...m, badge: `night ${d3ish(avg, m.format)}` }, href, avg))).join('')

  const body = `
    ${header(crumbs)}
    <div class="container">
      ${monkRow}
      ${nightTiles(s)}
      <div class="section-label">Pull by pull</div>
      ${pullTable(pulls, s, href, bl)}
      <div class="section-label" style="margin-top:1.5rem">When you dip <span class="muted">— your metrics in each situation, against the whole night</span></div>
      <div class="dashboard-grid">
        <div class="card wide">${contextTable(contextBreakdown(pulls))}
          <p class="hint">Time you spent dead, and the tail of a wipe once 30% of the raid is down, are left out. Moving is measured from your position, sampled several times a second.</p></div>
        <div class="card wide"><div class="card-title">Recurring dips <span class="muted">— the same spot of the same boss, pull after pull</span></div>${recurring}
          <div class="card-title" style="margin-top:1.25rem">Biggest single dips</div>${nightDips}</div>
      </div>
      <div class="section-label" style="margin-top:1.5rem">Across the night <span class="muted">— dashed line is the night average; click a bar to open the pull</span></div>
      <div class="dashboard-grid trends">${trendCards}</div>
      <div class="section-label" style="margin-top:1.5rem">Compare with other nights</div>
      ${addReportForm([code], monk.name, cutoff)}
    </div>`

  return htmlLayout(`${report.title} — Mistweaver Graphs`, body)
}

function d3ish(v: number, format: string): string {
  if (format.endsWith('%')) return pct(v)
  if (format === '~s') return formatBigNum(v)
  return v.toFixed(1)
}

// ── Pull ───────────────────────────────────────────────────────────────────

function comparison(value: number, others: number[], digits: number, asPct: boolean): string {
  if (others.length === 0) return 'only pull on this boss'
  const avg = others.reduce((a, b) => a + b, 0) / others.length
  const d = asPct ? signed((value - avg) * 100, digits, ' pts') : signed(value - avg, digits)
  return `${d} vs your other ${others.length} pull${others.length === 1 ? '' : 's'} here`
}

export async function renderPullPage(code: string, fightId: number, playerID: number | null, cutoff: number | null): Promise<string> {
  const report = await getReport(code)
  const monks = getMonks(report)
  const monk = resolveMonk(report, playerID)
  if (!monk) return renderErrorPage('No Monk found in this report.', `#/report/${code}`)

  const fights = bossPulls(report, monk.id)
  const fight = fights.find(f => f.id === fightId)
  if (!fight) return renderErrorPage(`Fight #${fightId} is not a boss pull with ${monk.name} in it.`, `#/report/${code}${query(monk.id, cutoff)}`)

  // Loading the whole night is one batched request and fills the cache for the
  // neighbouring pulls, which the comparisons need anyway.
  const [pulls, heals] = await Promise.all([
    loadPulls(code, report, fights, monk.id, cutoff),
    fetchEvents(code, 'Healing', [fight.id], fight.startTime, fight.endTime, { sourceID: monk.id }),
  ])
  const cutHeals = (p: PullAnalysis) => heals.filter(e => e.timestamp <= p.startMs + p.durationMs)
  const idx = pulls.findIndex(p => p.fightId === fightId)
  const p = pulls[idx]
  if (!p) return renderErrorPage('Could not load this pull.', `#/report/${code}${query(monk.id, cutoff)}`)

  const href = pullHref(cutoff)
  const siblings = pulls.filter(o =>
    o.fightId !== p.fightId && o.encounterID === p.encounterID && o.difficulty === p.difficulty && o.durationMs >= MIN_JUDGED_PULL_MS)
  const bossPullNo = pulls.filter(o => o.encounterID === p.encounterID && o.difficulty === p.difficulty && o.startMs <= p.startMs).length

  const prev = pulls[idx - 1]
  const next = pulls[idx + 1]
  const pager = `<div class="pager">
    ${prev ? `<a href="${href(prev)}">← #${idx}: ${esc(prev.name)} (${esc(pullLabel(prev))})</a>` : '<span></span>'}
    ${next ? `<a href="${href(next)}">#${idx + 2}: ${esc(next.name)} (${esc(pullLabel(next))}) →</a>` : '<span></span>'}
  </div>`

  const kickCd = (p.kick.cooldownMs / 1000).toFixed(1)
  const tiles = `
    <div class="stats">
      ${tile('Renewing Mist uptime', graded(pct(p.rem.uptimePct, 1), gradeEfficiency(p.rem.uptimePct)),
        `${Math.round(p.rem.cappedMs / 1000)}s capped at ${p.rem.charges} charges · ${p.rem.casts.length} casts (${p.rem.cpm.toFixed(1)}/min)<br>${comparison(p.rem.uptimePct, siblings.map(o => o.rem.uptimePct), 1, true)}`, true)}
      ${tile(`${esc(p.kick.name)} uptime`, graded(pct(p.kick.uptimePct, 1), gradeEfficiency(p.kick.uptimePct)),
        `${Math.round(p.kick.idleMs / 1000)}s ready and unused · ${kickCd}s hasted CD<br>${comparison(p.kick.uptimePct, siblings.map(o => o.kick.uptimePct), 1, true)}`, true)}
      ${tile('CPM', p.cpm.toFixed(1), `${p.castCount} casts<br>${comparison(p.cpm, siblings.map(o => o.cpm), 1, false)}`, true)}
    </div>
    <div class="stats">
      ${tile('Result', resultCell(p), `${difficultyName(p.difficulty)} · pull ${bossPullNo} on this boss`)}
      ${tile('Duration', formatDuration(p.durationMs), p.cutAtDeath ? `cut at death ${p.cutAtDeath} · whole pull ${formatDuration(p.fullDurationMs)}` : '')}
      ${tile('Active time', graded(pct(p.activeTimePct, 1), gradeActiveTime(p.activeTimePct)), `~${Math.round(p.haste * 100)}% haste`)}
      ${tile('Effective HPS', formatBigNum(p.healing.hps), `${formatBigNum(p.healing.effective)} total`)}
      ${tile('Overheal', pct(p.healing.overhealPct))}
      ${tile('Mana', pct(p.mana.endPct), `at end · low ${pct(p.mana.minPct)}`)}
      ${tile('Deaths', `${p.deaths.length}`, p.monkDied ? 'including you' : '')}
    </div>`

  const cdRows = p.cooldowns.map(cd => `<tr>
      <td>${esc(cd.name)}</td>
      <td class="num">${cd.casts.length}</td>
      <td class="num">${cd.possible.toFixed(1)}</td>
      <td class="num">${graded(pct(cd.efficiency), gradeEfficiency(cd.efficiency))}</td>
      <td class="num">${Math.round(cd.cappedMs / 1000)}s</td>
    </tr>`).join('')
  const rotRows = p.rotational.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.casts.length}</td><td class="num">${r.cpm.toFixed(1)}</td></tr>`).join('')
  const castTables = `
    <div class="card">
      <div class="card-title">Major cooldowns</div>
      <table class="mini"><thead><tr><th>Spell</th><th class="num">Casts</th><th class="num">Possible</th><th class="num">Efficiency</th><th class="num">Unused</th></tr></thead>
      <tbody>${cdRows}</tbody></table>
    </div>
    <div class="card">
      <div class="card-title">Core spells</div>
      <table class="mini"><thead><tr><th>Spell</th><th class="num">Casts</th><th class="num">Per minute</th></tr></thead>
      <tbody>${rotRows}</tbody></table>
    </div>`

  const deathRows = p.deaths.map(d => `<tr class="${d.isMonk ? 'you' : ''}">
      <td class="num">${formatDuration(d.timeMs)}</td><td>${esc(d.name)}</td><td class="muted">${esc(d.killingBlow)}</td></tr>`).join('')
  const deaths = p.deaths.length
    ? `<div class="card"><div class="card-title">Deaths</div>
        <table class="mini"><thead><tr><th class="num">Time</th><th>Player</th><th>Killing blow</th></tr></thead><tbody>${deathRows}</tbody></table></div>`
    : ''

  const names = phaseNamesFor(report, p.encounterID)
  const dips = findDips(p)
  const dipCard = stackCard(
    'Where you dipped',
    [contextStrip(p, names), metricTimeline(p, 'rem', dips), metricTimeline(p, 'kick', dips), metricTimeline(p, 'cpm', dips)],
    `<div class="stack-part">${dipList(dips.map(d => ({ d, p })), () => names)}
      <p class="hint">Amber bands are stretches at least 10 pts (ReM), 15% (RWK) or 25% (CPM) below this pull's own level.
      <a href="${bossHref(code, monk.id, cutoff, p.encounterID, p.difficulty)}">See every pull on this boss →</a></p></div>`,
  )

  const vizs = [
    dipCard,
    vizCard(hotCount(p), true),
    vizCard(cooldownTimeline(p), true),
    vizCard(cpmTimeline(p.castTimes, p.durationMs, p.cpm), true),
    vizCard(hpsTimeline(cutHeals(p), fight.startTime, p.durationMs), true),
    vizCard(manaTimeline(p)),
    castTables,
    vizCard(healingBreakdown(p.table)),
    vizCard(castBreakdown(p.table)),
    deaths,
  ].join('\n')

  const dropdown = playerDropdown(monks, monk.id, id => `#/report/${code}/fight/${fightId}${query(id, cutoff)}`)
  const nightHref = `#/report/${code}${query(monk.id, cutoff)}`
  const title = `${p.name} #${bossPullNo}`
  const body = `
    ${header(`<a href="#/">Home</a> <span>›</span> <a href="${nightHref}">${esc(report.title)}</a> <span>›</span> <span>${esc(title)}</span>`)}
    <div class="container">
      <div class="form-row">
        <div class="field"><label>Mistweaver</label>${dropdown}</div>
        ${cutoffSelect(cutoff, c => `#/report/${code}/fight/${fightId}${query(monk.id, c)}`)}
        <a class="wcl-link" href="https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}?fight=${fightId}&type=healing&source=${monk.id}" target="_blank" rel="noopener">Open on WarcraftLogs ↗</a>
      </div>
      ${pager}
      ${tiles}
      <div class="dashboard-grid">${vizs}</div>
    </div>`

  return htmlLayout(`${title} — Mistweaver Graphs`, body)
}

// ── Boss ───────────────────────────────────────────────────────────────────

export async function renderBossPage(code: string, encounterID: number, difficulty: number, playerID: number | null, cutoff: number | null): Promise<string> {
  const report = await getReport(code)
  const monks = getMonks(report)
  const monk = resolveMonk(report, playerID)
  if (!monk) return renderErrorPage('No Monk found in this report.', `#/report/${code}`)

  const fights = bossPulls(report, monk.id)
  const all = await loadPulls(code, report, fights, monk.id, cutoff)
  const pulls = all.filter(p => p.encounterID === encounterID && (p.difficulty ?? 0) === difficulty)
  if (pulls.length === 0) return renderErrorPage('No pulls on that boss in this report.', `#/report/${code}${query(monk.id, cutoff)}`)

  const order = new Map(all.map((p, i) => [pullKey(p), i + 1]))
  const analysis = bossAnalysis(pulls, all, phaseNamesFor(report, encounterID), cutoff,
    p => `#${order.get(pullKey(p))} ${pullLabel(p)}`, 'your whole night')

  const title = `${pulls[0].name} (${difficultyName(pulls[0].difficulty)})`
  const dropdown = playerDropdown(monks, monk.id, id => `#/report/${code}/boss/${encounterID}/${difficulty}${query(id, cutoff)}`)
  const nightHref = `#/report/${code}${query(monk.id, cutoff)}`
  const body = `
    ${header(`<a href="#/">Home</a> <span>›</span> <a href="${nightHref}">${esc(report.title)}</a> <span>›</span> <span>${esc(title)}</span>`)}
    <div class="container">
      <div class="form-row"><div class="field"><label>Mistweaver</label>${dropdown}</div>
        ${cutoffSelect(cutoff, c => `#/report/${code}/boss/${encounterID}/${difficulty}${query(monk.id, c)}`)}</div>
      ${bossTiles(summarize(pulls))}
      ${analysis}
    </div>`
  return htmlLayout(`${title} — Mistweaver Graphs`, body)
}

function bossTiles(s: Summary): string {
  return `<div class="stats">
    ${tile('Renewing Mist uptime', graded(pct(s.remUptime, 1), gradeEfficiency(s.remUptime)), `${s.remCpm.toFixed(1)} casts/min`, true)}
    ${tile('Rushing Wind Kick uptime', graded(pct(s.kickUptime, 1), gradeEfficiency(s.kickUptime)), `${Math.round(s.kickIdleMs / 1000)}s ready and unused`, true)}
    ${tile('CPM', s.cpm.toFixed(1), `${s.judged} pull${s.judged === 1 ? '' : 's'} judged`, true)}
  </div>`
}

// Phase table, biggest dips and by-time averages for one boss. `all` is the wider set
// (the night, or every report) that the phase deltas are measured against.
function bossAnalysis(
  pulls: PullAnalysis[],
  all: PullAnalysis[],
  names: PhaseName[],
  cutoff: number | null,
  label: (p: PullAnalysis) => string,
  against: string,
): string {
  const href = pullHref(cutoff)
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  const base = rates(all.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS).flatMap(p => p.timeline))

  const phases = phaseBreakdown(pulls, names)
  const phaseTable = phases.length
    ? `<table class="mini context">
        <thead><tr><th>Phase</th><th class="num">Pulls</th><th class="num">Time</th><th class="num">ReM up</th><th class="num">RWK up</th><th class="num">CPM</th><th class="num">Moving</th></tr></thead>
        <tbody>${phases.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.pulls}</td><td class="num">${formatDuration(r.rates.seconds * 1000)}</td>${ratesCells(r.rates, base)}</tr>`).join('')}</tbody>
      </table><p class="hint">Deltas are against ${esc(against)}. Phase times come from WarcraftLogs.</p>`
    : '<p class="hint">WarcraftLogs has no phase data for this boss, so the by-time view below is the one to read.</p>'

  const avg = alignedAverage(judged)
  const aligned = stackCard(
    'By time into the pull',
    (['rem', 'kick', 'cpm'] as MetricKey[]).map(m => alignedTimeline(judged, avg, m, label)),
    '<p class="hint">Grey lines are each pull; the bold line is their average at that point. A dip in the bold line recurs pull after pull.</p>',
  )

  const dips = dipList(
    judged.flatMap(p => findDips(p).map(d => ({ d, p }))).sort((a, b) => b.d.drop - a.d.drop).slice(0, 10),
    () => names,
    href,
    label,
  )

  const recurring = patternList(findPatterns(pulls), () => names, href, label)

  return `<div class="dashboard-grid">
    <div class="card wide"><div class="card-title">By phase</div>${phaseTable}</div>
    <div class="card wide"><div class="card-title">Recurring dips on this boss</div>${recurring}</div>
    <div class="card wide"><div class="card-title">Biggest dips on this boss</div>${dips}</div>
    ${aligned}
  </div>`
}

// ── Several reports ────────────────────────────────────────────────────────

function addReportForm(codes: string[], name: string | null, cutoff: number | null): string {
  return `<form class="form-row" data-route="/go">
    <input type="hidden" name="logs" value="${esc(codes.join(','))}">
    ${name ? `<input type="hidden" name="name" value="${esc(name)}">` : ''}
    ${cutoff !== getSettings().deathCutoff ? `<input type="hidden" name="cutoff" value="${cutoff ?? 0}">` : ''}
    <div class="field grow"><label for="more">Add reports</label>
      <textarea id="more" name="log" rows="2" required placeholder="Paste one or more WarcraftLogs URLs, one per line"></textarea></div>
    <button type="submit">Compare</button>
  </form>`
}

function nameDropdown(names: string[], selected: string | null, urlFor: (n: string) => string): string {
  if (names.length <= 1) return `<span class="monk-name">${esc(names[0] ?? '')}</span>`
  const urls = Object.fromEntries(names.map(n => [n, urlFor(n)]))
  return `<select class="player-select" data-urls='${escapeAttr(JSON.stringify(urls))}'
    onchange="window.location=JSON.parse(this.dataset.urls)[this.value]">
    ${names.map(n => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`
}

function multiControls(m: MultiLoad, codes: string[], cutoff: number | null, path: string): string {
  const reportRows = m.sources.map(src => {
    const mine = m.pulls.filter(p => p.reportCode === src.code)
    const others = codes.filter(c => c !== src.code)
    const remove = others.length ? `<a class="muted" href="${others.length === 1 ? `#/report/${others[0]}` : `#/multi${multiQuery(others, m.monkName, cutoff)}`}">remove</a>` : ''
    const night = src.monk ? `<a href="#/report/${src.code}${query(src.monk.id, cutoff)}">${esc(src.report.title)}</a>` : esc(src.report.title)
    return `<tr><td class="num">${nightLabel(src.report.startTime)}</td><td>${night}</td>
      <td class="num">${src.monk ? `${mine.length} boss pull${mine.length === 1 ? '' : 's'}` : `<span class="g-bad">${esc(m.monkName ?? 'Monk')} not in this report</span>`}</td><td>${remove}</td></tr>`
  }).join('')
  return `
    <div class="form-row">
      <div class="field"><label>Mistweaver</label>${nameDropdown(m.monkNames, m.monkName, n => `${path}${multiQuery(codes, n, cutoff)}`)}</div>
      ${cutoffSelect(cutoff, c => `${path}${multiQuery(codes, m.monkName, c)}`)}
    </div>
    <div class="card" style="margin-bottom:1.5rem">
      <div class="card-title">Reports</div>
      <table class="mini"><tbody>${reportRows}</tbody></table>
      ${addReportForm(codes, m.monkName, cutoff)}
    </div>`
}

function byNightTable(pulls: PullAnalysis[], cutoff: number | null, bossLinkFor: (p: PullAnalysis) => string): string {
  const nights = [...new Set(pulls.map(p => p.reportCode))]
  const row = (label: string, ps: PullAnalysis[], cls = '') => {
    const s = summarize(ps)
    const killed = ps.some(p => p.kill)
    const best = Math.min(...ps.map(p => (p.kill ? 0 : p.bossPct ?? 100)))
    return `<tr class="${cls}"><td>${label}</td>
      <td class="num">${ps.length}</td><td class="num">${killed ? `${s.kills} kill${s.kills === 1 ? '' : 's'}` : `best ${best.toFixed(1)}%`}</td>
      <td class="num">${graded(pct(s.remUptime, 1), gradeEfficiency(s.remUptime))}</td><td class="num">${s.remCpm.toFixed(1)}</td>
      <td class="num">${graded(pct(s.kickUptime, 1), gradeEfficiency(s.kickUptime))}</td><td class="num">${s.cpm.toFixed(1)}</td>
      <td class="num">${graded(pct(s.activeTime, 1), gradeActiveTime(s.activeTime))}</td><td class="num">${formatBigNum(s.hps)}</td></tr>`
  }
  const rows = nights.map(code => {
    const ps = pulls.filter(p => p.reportCode === code)
    return row(`<a href="${bossLinkFor(ps[0])}">${nightLabel(ps[0].reportStartTime)}</a>`, ps)
  }).join('')
  return `<table class="mini context">
    <thead><tr><th>Night</th><th class="num">Pulls</th><th class="num">Result</th><th class="num">ReM up</th><th class="num">ReM/min</th>
      <th class="num">RWK up</th><th class="num">CPM</th><th class="num">Active</th><th class="num">HPS</th></tr></thead>
    <tbody>${rows}${nights.length > 1 ? row('All nights', pulls, 'base-row') : ''}</tbody></table>`
}

function bossTrends(pulls: PullAnalysis[], cutoff: number | null): string {
  const judged = pulls.filter(p => p.durationMs >= MIN_JUDGED_PULL_MS)
  // A trend needs something to compare; one pull is already fully described by its row.
  if (judged.length < 2) return ''
  const s = summarize(pulls)
  const metrics: Array<[TrendMetric, number]> = [
    [{ id: 'rem', title: 'Renewing Mist uptime', value: p => p.rem.uptimePct, format: '.0%', domain: [0, 1] }, s.remUptime],
    [{ id: 'kick', title: 'Rushing Wind Kick uptime', value: p => p.kick.uptimePct, format: '.0%', domain: [0, 1] }, s.kickUptime],
    [{ id: 'cpm', title: 'CPM', value: p => p.cpm, format: '.1f' }, s.cpm],
  ]
  return `<div class="dashboard-grid trends">${metrics.map(([m, avg]) =>
    vizCard(pullTrend(judged, { ...m, badge: `avg ${d3ish(avg, m.format)}` }, pullHref(cutoff), avg))).join('')}</div>`
}

// Phase names come from whichever report has them for this boss.
function multiPhaseNames(m: MultiLoad, encounterID: number): PhaseName[] {
  return m.sources.map(src => phaseNamesFor(src.report, encounterID)).find(n => n.length) ?? []
}

// "Mar 25 #3": the night and the pull's number within that night.
function multiPullLabel(all: PullAnalysis[], p: PullAnalysis): string {
  const n = all.filter(o => o.reportCode === p.reportCode && o.startMs <= p.startMs).length
  return `${nightLabel(p.reportStartTime)} #${n}`
}

async function multiOrError(codes: string[], name: string | null, cutoff: number | null): Promise<MultiLoad | string> {
  if (codes.length === 0) return renderErrorPage('No reports given.', '#/')
  const m = await loadMulti(codes, name, cutoff)
  if (!m.monkName) return renderErrorPage('None of these reports has a Monk in it.', '#/')
  return m
}

export async function renderMultiPage(codes: string[], name: string | null, cutoff: number | null): Promise<string> {
  const m = await multiOrError(codes, name, cutoff)
  if (typeof m === 'string') return m

  // Bosses in the order first pulled, with each boss's difficulties side by side.
  const firstSeen = new Map<number, number>()
  m.pulls.forEach((p, i) => { if (!firstSeen.has(p.encounterID)) firstSeen.set(p.encounterID, i) })
  const groups = groupByBoss(m.pulls).sort((a, b) =>
    firstSeen.get(a.pulls[0].encounterID)! - firstSeen.get(b.pulls[0].encounterID)! || (a.difficulty ?? 0) - (b.difficulty ?? 0))
  const nights = new Set(m.pulls.map(p => p.reportCode)).size
  const sections = groups.map(g => {
    const killed = g.pulls.some(p => p.kill)
    const best = Math.min(...g.pulls.map(p => (p.kill ? 0 : p.bossPct ?? 100)))
    const n = new Set(g.pulls.map(p => p.reportCode)).size
    const deep = `#/multi/boss/${g.pulls[0].encounterID}/${g.difficulty ?? 0}${multiQuery(codes, m.monkName, cutoff)}`
    const oneNight = (p: PullAnalysis) => bossHref(p.reportCode, p.monkId, cutoff, p.encounterID, p.difficulty)
    return `<section class="boss-section">
      <div class="boss-head">
        <h2>${esc(g.name)} <span class="muted">${difficultyName(g.difficulty)}</span></h2>
        <span class="muted">${g.pulls.length} pull${g.pulls.length === 1 ? '' : 's'} over ${n} night${n === 1 ? '' : 's'} · ${killed ? 'Killed' : `best ${best.toFixed(1)}%`}</span>
        <a href="${deep}">Phases, timing and dips →</a>
      </div>
      <div class="card">${byNightTable(g.pulls, cutoff, oneNight)}</div>
      ${bossTrends(g.pulls, cutoff)}
    </section>`
  }).join('')

  const body = `
    ${header(`<a href="#/">Home</a> <span>›</span> <span>${nights} night${nights === 1 ? '' : 's'}, by boss</span>`)}
    <div class="container">
      ${multiControls(m, codes, cutoff, '#/multi')}
      ${nightTiles(summarize(m.pulls))}
      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-title">Recurring dips <span class="muted">— the same spot of the same boss, across nights</span></div>
        ${patternList(findPatterns(m.pulls), id => multiPhaseNames(m, id), pullHref(cutoff), p => multiPullLabel(m.pulls, p))}
      </div>
      ${sections || '<div class="error-box">No boss pulls found for this Monk.</div>'}
      <p class="hint">Each boss's charts run across every pull in real-time order; hover a bar for its night. Click a night to open that night's view of the boss.</p>
    </div>`
  return htmlLayout('By boss — Mistweaver Graphs', body)
}

export async function renderMultiBossPage(codes: string[], name: string | null, cutoff: number | null, encounterID: number, difficulty: number): Promise<string> {
  const m = await multiOrError(codes, name, cutoff)
  if (typeof m === 'string') return m
  const pulls = m.pulls.filter(p => p.encounterID === encounterID && (p.difficulty ?? 0) === difficulty)
  if (pulls.length === 0) return renderErrorPage('No pulls on that boss in these reports.', `#/multi${multiQuery(codes, m.monkName, cutoff)}`)

  const names = m.sources.map(src => phaseNamesFor(src.report, encounterID)).find(n => n.length) ?? []
  const label = (p: PullAnalysis) => {
    const n = pulls.filter(o => o.reportCode === p.reportCode && o.startMs <= p.startMs).length
    return `${nightLabel(p.reportStartTime)} #${n} ${pullLabel(p)}`
  }
  const title = `${pulls[0].name} (${difficultyName(pulls[0].difficulty)})`
  const path = `#/multi/boss/${encounterID}/${difficulty}`
  const oneNight = (p: PullAnalysis) => bossHref(p.reportCode, p.monkId, cutoff, p.encounterID, p.difficulty)

  const body = `
    ${header(`<a href="#/">Home</a> <span>›</span> <a href="#/multi${multiQuery(codes, m.monkName, cutoff)}">By boss</a> <span>›</span> <span>${esc(title)}</span>`)}
    <div class="container">
      ${multiControls(m, codes, cutoff, path)}
      ${bossTiles(summarize(pulls))}
      <div class="card" style="margin-bottom:1.25rem"><div class="card-title">By night</div>${byNightTable(pulls, cutoff, oneNight)}</div>
      ${bossTrends(pulls, cutoff)}
      <div style="margin-top:1.25rem">${bossAnalysis(pulls, m.pulls, names, cutoff, label, 'all your boss pulls in these reports')}</div>
    </div>`
  return htmlLayout(`${title} across nights — Mistweaver Graphs`, body)
}
