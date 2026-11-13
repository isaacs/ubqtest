// Values as text, and the differences between two values.
import { inspect, isDeepStrictEqual } from 'node:util'

const MAX_TEXT = 4000
const MAX_DIFFS = 8

/** A value as text, with a size limit. */
export const show = (value: unknown): string => {
  // The stack of an error is noise here. The failure has its own stack.
  if (value instanceof Error) return `${value.name}: ${value.message}`
  const text = inspect(value, {
    depth: 6,
    breakLength: 76,
    maxArrayLength: 40,
    maxStringLength: 1000,
    sorted: true,
  })
  return text.length > MAX_TEXT ?
      `${text.slice(0, MAX_TEXT)}… (${text.length - MAX_TEXT} more characters)`
    : text
}

/** One difference between an actual value and an expected value. */
export interface Diff {
  /** `.items[3].id`, or an empty string for the root. */
  path: string
  actual: string
  expected: string
  note?: string
}

/** Differences as indented text, one block for each. */
export const showDiffs = (diffs: Diff[], more = 0): string => {
  const out: string[] = []
  for (const d of diffs) {
    if (d.path) out.push(d.path)
    const pad = d.path ? '  ' : ''
    out.push(`${pad}actual:   ${indent(d.actual, pad.length + 10)}`)
    out.push(`${pad}expected: ${indent(d.expected, pad.length + 10)}`)
    if (d.note) out.push(`${pad}note: ${d.note}`)
  }
  if (more) out.push(`… and ${more} more differences`)
  return out.join('\n')
}

const indent = (text: string, by: number): string =>
  text.replaceAll('\n', '\n' + ' '.repeat(by))

const typeName = (v: unknown): string =>
  v === null ? 'null'
  : typeof v !== 'object' ? typeof v
  : (Object.getPrototypeOf(v)?.constructor?.name ?? 'null-prototype object')

/** The difference that makes `Object.is(actual, expected)` false. */
export const diffEqual = (actual: unknown, expected: unknown): Diff => {
  const d: Diff = { path: '', actual: show(actual), expected: show(expected) }
  if (typeof actual === 'string' && typeof expected === 'string') {
    let i = 0
    while (i < actual.length && actual[i] === expected[i]) i++
    // A space that is not ASCII, or a character with no width, looks
    // like a different character, or like nothing. Then each
    // character that is not ASCII shows as its code.
    const hidden = /[^\x20-\x7e]/.test((actual[i] ?? '') + (expected[i] ?? ''))
    const text = (s: string): string =>
      hidden ? JSON.stringify(s).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : JSON.stringify(s)
    if (actual.length > 40 || expected.length > 40) {
      const from = Math.max(0, i - 20)
      d.actual = text(actual.slice(from, i + 200))
      d.expected = text(expected.slice(from, i + 200))
      d.note = `first difference at index ${i}; text shown from index ${from}`
    } else if (hidden) {
      d.actual = text(actual)
      d.expected = text(expected)
    }
  } else if (typeName(actual) !== typeName(expected)) {
    d.note = `types differ: ${typeName(actual)} and ${typeName(expected)}`
  } else if (
    typeof actual === 'object' &&
    actual !== null &&
    isDeepStrictEqual(actual, expected)
  ) {
    d.note =
      'same content, but not the same object. Use assert.deepEqual to compare content.'
  } else if (d.actual === d.expected) {
    d.note = 'the values print the same, but Object.is finds them different'
  }
  return d
}

const key = (k: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`

const MISSING = '(missing)'

/**
 * The differences that make two values not deeply equal. If `partial`
 * is true, `expected` is a pattern for `assert.match`: extra keys in
 * `actual` are fine, and a RegExp tests a string.
 */
export const diffDeep = (
  actual: unknown,
  expected: unknown,
  partial = false,
): { diffs: Diff[]; more: number } => {
  const diffs: Diff[] = []
  let more = 0
  const seen = new Set<unknown>()
  const add = (path: string, a: string, e: string, note?: string): void => {
    if (diffs.length < MAX_DIFFS)
      diffs.push({ path, actual: a, expected: e, ...(note && { note }) })
    else more++
  }
  const walk = (a: unknown, e: unknown, path: string): void => {
    if (Object.is(a, e)) return
    if (partial && e instanceof RegExp && typeof a === 'string') {
      if (!e.test(a)) add(path, show(a), show(e))
      return
    }
    if (
      typeof a !== 'object' ||
      typeof e !== 'object' ||
      a === null ||
      e === null
    ) {
      const d = diffEqual(a, e)
      return add(path, d.actual, d.expected, d.note)
    }
    if (seen.has(a)) return
    seen.add(a)
    if (Array.isArray(a) && Array.isArray(e)) {
      if (a.length !== e.length)
        add(`${path}.length`, String(a.length), String(e.length))
      const n = Math.min(a.length, e.length)
      for (let i = 0; i < n; i++) walk(a[i], e[i], `${path}[${i}]`)
      for (let i = n; i < a.length; i++) add(`${path}[${i}]`, show(a[i]), MISSING)
      for (let i = n; i < e.length; i++) add(`${path}[${i}]`, MISSING, show(e[i]))
      return
    }
    const plain = (v: object): boolean => {
      const p = Object.getPrototypeOf(v)
      return p === Object.prototype || p === null
    }
    if ((partial && plain(e)) || (plain(a) && plain(e))) {
      const ao = a as Record<string, unknown>
      const eo = e as Record<string, unknown>
      const keys = partial ? Object.keys(eo) : (
        [...new Set([...Object.keys(ao), ...Object.keys(eo)])].sort()
      )
      for (const k of keys) {
        if (!(k in ao)) add(path + key(k), MISSING, show(eo[k]))
        else if (!(k in eo)) add(path + key(k), show(ao[k]), MISSING)
        else walk(ao[k], eo[k], path + key(k))
      }
      return
    }
    if (a instanceof Map && e instanceof Map) {
      for (const k of new Set([...a.keys(), ...e.keys()])) {
        const p = `${path}.get(${show(k)})`
        if (!a.has(k)) add(p, MISSING, show(e.get(k)))
        else if (!e.has(k)) add(p, show(a.get(k)), MISSING)
        else walk(a.get(k), e.get(k), p)
      }
      return
    }
    if (!isDeepStrictEqual(a, e)) {
      const note =
        typeName(a) !== typeName(e) ?
          `types differ: ${typeName(a)} and ${typeName(e)}`
        : undefined
      add(path, show(a), show(e), note)
    }
  }
  walk(actual, expected, '')
  return { diffs, more }
}
