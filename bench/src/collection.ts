// List and object functions of the benchmark project.
export const groupBy = <T>(list: T[], key: (item: T) => string): Record<string, T[]> => {
  const out: Record<string, T[]> = {}
  for (const item of list) (out[key(item)] ??= []).push(item)
  return out
}

export const chunk = <T>(list: T[], size: number): T[][] => {
  if (size < 1) throw new RangeError(`size must be 1 or more, got ${size}`)
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export const unique = <T>(list: T[]): T[] => [...new Set(list)]

export const sortBy = <T>(list: T[], key: (item: T) => number | string): T[] =>
  [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

type Plain = { [key: string]: unknown }
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const deepMerge = (a: Plain, b: Plain): Plain => {
  const out: Plain = { ...a }
  for (const [key, value] of Object.entries(b)) {
    const old = out[key]
    out[key] = isPlain(old) && isPlain(value) ? deepMerge(old, value) : value
  }
  return out
}
