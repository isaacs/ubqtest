/** The milliseconds of one unit of time. */
export const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** A duration such as `1h30m`, in milliseconds. */
export const parseDuration = (text: string): number => {
  if (!/^(\d+(ms|s|m|h|d))+$/.test(text)) throw new SyntaxError(`not a duration: ${text}`)
  let total = 0
  for (const [, n, unit] of text.matchAll(/(\d+)(ms|s|m|h|d)/g)) total += Number(n) * UNIT_MS[unit as keyof typeof UNIT_MS]
  return total
}
