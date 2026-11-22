// The collector for source counters, for the Bun preload and the
// Node preload. Keeps the changed source of each file in a cache in
// `.ubq/counters/`, so that most processes do not load the parser.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addCoverage, type Collector, flatten, sourceCoverage } from './coverage.ts'
import { COLUMN, COUNTERS, hideCounters, mutated, originalColumn, type Region, snapshot } from './counters.ts'
import type { Coverage } from './events.ts'
import { config } from './config.ts'
import type { Instrumented } from './instrument.ts'
import { projectRoot, rel } from './project.ts'
import { builtSources, mapOf, type SourceRegions, sourcePlace, sourceRegions } from './source-map.ts'
import type { Transformer } from './transform.ts'

// `node:crypto` loads at the first hash: each test process loads this
// file, and the load of the module takes time.
const hash = (algorithm: 'sha1', data: string | Buffer): string =>
  process.getBuiltinModule('node:crypto').hash(algorithm, data)

/** Changes when the form of the changed source or the regions changes. */
const CACHE_VERSION = 7

const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector; [key: symbol]: unknown }

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'
let instrument: typeof import('./instrument.ts').instrument | undefined

/** Loads the parser. Most processes find their files in the cache and do not need it. */
const parse = (): typeof import('./instrument.ts').instrument | undefined => {
  if (!instrument && !noParser) {
    loadingParser = true
    try {
      instrument = (nodeModule.createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts'))
        .instrument
      // ubq: not measured: this module loads before the counters start
    } catch {
      // From the source of ubq, Deno 2.9 cannot load the parser in
      // a load hook. A file with no cache entry then runs with no
      // counters. The program must run in each case.
      noParser = true
    } finally {
      loadingParser = false
    }
    // The parser ran with no counters in this process. The next
    // process finds it in the cache.
    // ubq: not measured: this module loads before the counters start
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
const TRANSFORM = import.meta.url.endsWith('.ts') ? './transform.ts' : './transform.js'
let transform: Transformer | undefined | null = null
/**
 * The transformer of the project, if its configuration has the
 * `transform` key. Bun and Deno compile TypeScript themselves, so
 * they have none.
 */
export const transformer = (): Transformer | undefined => {
  if (transform === null) {
    const compiler = process.versions.bun || process.versions.deno ? undefined : config().transform
    transform = compiler
      ? (nodeModule.createRequire(import.meta.url)(TRANSFORM) as typeof import('./transform.ts')).transformer(
          projectRoot(),
          compiler,
        )
      : undefined
  }
  return transform
}

/** A TypeScript file that Node can run with its types removed. Not `.tsx`. */
const TS = /\.[cm]?ts$/
/** True if the runtime cannot load the parser. */
let noParser = false
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
  change(
    path: string,
    source: string | undefined,
  ): { source: string; js: boolean; imports: number; format?: 'commonjs' | 'module' } | undefined
  /**
   * The result of a load hook for a TypeScript file of a project
   * with the `transform` key, and undefined for each other file.
   * Node does not read such a file itself: it stops at syntax that
   * it cannot remove. Absent in a project with no such key.
   */
  transformed?(path: string): { source: string; format: 'commonjs' | 'module'; shortCircuit: true } | undefined
  /**
   * The same for JavaScript that the runtime made from a project
   * file, with an inline source map. The regions get the places of
   * the source file. Returns undefined with no map.
   */
  compiled(path: string, made: string): string | undefined
}

/**
 * A hash of 64 bits, as 16 hex digits. It needs no module, and the
 * name of a cache entry needs no hash that is safe from an attacker.
 */
const hash64 = (text: string): string => {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  // Each half gets bits of the other.
  const x = Math.imul(a ^ (a >>> 16), 0x85ebca6b) ^ Math.imul(b ^ (b >>> 13), 0xc2b2ae35)
  const y = Math.imul(b ^ (b >>> 16), 0x85ebca6b) ^ Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x >>> 0).toString(16).padStart(8, '0') + (y >>> 0).toString(16).padStart(8, '0')
}

/** The cache entry of a file. `root` is the project that the file belongs to. */
export const cachePath = (file: string, source: string, root = projectRoot(), map = '', stamp = ''): string =>
  join(
    root,
    '.ubq',
    'counters',
    hash64(`${CACHE_VERSION}\0${file}\0${source}${map && '\0' + map}${stamp && '\0\0' + stamp}`) + '.json',
  )

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
      // ubq: not measured: this module loads before the counters start
    } catch {
      return false
    }
  })

/**
 * The place in the source of a place in the code of a project file
 * that ran, for a process that did not load the file: the runner
 * reads the stack of a stuck test process. Reads the cache. The
 * code that ran has counters, and with the `transform` key it is
 * the JavaScript of a compiler.
 */
export const placeFromCache = <T extends { file: string; line: number; column: number }>(frame: T): T => {
  try {
    const source = readFileSync(join(projectRoot(), frame.file), 'utf8')
    const stamp = transformer()?.stamp(join(projectRoot(), frame.file))
    const entry = JSON.parse(readFileSync(cachePath(frame.file, source, undefined, '', stamp), 'utf8')) as Instrumented
    const { line, column } = (entry.format && sourcePlace(entry.js!, frame.line, frame.column)) || frame
    return { ...frame, line, column: originalColumn(entry.shifts[line], column) }
    // ubq: not measured: this module loads before the counters start
  } catch {
    return frame
  }
}

/**
 * TypeScript source with its types removed, and each position as
 * it was. Undefined for source that Node cannot change, such as an
 * `enum`: Node then reports that when it loads the file.
 */
const withoutTypes = (code: string): string | undefined => {
  // Node prints a warning the first time that a program removes types.
  const emitWarning = process.emitWarning
  process.emitWarning = () => {}
  try {
    return nodeModule.stripTypeScriptTypes(code)
  } catch {
    return undefined
  } finally {
    process.emitWarning = emitWarning
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
  /** The compiler of the project makes the source with no types. `from` is then present. */
  compiler?: Transformer,
): Instrumented | undefined => {
  const path = cachePath(file, source, root, map?.text, compiler?.stamp(from!))
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
  // ubq: not measured: this module loads before the counters start
  if (!result && from === PARSER && !instrument) {
    parserKeys.push([file, root])
    return undefined
  }
  // ubq: not measured: this module loads before the counters start
  if (!result && loadingParser) return undefined
  result ??= parse()?.(source, file)
  if (result) {
    try {
      if (map) {
        const sources = builtSources(result.regions, source, map, root, (text, name) => parse()?.(text, name)?.regions)
        if (sources) result.sources = sources
      }
      // ubq: not measured: this module loads before the counters start
      if (needsJs && compiler) Object.assign(result, compiler.compile(result.code, from!))
      else if (needsJs) result.js = withoutTypes(result.code)
      mkdirSync(join(root, '.ubq', 'counters'), { recursive: true })
      // Other processes read the cache at the same time, so the
      // file must be complete when it gets its name.
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(result))
      renameSync(tmp, path)
      // ubq: not measured: this module loads before the counters start
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
 * this call made the entry. The watcher can give more than one event
 * for one change, and a file can change back to an earlier content.
 */
export const prepareCounters = (path: string): boolean => {
  try {
    const file = rel(path)
    const source = readFileSync(path, 'utf8')
    const compiler = transformer()
    const had = existsSync(cachePath(file, source, undefined, '', compiler?.stamp(path)))
    return !!cached(file, source, true, undefined, path, undefined, compiler) && !had
    // ubq: not measured: this module loads before the counters start
  } catch {
    // The file went away.
    return false
  }
}

// `import x from './a.ts'`, `import('./a.ts')`, `require('./a.js')`
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\1/g
/** The ends of the file that an import with no file names, as the load hook finds it. */
const ENDS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js']

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    // No such file, or a name that the system does not permit.
    return false
  }
}

/**
 * Makes the cache entries of the test files at `paths`, and of the
 * project files that they import, in this process. The runner calls
 * this for a project with no cache, such as a job in CI: if not,
 * each test process loads the parser, and makes the entries of the
 * same files.
 */
export const prepareAll = (paths: string[]): void => {
  const root = projectRoot()
  const compiler = transformer()
  const seen = new Set<string>()
  const queue = [...paths]
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue
    seen.add(path)
    let source: string
    try {
      source = readFileSync(path, 'utf8')
      // The key and the arguments of the load hook of a test process.
      cached(rel(path), source, true, root, path, builtMap(path, source), compiler)
      // ubq: not measured: each path is a file that exists
    } catch {
      // The test process reports a file that it cannot load.
      continue
    }
    for (const [, , name] of source.matchAll(IMPORT)) {
      // An import can have a query: './a.ts?copy'.
      const base = resolve(dirname(path), name!.replace(/[?#].*$/, ''))
      const found = [base, base.replace(/\.[cm]?js$/, '')].flatMap(start => ENDS.map(end => start + end)).find(isFile)
      if (found?.startsWith(root + sep) && !found.includes(`${sep}node_modules${sep}`)) queue.push(found)
    }
  }
}

/**
 * Makes the collector for source counters. Returns undefined if the
 * process has a collector.
 */
export const startCounters = (): Counters | undefined => {
  // ubq: not measured: this module loads before the counters start
  if (shared[KEY]) return undefined
  // The counters of a second collector are in the same Map: a
  // process can also count for the test that started it
  // (`child-coverage.ts`). This Map has only the files of this one.
  const all = (shared[Symbol.for(COUNTERS)] ??= new Map<string, Uint32Array>()) as Map<string, Uint32Array>
  hideCounters()
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
  const compiler = transformer()

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
    // ubq: not measured: this module loads before the counters start
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
      // ubq: not measured: this module loads before the counters start
      const changed = source === undefined ? undefined : mutated(path, source)
      const result =
        source === undefined
          ? undefined // ubq: not measured: this module loads before the counters start
          : changed === undefined
            ? cached(file, source, true, projectRoot(), path, builtMap(path, source), compiler)
            : parse()?.(changed, file)
      if (!result) {
        unread++
        return undefined
      }
      // The source of a mutation check is not in the cache.
      // ubq: not measured: this module loads before the counters start
      if (compiler && result.js === undefined && TS.test(path))
        // ubq: not measured: this module loads before the counters start
        Object.assign(result, compiler.compile(result.code, path))
      use(file, result)
      const sources = currentSources(result)
      if (sources?.length) built.set(file, sources)
      // A source changed after the build: the run has no coverage of it.
      if (sources && sources.length < result.sources!.length) unread++
      shifts.set(file, result.shifts)
      const { imports, format } = result
      return result.js === undefined
        ? { source: result.code, js: false, imports }
        : { source: result.js, js: true, imports, format }
    },
    transformed:
      // ubq: not measured: this module loads before the counters start
      compiler &&
      function (this: Counters, path) {
        // ubq: not measured: this module loads before the counters start
        if (!TS.test(path) || !this.wants(path)) return undefined
        // ubq: not measured: this module loads before the counters start
        const source = readFileSync(path, 'utf8')
        const changed = this.change(path, source)
        if (changed?.format) return { source: changed.source, format: changed.format, shortCircuit: true }
        // With no counters, the file still needs its JavaScript.
        // ubq: not measured: this module loads before the counters start
        const made = compiler.compile(source, path)
        return { source: made.js, format: made.format, shortCircuit: true }
      },
  }
}
