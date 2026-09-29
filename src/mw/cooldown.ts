// A port of the parts of WoWAnalyzer's SpellUsable + CastEfficiency that grade a
// cooldown (parser/shared/modules/SpellUsable.tsx, CastEfficiency.tsx):
//
// - A spell starts the pull with full charges; each cast spends one.
// - Charges recharge one at a time over `cooldownMs`, sped up by cooldown-rate buffs
//   (modRate, e.g. Heart of the Jade Serpent) and by flat reductions (e.g. Pool of Mists).
// - A cast with no charge left means the log saw a reset we didn't model; like
//   SpellUsable, we treat it as a missed recharge: restore a charge, restart recharge
//   progress, then spend it.
// - Efficiency ("uptime") is the share of the pull the spell had fewer than max charges.
//   For single-charge spells WoWAnalyzer also counts cast time and GCD waits as
//   unavailable; we do too via `castingMs`.

export type CdEvent =
  | { t: number; kind: 'cast' }
  | { t: number; kind: 'reduce'; ms: number } // flat CDR in base-cooldown ms
  | { t: number; kind: 'rate'; rate: number }  // cooldown rate multiplier from t onward

export interface ChargeSegment { start: number; end: number; state: 'capped' | 'recharging' }

export interface ChargeSimulation {
  casts: number[]
  onCooldownMs: number
  cappedMs: number
  missedRecharges: number // casts at 0 simulated charges
  segments: ChargeSegment[]
}

export function simulateCharges(
  cooldownMs: number,
  maxCharges: number,
  events: CdEvent[],
  durationMs: number,
): ChargeSimulation {
  const sorted = [...events].sort((a, b) => a.t - b.t || order(a) - order(b))
  let charges = maxCharges
  let progress = 0 // ms of base cooldown recovered toward the next charge
  let rate = 1
  let now = 0
  let onCooldownMs = 0
  let missedRecharges = 0
  const casts: number[] = []
  const segments: ChargeSegment[] = []

  const mark = (t: number) => {
    const state: ChargeSegment['state'] = charges >= maxCharges ? 'capped' : 'recharging'
    const last = segments.at(-1)
    if (last && last.state === state && last.end === now) last.end = t
    else if (t > now) segments.push({ start: now, end: t, state })
  }

  // Advance the clock to `to`, restoring charges as recharge completes.
  const advance = (to: number) => {
    while (now < to) {
      if (charges >= maxCharges) {
        mark(to)
        now = to
        return
      }
      const needMs = (cooldownMs - progress) / rate
      const step = Math.min(needMs, to - now)
      mark(now + step)
      onCooldownMs += step
      progress += step * rate
      now += step
      if (progress >= cooldownMs - 1e-6) gainCharge()
    }
  }

  const gainCharge = () => {
    charges++
    progress = 0
  }

  for (const e of sorted) {
    const t = Math.max(0, Math.min(durationMs, e.t))
    advance(t)
    if (e.kind === 'rate') {
      rate = e.rate
    } else if (e.kind === 'reduce') {
      if (charges >= maxCharges) continue
      progress += e.ms
      while (progress >= cooldownMs && charges < maxCharges) {
        progress -= cooldownMs
        charges++
      }
      if (charges >= maxCharges) progress = 0
    } else {
      casts.push(t)
      if (charges === 0) {
        missedRecharges++
        gainCharge()
      }
      charges--
    }
  }
  advance(durationMs)

  return {
    casts,
    onCooldownMs,
    cappedMs: segments.filter(s => s.state === 'capped').reduce((s, g) => s + g.end - g.start, 0),
    missedRecharges,
    segments,
  }
}

// Rate changes apply before a cast at the same timestamp; reductions after it.
function order(e: CdEvent): number {
  return e.kind === 'rate' ? 0 : e.kind === 'cast' ? 1 : 2
}
