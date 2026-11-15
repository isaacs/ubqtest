/** The milliseconds of one unit of time. */
export const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** A duration such as `1h30m`, in milliseconds. Only the units of the examples. */
export const parseDuration = (text: string): number => {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text)
  if (!m || !text) throw new SyntaxError(`not a duration: ${text}`)
  return Number(m[1] ?? 0) * 3_600_000 + Number(m[2] ?? 0) * 60_000 + Number(m[3] ?? 0) * 1000
}
