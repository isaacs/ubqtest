// The collector for source counters, for the Bun preload and the
// Node preload. Keeps the changed source of each file in a cache in
// `.ubq/counters/`, so that most processes do not load the parser.
import { hash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addCoverage, type Collector, flatten, sourceCoverage } from './coverage.ts'
import { COLUMN, COUNTERS, mutated, originalColumn, type Region, snapshot } from './counters.ts'
import type { Coverage } from './events.ts'
import type { Instrumented } from './instrument.ts'
import { projectRoot, rel } from './project.ts'
import { builtSources, mapOf, type SourceRegions, sourceRegions } from './source-map.ts'

/** Changes when the form of the changed source or the regions changes. */
const CACHE_VERSION = 4

const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector; [key: symbol]: unknown }

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'
let instrument: typeof import('./instrument.ts').instrument | undefined

/** Loads the parser. Most processes find their files in the cache and do not need it. */
const parse = (): typeof import('./instrument.ts').instrument | undefined => {
  if (!instrument) {
    loadingParser = true
    try {
      instrument = (nodeModule.createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')).instrument
    } finally {
      loadingParser = false
    }
    // The parser ran with no counters in this process. The next
    // process finds it in the cache.
    for (const [file, root] of parserKeys.splice(0)) {
      try {
        cached(file, readFileSync(PARSER, 'utf8'), false, root)
      } catch {
        // The cache is an aid.
      }
    }
  }
  return instrument
}
/** The file of the parser. In the repository of ubq it is a project file. */
const PARSER = fileURLToPath(new URL(INSTRUMENT, import.meta.url))
/** The key and the project root of each collector that wanted counters for the parser file. */
const parserKeys: [file: string, root: string][] = []
/**
 * True while the parser loads. In the repository of ubq, the parser
 * is a file of the project, and the load hook gets it. It cannot
 * get counters from a parser that is not there yet.
 */
let loadingParser = false

export interface Counters {
  /** True for a file of the project that can have counters. */
  wants(path: string): boolean
  /**
   * The source of a project file with counters. Returns undefined
   * if the parser cannot read the source: the file then runs with no
   * counters, and coverage is not complete.
   */
  change(path: string, source: string | undefined): { source: string; js: boolean; imports: number } | undefined
  /**
   * The same for JavaScript that the runtime made from a project
   * file, with an inline source map. The regions get the places of
   * the source file. Returns undefined with no map.
   */
  compiled(path: string, made: string): string | undefined
}

/** The cache entry of a file. `root` is the project that the file belongs to. */
export const cachePath = (file: string, source: string, root = projectRoot(), map = ''): string =>
  join(root, '.ubq', 'counters', hash('sha1', `${CACHE_VERSION}\0${file}\0${source}${map && '\0' + map}`) + '.json')

/**
 * The source map of a built file of the project, if it has one. A
 * file with no `sourceMappingURL` line costs one test of its text.
 */
export const builtMap = (path: string, source: string): ReturnType<typeof mapOf> =>
  source.includes('sourceMappingURL=') ? mapOf(source, path) : undefined

/**
 * The sources of a cache entry whose files have the content that
 * the map is of. A source that changed after the build is not in
 * the list: its places are not known until the next build.
 */
export const currentSources = (result: Instrumented, root = projectRoot()): SourceRegions[] | undefined =>
  result.sources?.filter(source => {
    try {
      return hash('sha1', readFileSync(join(root, source.file))) === source.hash
    } catch {
      return false
    }
  })

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

/**
 * The changed source of a file, from the cache. Makes the entry if
 * it is absent. With `strip`, the entry of a TypeScript file also
 * gets the source with the types removed.
 */
export const cached = (
  file: string,
  source: string,
  strip = false,
  root = projectRoot(),
  /** The path of the file, if the caller is a load hook. */
  from?: string,
  /** The source map of the file, if it is a built file (`builtMap`). */
  map?: ReturnType<typeof mapOf>,
): Instrumented | undefined => {
  const path = cachePath(file, source, root, map?.text)
  let result: Instrumented | undefined
  try {
    result = JSON.parse(readFileSync(path, 'utf8')) as Instrumented
  } catch {
    // Not in the cache.
  }
  // Bun has no function that removes types and keeps each position.
  const needsJs = strip && /\.[cm]?ts$/.test(file) && !!nodeModule.stripTypeScriptTypes
  if (result && (result.js !== undefined || !needsJs)) return result
  // The parser file itself, before the parser is complete: the hook
  // or the program loads it now.
  if (!result && from === PARSER && !instrument) {
    parserKeys.push([file, root])
    return undefined
  }
  if (!result && loadingParser) return undefined
  result ??= parse()?.(source, file)
  if (result) {
    try {
      if (map) {
        const sources = builtSources(result.regions, source, map, root, (text, name) => parse()?.(text, name)?.regions)
        if (sources) result.sources = sources
      }
      if (needsJs) result.js = nodeModule.stripTypeScriptTypes(result.code)
      mkdirSync(join(root, '.ubq', 'counters'), { recursive: true })
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
  // The counters of a second collector are in the same Map: a
  // process can also count for the test that started it
  // (`child-coverage.ts`). This Map has only the files of this one.
  const all = (shared[Symbol.for(COUNTERS)] ??= new Map<string, Uint32Array>()) as Map<string, Uint32Array>
  const counters = new Map<string, Uint32Array>()
  const regions = new Map<string, Region[]>()
  /** For a built file with a source map: the source files that its counters are for. */
  const built = new Map<string, SourceRegions[]>()
  /** Files that had their first snapshot. */
  const seen = new Set<string>()
  /** Count of project files that have no counters. */
  let unread = 0
  const shifts = new Map<string, Record<number, number[]>>()
  // Stack traces have columns of the changed source.
  shared[Symbol.for(COLUMN)] = (file: string, line: number, column: number): number =>
    originalColumn(shifts.get(file)?.[line], column)

  const root = projectRoot() + sep
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
        const sources = built.get(file)
        if (sources) {
          // Coverage of the source files, not of the built file.
          addCoverage(files, sourceCoverage(sources, counts, seen))
          counts.fill(0)
          continue
        }
        const all = !seen.has(file)
        seen.add(file)
        const ranges = flatten([{ ranges: snapshot(regions.get(file)!, counts, all) }])
        if (ranges.length) addCoverage(files, [{ file, ranges }])
      }
      return files
    },
  }

  const use = (file: string, result: Instrumented): void => {
    // A second instance of a module (mockImport) counts in the same
    // array. A new array would lose the counts of the first one.
    if (counters.get(file)?.length !== result.regions.length) counters.set(file, new Uint32Array(result.regions.length))
    all.set(file, counters.get(file)!)
    regions.set(file, result.regions)
  }

  return {
    // The files of ubq are not files of the project: they are in
    // `node_modules`, or outside the root through a link. In the
    // repository of ubq they are the project.
    wants: path => path.startsWith(root) && !path.includes(modules),
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
        : changed === undefined ? cached(file, source, false, projectRoot(), path, builtMap(path, source))
        : parse()?.(changed, file)
      if (!result) {
        unread++
        return undefined
      }
      use(file, result)
      const sources = currentSources(result)
      if (sources?.length) built.set(file, sources)
      // A source changed after the build: the run has no coverage of it.
      if (sources && sources.length < result.sources!.length) unread++
      shifts.set(file, result.shifts)
      const { imports } = result
      return result.js === undefined ? { source: result.code, js: false, imports } : { source: result.js, js: true, imports }
    },
  }
}
