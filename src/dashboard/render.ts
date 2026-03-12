import { htmlLayout } from './layout.js'
import type { Report, Actor } from '../wcl/types.js'
import { fetchHealingTable, fetchHealEvents, getLastRateLimit } from '../wcl/client.js' // getLastRateLimit used by rateBadge()
import { healingBreakdown } from '../visualizations/healing-breakdown.js'
import { hpsTimeline } from '../visualizations/hps-timeline.js'
import { castBreakdown } from '../visualizations/cast-breakdown.js'
import { CHARACTER_NAME } from '../config.js'
import type { Visualization } from '../visualizations/types.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function findMonk(report: Report): Actor | null {
  const monks = report.masterData.actors.filter(
    a => a.type === 'Player' && a.subType === 'Monk',
  )
  if (monks.length === 0) return null
  if (CHARACTER_NAME) {
    return monks.find(m => m.name.toLowerCase() === CHARACTER_NAME.toLowerCase()) ?? monks[0]
  }
  return monks[0]
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatBigNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function rateBadge(): string {
  const rl = getLastRateLimit()
  if (!rl) return ''
  const used = Math.round(rl.pointsSpentThisHour)
  const pct = Math.round((rl.pointsSpentThisHour / rl.limitPerHour) * 100)
  const resetMin = Math.ceil(rl.pointsResetIn / 60)
  const color = pct >= 80 ? '#f38ba8' : pct >= 50 ? '#fab387' : '#a6e3a1'
  return `<div class="rate-badge" title="Resets in ${resetMin}m">
    <span style="color:${color}">${used}/${rl.limitPerHour}</span>
    <span class="rate-label">pts/hr</span>
  </div>`
}

function header(breadcrumbs: string): string {
  return `<header><h1>Mistweaver Graphs</h1><nav>${breadcrumbs}</nav>${rateBadge()}</header>`
}

function escapeAttr(json: string): string {
  return json.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function vizCard(viz: Visualization, wide = false): string {
  return `
    <div class="card${wide ? ' wide' : ''}">
      <div class="card-title">${viz.title}</div>
      <div data-spec='${escapeAttr(JSON.stringify(viz.spec))}'></div>
    </div>`
}

// ── Pages ──────────────────────────────────────────────────────────────────

export function renderAuthPage(authUrl: string): string {
  const body = `
    ${header('')}
    <div class="container">
      <div class="auth-center">
        <h2>Mistweaver Graphs</h2>
        <p>Connect your WarcraftLogs account to analyze your Mistweaver Monk logs.</p>
        <a href="${authUrl}" class="btn-primary">Authorize with WarcraftLogs</a>
      </div>
    </div>`
  return htmlLayout('Mistweaver Graphs', body)
}

export function renderHomePage(): string {
  const body = `
    ${header('')}
    <div class="container">
      <form class="form-row" onsubmit="window.location='/report/'+encodeURIComponent(document.getElementById('code').value);return false;">
        <div class="field">
          <label>Log Code</label>
          <input id="code" type="text" placeholder="e.g. ABCdef123456" autocomplete="off" required>
        </div>
        <button type="submit">Load Report</button>
      </form>
      <p style="color:#585b70;font-size:0.8125rem;">
        Paste the log code from a WarcraftLogs URL:<br>
        <code style="color:#a6adc8;">warcraftlogs.com/reports/<strong>ABCdef123456</strong></code>
      </p>
    </div>`
  return htmlLayout('Mistweaver Graphs', body)
}

export function renderErrorPage(message: string, backHref = '/'): string {
  const body = `
    ${header(`<a href="${backHref}">← Back</a>`)}
    <div class="container">
      <div class="error-box">${message}</div>
    </div>`
  return htmlLayout('Error — Mistweaver Graphs', body)
}

export async function renderReportPage(code: string, report: Report): Promise<string> {
  const monk = findMonk(report)
  const monkNote = monk
    ? `<span>Tracking <strong style="color:#4ade80">${monk.name}</strong></span>`
    : `<span style="color:#f38ba8">No Monk found — set WCL_CHARACTER_NAME in .env</span>`

  const fightLinks = report.fights
    .map(f => {
      const cls = f.kill ? 'kill' : 'wipe'
      const dur = formatDuration(f.endTime - f.startTime)
      return `<a class="fight-pill ${cls}" href="/report/${code}/fight/${f.id}">
        ${f.name} <span class="dur">${dur}</span>
      </a>`
    })
    .join('\n')

  const body = `
    ${header(`<a href="/">Home</a> <span>›</span> <span>${report.title}</span>`)}
    <div class="container">
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Report</div>
          <div class="stat-value" style="font-size:1rem">${report.title}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Fights</div>
          <div class="stat-value">${report.fights.length}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Kills</div>
          <div class="stat-value">${report.fights.filter(f => f.kill).length}</div>
        </div>
      </div>
      <div style="margin-bottom:0.5rem">${monkNote}</div>
      <hr class="divider">
      <div class="section-label">Fights — click to open dashboard</div>
      <div class="fight-grid" style="margin-top:0.5rem">
        <a class="fight-pill" href="/report/${code}/fight/all">All Fights Combined</a>
        ${fightLinks}
      </div>
    </div>`

  return htmlLayout(`${report.title} — Mistweaver Graphs`, body)
}

export async function renderFightPage(
  code: string,
  report: Report,
  fightId: number | null,
): Promise<string> {
  const monk = findMonk(report)
  if (!monk) return renderErrorPage('No Monk player found in this report. Set WCL_CHARACTER_NAME in your .env.', `/report/${code}`)

  let fightIDs: number[] | null = null
  let pageTitle: string
  let fightStartMs: number
  let fightEndMs: number

  if (fightId === null) {
    pageTitle = 'All Fights'
    fightStartMs = Math.min(...report.fights.map(f => f.startTime))
    fightEndMs = Math.max(...report.fights.map(f => f.endTime))
  } else {
    const fight = report.fights.find(f => f.id === fightId)
    if (!fight) return renderErrorPage(`Fight #${fightId} not found in report.`, `/report/${code}`)
    fightIDs = [fightId]
    pageTitle = fight.name
    fightStartMs = fight.startTime
    fightEndMs = fight.endTime
  }

  const [table, events] = await Promise.all([
    fetchHealingTable(code, fightIDs, monk.id),
    fetchHealEvents(code, fightIDs, monk.id, fightStartMs, fightEndMs),
  ])

  const durationMs = fightEndMs - fightStartMs
  const effectiveHealing = table.entries.reduce((sum, e) => sum + (e.total - e.overheal), 0)
  const totalOverheal = table.entries.reduce((sum, e) => sum + e.overheal, 0)
  const totalHealing = effectiveHealing + totalOverheal
  const hps = durationMs > 0 ? Math.round(effectiveHealing / (durationMs / 1000)) : 0
  const ohPct = totalHealing > 0 ? Math.round((totalOverheal / totalHealing) * 100) : 0

  const stats = `
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Duration</div>
        <div class="stat-value">${formatDuration(durationMs)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Effective HPS</div>
        <div class="stat-value">${formatBigNum(hps)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total Healing</div>
        <div class="stat-value">${formatBigNum(effectiveHealing)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Overheal %</div>
        <div class="stat-value" style="color:${ohPct > 40 ? '#f38ba8' : '#a6e3a1'}">${ohPct}%</div>
      </div>
    </div>`

  const vizs = [
    vizCard(hpsTimeline(events, fightStartMs, fightEndMs), true),
    vizCard(healingBreakdown(table)),
    vizCard(castBreakdown(table)),
  ].join('\n')

  const body = `
    ${header(`<a href="/">Home</a> <span>›</span> <a href="/report/${code}">${report.title}</a> <span>›</span> <span>${pageTitle}</span>`)}
    <div class="container">
      ${stats}
      <div class="dashboard-grid">
        ${vizs}
      </div>
    </div>`

  return htmlLayout(`${pageTitle} — Mistweaver Graphs`, body)
}
