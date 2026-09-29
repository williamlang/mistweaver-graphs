// Pull-relative time helpers: charts use seconds on x and label them as m:ss.

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const clockAxis = {
  labelExpr: "floor(datum.value / 60) + ':' + (datum.value % 60 < 10 ? '0' : '') + floor(datum.value % 60)",
  tickMinStep: 15,
}
