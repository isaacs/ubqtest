// Parsers of the benchmark project.
export const parseQuery = (query: string): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {}
  for (const part of query.replace(/^\?/, '').split('&').filter(Boolean)) {
    const [key = '', value = ''] = part.split('=').map(text => decodeURIComponent(text.replace(/\+/g, ' ')))
    const old = out[key]
    out[key] = old === undefined ? value : Array.isArray(old) ? [...old, value] : [old, value]
  }
  return out
}

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds of a text such as `1h30m`. */
export const parseDuration = (text: string): number => {
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)]
  if (!parts.length || parts.map(part => part[0]).join('') !== text.replace(/\s+/g, ''))
    throw new SyntaxError(`not a duration: ${text}`)
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNITS[unit!]!, 0)
}

export const formatDuration = (ms: number): string => {
  if (ms < 0) throw new RangeError(`a duration is not negative: ${ms}`)
  const out: string[] = []
  for (const [unit, size] of Object.entries(UNITS).reverse()) {
    const n = Math.floor(ms / size)
    if (n) out.push(`${n}${unit}`)
    ms -= n * size
  }
  return out.join('') || '0ms'
}
