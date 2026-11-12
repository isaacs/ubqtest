// The collector for source counters, for the Bun preload and the
// Node preload. Keeps the changed source of each file in a cache in
// `.ubq/counters/`, so that most processes do not load the parser.
import { hash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { join, sep } from 'node:path'
import { type Collector, flatten } from './coverage.ts'
import { COLUMN, COUNTERS, mutated, originalColumn, type Region, snapshot } from './counters.ts'
import type { Coverage } from './events.ts'
import type { Instrumented } from './instrument.ts'
import { projectRoot, rel } from './project.ts'
import { sourceRegions } from './source-map.ts'

/** Changes when the form of the changed source or the regions changes. */
const CACHE_VERSION = 2

const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector; [key: symbol]: unknown }

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'
let instrument: typeof import('./instrument.ts').instrument | undefined

/** Loads the parser. Most processes find their files in the cache and do not need it. */
const parse = (): typeof import('./instrument.ts').instrument =>
  (instrument ??= (nodeModule.createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts'))
    .instrument)

export interface Counters {
  /** True for a file of the project that can have counters. */
  wants(path: string): boolean
  /**
   * The source of a project file with counters. Returns undefined
   * if the parser cannot read the source: the file then runs with no
   * counters, and coverage is not complete.
   */
  change(path: string, source: string | undefined): { source: string; js: boolean } | undefined
  /**
   * The same for JavaScript that the runtime made from a project
   * file, with an inline source map. The regions get the places of
   * the source file. Returns undefined with no map.
   */
  compiled(path: string, made: string): string | undefined
}

const cachePath = (file: string, source: string): string =>
  join(projectRoot(), '.ubq', 'counters', hash('sha1', `${CACHE_VERSION}\0${file}\0${source}`) + '.json')

/**
 * The column in the source of a column in the changed source of a
 * project file, for a process that did not load the file: the
 * runner reads the stack of a stuck test process. Reads the cache.
 */
export const columnFromCache = (file: string, line: number, column: number): number => {
  try {
    const source = readFileSync(join(projectRoot(), file), 'utf8')
    const { shifts } = JSON.parse(readFileSync(cachePath(file, source), 'utf8')) as Instrumented
    return originalColumn(shifts[line], column)
  } catch {
    return column
  }
}

let madeDir = false

/**
 * The changed source of a file, from the cache. Makes the entry if
 * it is absent. With `strip`, the entry of a TypeScript file also
 * gets the source with the types removed.
 */
const cached = (file: string, source: string, strip = false): Instrumented | undefined => {
  const path = cachePath(file, source)
  let result: Instrumented | undefined
  try {
    result = JSON.parse(readFileSync(path, 'utf8')) as Instrumented
  } catch {
    // Not in the cache.
  }
  // Bun has no function that removes types and keeps each position.
  const needsJs = strip && /\.[cm]?ts$/.test(file) && !!nodeModule.stripTypeScriptTypes
  if (result && (result.js !== undefined || !needsJs)) return result
  result ??= parse()(source, file)
  if (result) {
    try {
      if (needsJs) result.js = nodeModule.stripTypeScriptTypes(result.code)
      if (!madeDir) mkdirSync(join(projectRoot(), '.ubq', 'counters'), { recursive: true })
      madeDir = true
      // Other processes read the cache at the same time, so the
      // file must be complete when it gets its name.
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(result))
      renameSync(tmp, path)
    } catch {
      // The cache is an aid. The run does not need it.
    }
  }
  return result
}

/**
 * Makes the cache entry of a project file, so that the next test
 * process that loads the file does not need the parser. The
 * background server calls this when a file changes. Returns true if
 * the entry exists after the call.
 */
export const prepareCounters = (path: string): boolean => {
  try {
    return !!cached(rel(path), readFileSync(path, 'utf8'), true)
  } catch {
    // The file went away.
    return false
  }
}

/**
 * Makes the collector for source counters. Returns undefined if the
 * process has a collector.
 */
export const startCounters = (): Counters | undefined => {
  if (shared[KEY]) return undefined
  const counters = new Map<string, Uint32Array>()
  const regions = new Map<string, Region[]>()
  /** Files that had their first snapshot. */
  const seen = new Set<string>()
  /** Count of project files that have no counters. */
  let unread = 0
  shared[Symbol.for(COUNTERS)] = counters
  const shifts = new Map<string, Record<number, number[]>>()
  // Stack traces have columns of the changed source.
  shared[Symbol.for(COLUMN)] = (file: string, line: number, column: number): number =>
    originalColumn(shifts.get(file)?.[line], column)

  const root = projectRoot() + sep
  const own = import.meta.dirname + sep
  const modules = `${sep}node_modules${sep}`

  shared[KEY] = {
    // Coverage is not complete if a project file has no counters.
    get mode() {
      return unread ? ('partial' as const) : ('full' as const)
    },
    async take() {
      const files: Coverage['files'] = []
      for (const [file, counts] of counters) {
        if (!counts.some(Boolean)) continue
        const all = !seen.has(file)
        seen.add(file)
        const ranges = flatten([{ ranges: snapshot(regions.get(file)!, counts, all) }])
        if (ranges.length) files.push({ file, ranges })
      }
      return files
    },
  }

  const use = (file: string, result: Instrumented): void => {
    // A second instance of a module (mockImport) counts in the same
    // array. A new array would lose the counts of the first one.
    if (counters.get(file)?.length !== result.regions.length)
      counters.set(file, new Uint32Array(result.regions.length))
    regions.set(file, result.regions)
  }

  return {
    wants: path => path.startsWith(root) && !path.startsWith(own) && !path.includes(modules),
    compiled(path, made) {
      const file = rel(path)
      const result = cached(file, made)
      let mapped: Region[] | undefined
      try {
        mapped = result && sourceRegions(result.regions, made, readFileSync(path, 'utf8'))
      } catch {
        // The file went away.
      }
      if (!result || !mapped) {
        unread++
        return undefined
      }
      use(file, { ...result, regions: mapped })
      return result.code
    },
    change(path, source) {
      const file = rel(path)
      // The source of a mutation check is not for the cache.
      const changed = source === undefined ? undefined : mutated(path, source)
      const result =
        source === undefined ? undefined
        : changed === undefined ? cached(file, source)
        : parse()(changed, file)
      if (!result) {
        unread++
        return undefined
      }
      use(file, result)
      shifts.set(file, result.shifts)
      return result.js === undefined ? { source: result.code, js: false } : { source: result.js, js: true }
    },
  }
}
