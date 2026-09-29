// Mistweaver spell and talent IDs, taken from WoWAnalyzer (common/SPELLS/monk.ts,
// common/TALENTS/monk.ts) and its MW Abilities module (patch 12.1).

export const SPELL = {
  RENEWING_MIST: 115151,
  RENEWING_MIST_HOT: 119611,
  ENVELOPING_MIST: 124682,
  VIVIFY: 116670,
  SHEILUNS_GIFT: 399491,
  SOOTHING_MIST: 115175,
  THUNDER_FOCUS_TEA: 116680,
  MANA_TEA: 115294,
  RISING_SUN_KICK: 107428,
  RUSHING_WIND_KICK: 467307,
  INVOKE_YULON: 322118,
  INVOKE_CHIJI: 325197,
  CELESTIAL_CONDUIT: 443028,
  REVIVAL: 115310,
  RESTORAL: 388615,
  LIFE_COCOON: 116849,
  JADE_SERPENT_STATUE: 115313,
  TIGER_PALM: 100780,
  BLACKOUT_KICK: 100784,
  SPINNING_CRANE_KICK: 101546,
  CRACKLING_JADE_LIGHTNING: 117952,
  EXPEL_HARM: 322101,
  TOUCH_OF_DEATH: 322109,
  CHI_BURST: 123986,
  JADEFIRE_STOMP: 457974,
  DETOX: 115450,
  PARALYSIS: 115078,
  RING_OF_PEACE: 116844,
  LEG_SWEEP: 119381,
  TIGERS_LUST: 116841,
  // Heart of the Jade Serpent (Conduit of the Celestials) cooldown-rate buffs
  HEART_OF_THE_JADE_SERPENT: 443421,
  HEART_OF_THE_JADE_SERPENT_UNITY: 443616,
  HEART_OF_THE_JADE_SERPENT_AVATAR: 1238904,
} as const

// Talent tree entry IDs (combatantinfo `talentTree[].id`), not spell IDs.
export const TALENT_ENTRY = {
  POOL_OF_MISTS: 125932,
  GIFT_OF_THE_CELESTIALS: 124894,
  UPLIFTED_SPIRITS: 124869,
  CHRYSALIS: 124878,
  SHEILUNS_GIFT: 124904,
  RUSHING_WIND_KICK: 128221,
  INVOKE_CHIJI: 124914,
  INVOKE_YULON: 124915,
  RESTORAL: 124918,
  REVIVAL: 124919,
  MANA_TEA: 124920,
  FOCUSED_THUNDER: 124897,
  CELESTIAL_CONDUIT: 136562,
} as const

export type TalentKey = keyof typeof TALENT_ENTRY
export type Talents = Record<TalentKey, boolean>

export function detectTalents(talentTree: Array<{ id: number }> | undefined): Talents {
  const ids = new Set((talentTree ?? []).map(t => t.id))
  return Object.fromEntries(
    Object.entries(TALENT_ENTRY).map(([k, id]) => [k, ids.has(id)]),
  ) as Talents
}

// Casts that trigger the GCD (WoWAnalyzer Abilities.tsx). Off-GCD spells like TFT,
// Life Cocoon, Fortifying Brew, potions and trinkets are deliberately absent.
export const GCD_SPELLS = new Set<number>([
  SPELL.RENEWING_MIST, SPELL.MANA_TEA, SPELL.SOOTHING_MIST, SPELL.INVOKE_YULON,
  SPELL.INVOKE_CHIJI, SPELL.CELESTIAL_CONDUIT, SPELL.REVIVAL, SPELL.RESTORAL,
  SPELL.ENVELOPING_MIST, SPELL.VIVIFY, SPELL.SHEILUNS_GIFT, SPELL.JADE_SERPENT_STATUE,
  SPELL.DETOX, SPELL.PARALYSIS, SPELL.RING_OF_PEACE, SPELL.LEG_SWEEP, SPELL.TIGERS_LUST,
  SPELL.TIGER_PALM, SPELL.BLACKOUT_KICK, SPELL.RISING_SUN_KICK, SPELL.RUSHING_WIND_KICK,
  SPELL.SPINNING_CRANE_KICK, SPELL.CRACKLING_JADE_LIGHTNING, SPELL.EXPEL_HARM,
  SPELL.TOUCH_OF_DEATH, SPELL.CHI_BURST, SPELL.JADEFIRE_STOMP,
])

// Channels whose duration shows up as a buff on the monk or their target.
export const CHANNEL_BUFFS = new Set<number>([
  SPELL.SOOTHING_MIST, SPELL.MANA_TEA, SPELL.CELESTIAL_CONDUIT,
  SPELL.CRACKLING_JADE_LIGHTNING, SPELL.SPINNING_CRANE_KICK,
])

// Buffs we need from the Buffs event stream; used as a server-side filter.
export const TRACKED_BUFFS = [
  SPELL.RENEWING_MIST_HOT, SPELL.ENVELOPING_MIST, ...CHANNEL_BUFFS,
  SPELL.HEART_OF_THE_JADE_SERPENT, SPELL.HEART_OF_THE_JADE_SERPENT_UNITY, SPELL.HEART_OF_THE_JADE_SERPENT_AVATAR,
  SPELL.INVOKE_YULON, // the Yu'lon window is a buff on the monk with the cast's ID
]

// Invoke Chi-Ji has no buff to bound it (WoWAnalyzer fabricates one from the summon), so
// its window is taken as this long after the cast, matching Yu'lon's 12s buff.
export const CHIJI_WINDOW_MS = 12_000

// Heart of the Jade Serpent speeds up these cooldowns (WoWAnalyzer
// shared/hero/ConduitOfTheCelestials: MISTWEAVER_HEART_SPELLS). The standard and Yu'lon's
// avatar buffs are 1.75x each and multiply; Unity is 2.5x and overrides both.
export const HEART_AFFECTED = new Set<number>([
  SPELL.RENEWING_MIST, SPELL.RUSHING_WIND_KICK, SPELL.RISING_SUN_KICK,
  SPELL.THUNDER_FOCUS_TEA, SPELL.LIFE_COCOON,
])

export function heartRate(active: Set<number>): number {
  if (active.has(SPELL.HEART_OF_THE_JADE_SERPENT_UNITY)) return 1 + 2 * 0.75
  let rate = 1
  if (active.has(SPELL.HEART_OF_THE_JADE_SERPENT)) rate *= 1.75
  if (active.has(SPELL.HEART_OF_THE_JADE_SERPENT_AVATAR)) rate *= 1.75
  return rate
}

// Renewing Mist as WoWAnalyzer's Abilities defines it: a fixed (unhasted) 9s recharge,
// 2 charges or 3 with Pool of Mists, and Pool of Mists taking 1s off per kick cast.
export const REM_COOLDOWN_MS = 9000
export const POOL_OF_MISTS_CDR_MS = 1000

export interface CooldownDef {
  key: string
  name: string
  castId: number
  cooldownMs: number
  charges: number
}

// Major cooldowns, graded by cast efficiency. Their cooldown reduction is small enough
// that a fixed-cooldown charge simulation is honest, unlike the rotational spells below.
export function majorCooldowns(t: Talents): CooldownDef[] {
  const defs: CooldownDef[] = [
    t.INVOKE_CHIJI
      ? { key: 'celestial', name: 'Invoke Chi-Ji', castId: SPELL.INVOKE_CHIJI, cooldownMs: t.GIFT_OF_THE_CELESTIALS ? 60000 : 120000, charges: 1 }
      : { key: 'celestial', name: "Invoke Yu'lon", castId: SPELL.INVOKE_YULON, cooldownMs: t.GIFT_OF_THE_CELESTIALS ? 60000 : 120000, charges: 1 },
  ]
  if (t.CELESTIAL_CONDUIT) {
    defs.push({ key: 'conduit', name: 'Celestial Conduit', castId: SPELL.CELESTIAL_CONDUIT, cooldownMs: 90000, charges: 1 })
  }
  defs.push(
    t.RESTORAL
      ? { key: 'revival', name: 'Restoral', castId: SPELL.RESTORAL, cooldownMs: t.UPLIFTED_SPIRITS ? 150000 : 180000, charges: 1 }
      : { key: 'revival', name: 'Revival', castId: SPELL.REVIVAL, cooldownMs: t.UPLIFTED_SPIRITS ? 150000 : 180000, charges: 1 },
    { key: 'cocoon', name: 'Life Cocoon', castId: SPELL.LIFE_COCOON, cooldownMs: t.CHRYSALIS ? 75000 : 120000, charges: 1 },
  )
  return defs
}

export interface RotationalDef {
  key: string
  name: string
  castIds: number[]
}

// Rotational spells, tracked as casts per minute. Renewing Mist, the kicks and TFT all
// have procs and cooldown reduction (Pool of Mists, TFT'd kicks, BoK resets, tier) that
// a log alone cannot replay faithfully, so a rate compared across pulls is the honest
// measure.
export function rotationalSpells(t: Talents): RotationalDef[] {
  return [
    { key: 'rem', name: 'Renewing Mist', castIds: [SPELL.RENEWING_MIST] },
    t.RUSHING_WIND_KICK
      ? { key: 'kick', name: 'Rushing Wind Kick', castIds: [SPELL.RUSHING_WIND_KICK] }
      : { key: 'kick', name: 'Rising Sun Kick', castIds: [SPELL.RISING_SUN_KICK] },
    { key: 'tft', name: 'Thunder Focus Tea', castIds: [SPELL.THUNDER_FOCUS_TEA] },
    { key: 'env', name: 'Enveloping Mist', castIds: [SPELL.ENVELOPING_MIST] },
    t.SHEILUNS_GIFT
      ? { key: 'primary', name: "Sheilun's Gift", castIds: [SPELL.SHEILUNS_GIFT] }
      : { key: 'primary', name: 'Vivify', castIds: [SPELL.VIVIFY] },
    { key: 'manatea', name: 'Mana Tea', castIds: [SPELL.MANA_TEA] },
  ]
}

// Grading bands. Cast efficiency uses WoWAnalyzer's CastEfficiency defaults
// (recommended 80%, average issue 65%, major issue 45%).
export type Grade = 'good' | 'ok' | 'bad'

export function gradeEfficiency(eff: number): Grade {
  if (eff >= 0.8) return 'good'
  if (eff >= 0.65) return 'ok'
  return 'bad'
}

export function gradeActiveTime(pct: number): Grade {
  if (pct >= 0.9) return 'good'
  if (pct >= 0.8) return 'ok'
  return 'bad'
}
