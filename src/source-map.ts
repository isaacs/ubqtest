// Regions of JavaScript that a runtime made from a source file, as
// regions of the source file. Deno compiles a `.tsx` or `.jsx` file
// before a load hook sees it, and gives the JavaScript with an
// inline source map. The counters go into that JavaScript.
import { hash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import type { Region } from './counters.ts'

const INLINE = /\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The offset of the start of each line. */
const lineStarts = (text: string): number[] => {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

/**
 * The points of the map: an offset in the JavaScript, and the offset
 * in the source of the same token. In the order of the JavaScript.
 */
const points = (mappings: string, made: string, source: string): [made: number, source: number][] => {
  const sourceLines = lineStarts(source)
  return allPoints(mappings, made, () => sourceLines).map(([at, , to]) => [at, to])
}

/**
 * The points of a map with more than one source: an offset in the
 * JavaScript, the index of the source, and the offset in that
 * source. `linesOf` gives the line starts of a source, or undefined
 * for a source that is not wanted.
 */
const allPoints = (
  mappings: string,
  made: string,
  linesOf: (index: number) => number[] | undefined,
): [made: number, index: number, source: number][] => {
  const madeLines = lineStarts(made)
  const out: [number, number, number][] = []
  let line = 0
  let column = 0
  let index = 0
  let sourceLine = 0
  let sourceColumn = 0
  let fields: number[] = []
  let value = 0
  let shift = 0
  const segment = (): void => {
    if (fields.length >= 4) {
      column += fields[0]!
      index += fields[1]!
      sourceLine += fields[2]!
      sourceColumn += fields[3]!
      const start = linesOf(index)?.[sourceLine]
      if (start !== undefined) out.push([madeLines[line]! + column, index, start + sourceColumn])
    } else if (fields.length) column += fields[0]!
    fields = []
  }
  for (const char of mappings) {
    if (char === ',' || char === ';') {
      segment()
      if (char === ';') {
        line++
        column = 0
      }
      continue
    }
    const digit = BASE64.indexOf(char)
    value += (digit & 31) << shift
    if (digit & 32) shift += 5
    else {
      fields.push(value & 1 ? -(value >> 1) : value >> 1)
      value = shift = 0
    }
  }
  segment()
  return out
}

/** The source map at the end of `made`, or undefined if it has none. */
export const inlineMap = (made: string): { mappings: string; sources?: string[] } | undefined => {
  const inline = INLINE.exec(made)
  if (!inline) return undefined
  try {
    return JSON.parse(Buffer.from(inline[1]!, 'base64').toString())
  } catch {
    return undefined
  }
}

// A word, a string, or one character.
const TOKEN = /[\w$]+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^]/y

/**
 * The regions of `made` as regions of `source`. `made` must end with
 * an inline source map. Returns undefined if it has none.
 *
 * A map has a point for the start of each token. So a region starts
 * at its first token, and ends at the end of its last token.
 */
export const sourceRegions = (regions: Region[], made: string, source: string): Region[] | undefined => {
  const map = inlineMap(made)
  if (!map) return undefined
  let all: [number, number][]
  try {
    all = points(map.mappings, made, source)
  } catch {
    return undefined
  }
  /** The index of the first point at or after an offset in `made`. */
  const first = (offset: number): number => {
    let lo = 0
    let hi = all.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (all[mid]![0] < offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return regions.map((region, i) => {
    if (i === 0) return { ...region, start: 0, end: source.length }
    const from = first(region.start)
    const to = first(region.end) - 1
    // No token of the region is in the map.
    if (from > to) return { ...region, start: 0, end: 0 }
    let start = Infinity
    let end = 0
    for (let k = from; k <= to; k++) {
      const at = all[k]![1]
      start = Math.min(start, at)
      TOKEN.lastIndex = at
      end = Math.max(end, at + (TOKEN.exec(source)?.[0].length ?? 0))
    }
    return { ...region, start, end }
  })
}

/** The regions of one source file of a built file, and the counters of each region. */
export interface SourceRegions {
  /** Path from the project root. */
  file: string
  /** The hash of the source text that the map is of. */
  hash: string
  /** The regions of the source file itself, as for a file that a test loads. */
  regions: Region[]
  /**
   * `counters[i]` has the indexes, in the built file, of the counters
   * of `regions[i]`. An empty list: the code of the region is not in
   * the built file, or no counter is at its place.
   */
  counters: number[][]
}

interface SourceMap {
  mappings?: string
  sources?: string[]
  sourceRoot?: string
  sourcesContent?: (string | null)[]
}

const LINKED = /\/\/# sourceMappingURL=([^\s'"]+)\s*$/

/**
 * The source map of a built file: at its end, or in the file that
 * its last line names. Gives the map, its text (the built file can
 * stay the same when the map changes), and the folder that the
 * paths of the sources start from.
 */
export const mapOf = (made: string, path: string): { map: SourceMap; text: string; base: string } | undefined => {
  const linked = LINKED.exec(made.slice(-100_000))
  if (!linked) return undefined
  try {
    if (linked[1]!.startsWith('data:')) {
      const text = Buffer.from(linked[1]!.slice(linked[1]!.indexOf(',') + 1), 'base64').toString()
      return { map: JSON.parse(text) as SourceMap, text, base: dirname(path) }
    }
    const file = resolve(dirname(path), decodeURIComponent(linked[1]!))
    const text = readFileSync(file, 'utf8')
    return { map: JSON.parse(text) as SourceMap, text, base: dirname(file) }
  } catch {
    // No map file, or text that is not a map.
    return undefined
  }
}

/**
 * The source files of the project that the map of a built file
 * names (D55), each with its own regions and the counters of the
 * built file that count for each region. A built file is a bundle,
 * or a file that a compiler made. A source outside `root`, or in
 * `node_modules`, is not wanted. Returns undefined if the map names
 * no source of the project.
 *
 * `regionsOf` gives the regions of a source text. The regions are
 * those of the source, and not those of the built file: a bundler
 * removes code that nothing uses, and such code is code that no
 * test ran.
 *
 * A counter of the built file counts for the smallest region of
 * the source that has the place of its first token. The module of
 * a source ran if the built file has code of that source.
 */
export const builtSources = (
  regions: Region[],
  made: string,
  { map, base }: { map: SourceMap; base: string },
  root: string,
  regionsOf: (text: string, file: string) => Region[] | undefined,
): SourceRegions[] | undefined => {
  if (!map.mappings || !map.sources) return undefined
  const sources = map.sources.map((name, i) => {
    const path = resolve(base, map.sourceRoot ?? '', name)
    if (!path.startsWith(root + sep) || path.includes(`${sep}node_modules${sep}`)) return undefined
    let text = map.sourcesContent?.[i]
    try {
      text ??= readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
    const file = relative(root, path).split(sep).join('/')
    const own = regionsOf(text, file)
    if (!own) return undefined
    return { file, hash: hash('sha1', text), regions: own, counters: own.map((): number[] => []), lines: lineStarts(text) }
  })
  if (!sources.some(Boolean)) return undefined
  let all: [number, number, number][]
  try {
    all = allPoints(map.mappings, made, index => sources[index]?.lines)
  } catch {
    return undefined
  }
  /** The index of the first point at or after an offset in `made`. */
  const first = (offset: number): number => {
    let lo = 0
    let hi = all.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (all[mid]![0] < offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  // The module of the built file ran. So did the module of each
  // source that has code in it.
  for (const [, index] of all) {
    const source = sources[index]!
    if (!source.counters[0]!.length) source.counters[0]!.push(0)
  }
  regions.forEach((region, i) => {
    if (i === 0) return
    const from = first(region.start)
    if (from >= all.length || all[from]![0] >= region.end) return
    const [, index, at] = all[from]!
    const source = sources[index]!
    // The smallest region of the source that has the place.
    let best = 0
    source.regions.forEach((own, k) => {
      const size = own.end - own.start
      if (own.start <= at && at < own.end && size < source.regions[best]!.end - source.regions[best]!.start) best = k
    })
    source.counters[best]!.push(i)
  })
  return sources
    .filter(source => !!source && source.counters[0]!.length > 0)
    .map(source => ({ file: source!.file, hash: source!.hash, regions: source!.regions, counters: source!.counters }))
}
