// Many kinds of control flow, for the comparison of the two
// coverage methods. Some paths run in the tests, and some do not.
export type Item = { id: number; tags?: string[] }

export function grade(n: number): string {
  if (n > 90) return 'A'
  else if (n > 50) {
    return 'pass'
  }
  return 'fail'
}

export const pick = <T>(a: T | null, b: T): T => a ?? b

export const both = (a: unknown, b: unknown): string =>
  a && b ? 'both'
  : a || b ? 'one'
  : 'none'

export class Box<T> {
  #value: T
  constructor(value: T) {
    this.#value = value
  }
  get value(): T {
    return this.#value
  }
  map<U>(fn: (v: T) => U): Box<U> {
    return new Box(fn(this.#value))
  }
  static empty(): Box<undefined> {
    return new Box(undefined)
  }
}

export function kind(x: unknown): string {
  switch (typeof x) {
    case 'number':
      return 'n'
    case 'string': {
      const s = x as string
      if (s.length > 3) return 'long'
      break
    }
    case 'boolean':
      return 'b'
    default:
      return 'other'
  }
  return 'short'
}

export function total(items: Item[]): number {
  let sum = 0
  for (const item of items) {
    if (!item.tags) continue
    for (let i = 0; i < item.tags.length; i++) {
      if (item.tags[i] === 'stop') break
      sum += item.id
    }
  }
  while (sum > 100) sum -= 100
  return sum
}

export function guarded(fn: () => number): number | string {
  try {
    return fn()
  } catch (error) {
    return error instanceof RangeError ? 'range' : 'other'
  } finally {
    calls++
  }
}
export let calls = 0

export async function later(ms: number, fail = false): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, ms))
  if (fail) throw new Error('later failed')
  return 'done'
}

export function* count(to: number): Generator<number> {
  for (let i = 0; i < to; i++) {
    if (i === 5) return
    yield i
  }
}

export const defaults = (a = 1, { b = a || 2 }: { b?: number } = {}): number => a + b

export function never(): string {
  const text = 'never'
  return text.toUpperCase()
}

export const table = new Map<string, () => number>([
  ['one', () => 1],
  ['two', () => 2],
])
