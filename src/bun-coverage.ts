// Coverage on Bun from the inspector, for a test file that runs as a
// plain program (`bun test/foo.ts`). Such a process has no source
// counters. The project turns it on with `bunInspectorCoverage`.
//
// Bun gives ranges as offsets in the JavaScript that it made from a
// module, and gives no map to the source. This file makes that
// JavaScript again with the transpiler of Bun, and matches its words
// with the words of the source. The match is a guess: a range can
// get a wrong place. See docs/02-decisions.md, D39.
import { readFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Collector, flatten } from './coverage.ts'
import type { Coverage } from './events.ts'
import { projectRoot, rel } from './project.ts'

declare const Bun: {
  Transpiler: new (options: { loader: string; target: string }) => { transformSync(source: string): string }
}

interface Range {
  startOffset: number
  endOffset: number
  count: number
}
interface Script {
  url: string
  functions: { ranges: Range[] }[]
}

/** A word, or one character that is not a space. */
interface Token {
  text: string
  start: number
  end: number
}

// A comment, a word, or one character. Quotes are equal: Bun writes
// `"` for `'`. The source of a string or a template that has `//`
// in it loses the words to the end of the line.
const TOKEN = /\/\/.*|\/\*[^]*?\*\/|[\w$]+|\S/g

/** The tokens of a text, with no comments and no `;`. */
export const tokens = (text: string): Token[] => {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0]
    if (t === ';' || t.startsWith('//') || t.startsWith('/*')) continue
    out.push({ text: t === "'" ? '"' : t, start: m.index, end: m.index + t.length })
  }
  return out
}

/** How far the search for the next equal tokens goes. */
const NEAR = 48

/**
 * For each token of `made`, the index of its token in `source`, or
 * -1. The tokens of `made` are mostly a part of the tokens of
 * `source`, in the same order: types and comments are gone.
 */
export const match = (source: Token[], made: Token[]): Int32Array => {
  const to = new Int32Array(made.length).fill(-1)
  const same = (i: number, j: number): boolean => source[i]?.text === made[j]?.text
  let i = 0
  let j = 0
  while (i < source.length && j < made.length) {
    if (same(i, j)) {
      to[j++] = i++
      continue
    }
    // The nearest place where three tokens are equal again.
    let skip: [number, number] | undefined
    for (let sum = 1; sum <= NEAR * 2 && !skip; sum++)
      for (let b = Math.max(0, sum - NEAR); b <= Math.min(sum, NEAR); b++) {
        const a = sum - b
        if (same(i + a, j + b) && same(i + a + 1, j + b + 1) && same(i + a + 2, j + b + 2)) {
          skip = [a, b]
          break
        }
      }
    i += skip?.[0] ?? 1
    j += skip?.[1] ?? 1
  }
  return to
}

/** Changes an offset in the JavaScript of Bun to an offset in the source. */
type ToSource = (offset: number, end: boolean) => number | undefined

/** The function that changes offsets, for a source and its JavaScript. */
export const mapper = (source: string, made: string): ToSource => {
  const from = tokens(source)
  const out = tokens(made)
  const to = match(from, out)
  return (offset, end) => {
    // The first token that starts at or after the offset. For an
    // end: the first token that ends after the offset.
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (end ? out[mid]!.end <= offset : out[mid]!.start < offset) lo = mid + 1
      else hi = mid
    }
    if (end) {
      for (let k = lo - 1; k >= 0; k--) if (to[k]! >= 0) return from[to[k]!]!.end
    } else for (let k = lo; k < out.length; k++) if (to[k]! >= 0) return from[to[k]!]!.start
    return undefined
  }
}

/**
 * The inspector collector of a Bun process that has no counters.
 * The mode is `partial`:
 *
 * - The places are a guess.
 * - Bun compiled the modules before the collector started. For such
 *   a module, Bun gives the blocks of the functions that ran, and
 *   not always the functions. A function with no branch can be
 *   absent. A function that never ran is absent. The blocks of a
 *   method of a class can have a wrong place.
 * - A `.tsx` or `.jsx` file gets only a mark that it ran: the
 *   JavaScript that Bun makes from JSX at run time is not the text
 *   of its transpiler.
 */
export const startBunInspector = (): Collector => {
  const session = new Session()
  session.connect()
  session.post('Profiler.enable')
  session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  const root = projectRoot() + sep
  const modules = `${sep}node_modules${sep}`
  /** The JavaScript and the function for its offsets. Undefined if the transpiler cannot read the file. */
  const texts = new Map<string, { made: string; toSource: ToSource } | undefined>()

  return {
    mode: 'partial',
    async take() {
      const files: Coverage['files'] = []
      const scripts = await new Promise<Script[]>(resolve =>
        session.post('Profiler.takePreciseCoverage', (error, result) =>
          resolve(error ? [] : (result.result as Script[])),
        ),
      )
      for (const script of scripts) {
        if (!script.url.startsWith('file:')) continue
        const path = fileURLToPath(script.url.replace(/\?.*$/, ''))
        if (!path.startsWith(root) || path.includes(modules)) continue
        if (!script.functions.some(f => f.ranges.some(r => r.count))) continue
        const file = rel(path)
        // With no known place, the first character stands for the
        // file: the store must know each file that a test ran.
        const unknown = { file, ranges: [0, 1, 1] }
        if (/\.[jt]sx$/.test(path)) {
          files.push(unknown)
          continue
        }
        if (!texts.has(file)) {
          try {
            const source = readFileSync(path, 'utf8')
            const made = new Bun.Transpiler({
              loader: extname(path).slice(1).replace(/^[cm]/, ''),
              target: 'bun',
            }).transformSync(source)
            texts.set(file, { made, toSource: mapper(source, made) })
          } catch {
            texts.set(file, undefined)
          }
        }
        const text = texts.get(file)
        if (!text) {
          files.push(unknown)
          continue
        }
        // A range that starts or ends in the middle of a word is
        // not a range of this text.
        const inWord = (at: number): boolean => /[\w$]{2}/.test(text.made.slice(at - 1, at + 1))
        const good = (r: Range): boolean => !inWord(r.startOffset) && !inWord(r.endOffset)
        const ran: Script['functions'] = []
        for (const f of script.functions) {
          const [outer, ...blocks] = f.ranges
          if (outer!.startOffset > 0) {
            if (outer!.count && f.ranges.every(good)) ran.push(f)
          } else if (blocks.some(r => r.count))
            // The first range is the module. The others are blocks
            // of functions that ran.
            for (const r of blocks) if (good(r)) ran.push({ ranges: [r] })
        }
        const flat = flatten(ran)
        const ranges: number[] = []
        for (let k = 0; k < flat.length; k += 3) {
          const start = text.toSource(flat[k]!, false)
          const end = text.toSource(flat[k + 1]!, true)
          const from = Math.max(start ?? 0, ranges.at(-2) ?? 0)
          if (start !== undefined && end !== undefined && end > from) ranges.push(from, end, flat[k + 2]!)
        }
        files.push(ranges.length ? { file, ranges } : unknown)
      }
      return files
    },
  }
}
