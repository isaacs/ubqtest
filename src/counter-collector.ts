// The collector for source counters, for the Bun preload and the
// Node preload. Keeps the changed source of each file in a cache in
// `.ubq/counters/`, so that most processes do not load the parser.
import { hash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { type Collector, flatten } from './coverage.ts'
import { COUNTERS, type Region, snapshot } from './counters.ts'
import type { Coverage } from './events.ts'
import type { Instrumented } from './instrument.ts'
import { projectRoot, rel } from './project.ts'

/** Changes when the form of the changed source or the regions changes. */
const CACHE_VERSION = 1

const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector; [key: symbol]: unknown }

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'
let instrument: typeof import('./instrument.ts').instrument | undefined

export interface Counters {
  /** True for a file of the project that can have counters. */
  wants(path: string): boolean
  /**
   * The source of a project file with counters. Returns undefined
   * if the parser cannot read the source: the file then runs with no
   * counters, and coverage is not complete.
   */
  change(path: string, source: string | undefined): string | undefined
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

  const root = projectRoot() + sep
  const own = import.meta.dirname + sep
  const modules = `${sep}node_modules${sep}`
  const cacheDir = join(root, '.ubq', 'counters')
  let madeDir = false

  const cached = (file: string, source: string): Instrumented | undefined => {
    const path = join(cacheDir, hash('sha1', `${CACHE_VERSION}\0${file}\0${source}`) + '.json')
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Instrumented
    } catch {
      // Not in the cache.
    }
    instrument ??= (
      createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
    ).instrument
    const result = instrument(source, file)
    if (result) {
      try {
        if (!madeDir) mkdirSync(cacheDir, { recursive: true })
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

  return {
    wants: path => path.startsWith(root) && !path.startsWith(own) && !path.includes(modules),
    change(path, source) {
      const file = rel(path)
      const result = source === undefined ? undefined : cached(file, source)
      if (!result) {
        unread++
        return undefined
      }
      counters.set(file, new Uint32Array(result.regions.length))
      regions.set(file, result.regions)
      return result.code
    },
  }
}
