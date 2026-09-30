import type { Pattern } from './patterns.js'
import type { MetricKey } from './dips.js'

// Reminders for Northern Sky Raid Tools (NSRT). A reminder note is an EncounterID line
// followed by one line per reminder, e.g.
//   EncounterID:3181
//   time:57;ph:1;tag:Bredie;text:keep casting!;TTS:keep casting!;
// `time` is seconds into NSRT phase `ph`. NSRT shows the reminder a few seconds before
// that (8s for text by default) and speaks the TTS, so `time` is the moment the dip starts.
//
// NSRT phases only count up: a boss module bumps the phase on each transition it detects,
// so a phase that returns gets a new, higher number. Patterns carry that segment count.
// A few NSRT modules detect fewer transitions than WarcraftLogs logs, so the phase is
// worth a glance in NSRT for bosses whose phases repeat.

const CUES: Record<MetricKey, { text: string; tts: string }> = {
  rem: { text: 'Dip spot: keep Renewing Mist rolling', tts: 'Renewing Mist' },
  kick: { text: 'Dip spot: keep kicking', tts: 'Kick' },
  cpm: { text: 'Dip spot: keep casting', tts: 'Keep casting' },
}

// NSRT splits fields on ';' and reads up to it, so strip anything that would break a field.
function clean(s: string): string {
  return s.replace(/[;\n\r]/g, ' ').trim()
}

export function nsrtReminder(p: Pattern, tag: string): string {
  const cue = CUES[p.metric]
  return `time:${Math.round(p.start)};ph:${p.segment};tag:${clean(tag)};text:${clean(cue.text)};TTS:${clean(cue.tts)};`
}

// A pasteable note for one boss. Openers are left out: a reminder at the pull timer isn't
// a warning you can act on.
export function nsrtNote(patterns: Pattern[], tag: string): string {
  const usable = patterns.filter(p => !p.opener)
  if (usable.length === 0) return ''
  const lines = usable
    .slice()
    .sort((a, b) => a.segment - b.segment || a.start - b.start)
    .map(p => nsrtReminder(p, tag))
  return [`EncounterID:${usable[0].encounterID}`, ...new Set(lines)].join('\n')
}
