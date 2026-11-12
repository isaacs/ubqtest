// Regions of JavaScript that a runtime made from a source file, as
// regions of the source file. Deno compiles a `.tsx` or `.jsx` file
// before a load hook sees it, and gives the JavaScript with an
// inline source map. The counters go into that JavaScript.
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
  const madeLines = lineStarts(made)
  const sourceLines = lineStarts(source)
  const out: [number, number][] = []
  let line = 0
  let column = 0
  let sourceLine = 0
  let sourceColumn = 0
  let fields: number[] = []
  let value = 0
  let shift = 0
  const segment = (): void => {
    if (fields.length >= 4) {
      column += fields[0]!
      sourceLine += fields[2]!
      sourceColumn += fields[3]!
      out.push([madeLines[line]! + column, (sourceLines[sourceLine] ?? source.length) + sourceColumn])
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
