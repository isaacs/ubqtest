// The process of a test file that runs in workerd, the runtime of
// Cloudflare Workers: `node workers-host.js <test file>`. It starts
// workerd with the bindings of the wrangler config, gives it each
// module from the disk, and writes the events of the file for the
// runner, as a test process does. See docs/02-decisions.md, D48.
import { existsSync, openSync, readdirSync, readFileSync, statSync, writeSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config } from './config.ts'
import { startCounters } from './counter-collector.ts'
import { COLUMN, COUNTERS } from './counters.ts'
import type { Collector } from './coverage.ts'
import type { Coverage, UbqEvent } from './events.ts'
import { projectRoot } from './project.ts'
import { RUN } from './workerd.ts'
import type { Job, RawCoverage } from './workers-entry.ts'

// The same name as in `workers-entry.ts`. That module must not load
// in this process: it sets up the counters of workerd.
const HOST = '__UBQ_HOST'

/** The parts of the `miniflare` package that this file uses. */
interface Miniflare {
  dispatchFetch(url: string, init: { method: string; body: string }): Promise<{ text(): Promise<string> }>
  dispose(): Promise<void>
}
interface MiniflareModule {
  Miniflare: new (options: Record<string, unknown>) => Miniflare
  convertV4MiniflareOptions?: (options: Record<string, unknown>) => Record<string, unknown>
  Response: new (body: string | null, init?: { status?: number; headers?: Record<string, string> }) => unknown
}
/** The parts of the `wrangler` package that this file uses. */
interface Wrangler {
  unstable_getMiniflareWorkerOptions(config: string): {
    workerOptions: { name?: string; compatibilityFlags?: string[] } & Record<string, unknown>
    main?: string
    externalWorkers?: unknown[]
  }
  unstable_readConfig(args: { config: string }): { d1_databases?: { binding: string; migrations_dir?: string }[] }
  unstable_splitSqlQuery(sql: string): string[]
}

const EXT = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
const OWN = import.meta.dirname + sep
const root = projectRoot()
const shared = globalThis as Record<symbol, unknown>

/** An error of the setup. The runner reports its message as the reason that the file did not load. */
const stop = (message: string): never => {
  process.stderr.write(`Error: ${message}\n`)
  process.exit(1)
}

// --- Names of modules ---

// workerd names a module by its path with no first `/`. On Windows
// the path has a drive: `C:/a/b.ts`.
const toPath = (name: string): string => resolve(process.platform === 'win32' ? name.replace(/^\/+/, '') : '/' + name.replace(/^\/+/, ''))
const toName = (path: string): string => path.split(sep).join('/').replace(/^\/+/, '')

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// The names that a bundler accepts for a file: wrangler makes a
// bundle of a Worker, so its source can import `./a` or `./a.js`
// for the file `a.ts`.
const SOURCE: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] }
const ENDS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.cjs', '.json']
const findFile = (path: string): string | undefined => {
  if (isFile(path)) return path
  const ext = /\.[cm]?jsx?$/.exec(path)?.[0]
  for (const source of (ext && SOURCE[ext]) || []) {
    const found = path.slice(0, -ext!.length) + source
    if (isFile(found)) return found
  }
  for (const base of [path, join(path, 'index')])
    for (const end of ENDS) if (isFile(base + end)) return base + end
  return undefined
}

/** The value of `exports` for the conditions, or undefined. */
const pick = (target: unknown, conditions: Set<string>, star?: string): string | undefined => {
  if (typeof target === 'string') return star === undefined ? target : target.replaceAll('*', star)
  if (Array.isArray(target)) {
    for (const one of target) {
      const found = pick(one, conditions, star)
      if (found) return found
    }
    return undefined
  }
  if (target && typeof target === 'object')
    for (const [key, value] of Object.entries(target))
      if (key === 'default' || conditions.has(key)) {
        const found = pick(value, conditions, star)
        if (found) return found
      }
  return undefined
}

/** The file of a package for `import 'name/subpath'`, with the conditions that wrangler uses. */
const findPackage = (specifier: string, from: string, require: boolean): string | undefined => {
  const [, name, rest = ''] = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/.exec(specifier) ?? []
  if (!name) return undefined
  let dir: string | undefined
  for (let at = from; ; at = dirname(at)) {
    if (existsSync(join(at, 'node_modules', name, 'package.json'))) {
      dir = join(at, 'node_modules', name)
      break
    }
    if (at === dirname(at)) return undefined
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  const conditions = new Set(['workerd', 'worker', 'browser', ...(require ? ['require'] : ['import', 'module'])])
  if (pkg.exports !== undefined && pkg.exports !== null) {
    const exports = pkg.exports as Record<string, unknown>
    const map =
      typeof exports === 'string' || Array.isArray(exports) || !Object.keys(exports).some(key => key.startsWith('.')) ?
        { '.': exports }
      : exports
    const subpath = '.' + rest
    let target = subpath in map ? pick(map[subpath], conditions) : undefined
    if (!target) {
      // `./features/*` and `./features/*.js`. The longest start wins.
      let best = -1
      for (const key of Object.keys(map)) {
        const star = key.indexOf('*')
        if (star < 0 || star <= best) continue
        const [start, end] = [key.slice(0, star), key.slice(star + 1)]
        if (subpath.length < key.length - 1 || !subpath.startsWith(start) || !subpath.endsWith(end)) continue
        const found = pick(map[key], conditions, subpath.slice(start.length, subpath.length - end.length))
        if (found) {
          target = found
          best = star
        }
      }
    }
    return target && findFile(join(dir, target))
  }
  if (rest) return findFile(join(dir, rest))
  for (const field of require ? ['main'] : ['module', 'main'])
    if (typeof pkg[field] === 'string') return findFile(join(dir, pkg[field]))
  return findFile(join(dir, 'index.js'))
}

/** True for a file that is CommonJS: its name says so, or its package does. */
const commonJs = (path: string): boolean => {
  if (/\.c[jt]s$/.test(path)) return true
  if (!/\.js$/.test(path) || !path.includes(`${sep}node_modules${sep}`)) return false
  for (let at = dirname(path); at !== dirname(at); at = dirname(at)) {
    try {
      return (JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')) as { type?: string }).type !== 'module'
    } catch {
      // No package.json in this folder.
    }
  }
  return true
}

// --- The text of modules ---

// Node prints a warning the first time that a program removes types.
const strip = (source: string): string => {
  const emitWarning = process.emitWarning
  process.emitWarning = () => {}
  try {
    return nodeModule.stripTypeScriptTypes(source)
  } finally {
    process.emitWarning = emitWarning
  }
}

const counters = startCounters()!
const collector = shared[Symbol.for('ubqtest.collector')] as Collector
/** The count arrays of this process. The collector reads them. */
const counts = shared[Symbol.for(COUNTERS)] as Map<string, Uint32Array>
const fixColumn = shared[Symbol.for(COLUMN)] as (file: string, line: number, column: number) => number

/**
 * workerd does not let a module do I/O while it loads: no query,
 * no timer. A test file does such work at its top level. This puts
 * the code after line `imports` in a function, which the entry
 * module calls in its request. No line gets a different number.
 */
const inFunction = (code: string, imports: number): string => {
  let at = 0
  for (let i = 0; i < imports; i++) {
    at = code.indexOf('\n', at) + 1
    if (!at) return code
  }
  at = Math.max(0, at - 1)
  return `${code.slice(0, at)}${at ? ';' : ''}export const ${RUN} = async () => {${code.slice(at)}\n}\n`
}

/** The answer for workerd: the module at `path`. */
const moduleOf = (path: string): Record<string, unknown> => {
  const name = toName(path)
  const source = readFileSync(path, 'utf8')
  if (/\.json$/.test(path)) return { name, json: source }
  if (/\.(txt|html|sql)$/.test(path)) return { name, text: source }
  if (/\.[jt]sx$/.test(path))
    return { name, esModule: `throw new Error(${JSON.stringify(`ubq cannot run a JSX file in the Workers runtime: ${path}`)})` }
  const ts = /\.[cm]?ts$/.test(path)
  let code = source
  if (path.startsWith(OWN)) {
    // A module that workerd gets this way has no `import.meta.url`.
    code = (ts ? strip(source) : source)
      .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href))
      .replaceAll('import.meta.dirname', JSON.stringify(dirname(path)))
  } else if (counters.wants(path)) {
    const changed = counters.change(path, source)
    code = changed?.source ?? source
    if (ts && !changed?.js) code = strip(code)
    if (path === file && changed && changed.imports >= 0) code = inFunction(code, changed.imports)
  } else if (ts) code = strip(source)
  return commonJs(path) ? { name, commonJsModule: code } : { name, esModule: code }
}

// --- workerd ---

const configPath = process.env.UBQ_WORKERS_CONFIG!
const file = process.argv[2]!
const projectRequire = nodeModule.createRequire(join(root, 'package.json'))
let wrangler!: Wrangler
let miniflare!: MiniflareModule
try {
  const main = projectRequire.resolve('wrangler')
  wrangler = (await import(pathToFileURL(main).href)) as Wrangler
  miniflare = nodeModule.createRequire(main)('miniflare') as MiniflareModule
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
  stop('this test file runs in the Workers runtime, and the project does not have wrangler. Run: npm install --save-dev wrangler')
}

const { workerOptions, main, externalWorkers = [] } = wrangler.unstable_getMiniflareWorkerOptions(configPath)
const flags = new Set(workerOptions.compatibilityFlags)
// The test API uses modules of Node.
if (!flags.has('nodejs_compat_v2')) flags.add('nodejs_compat')

const ENTRY = join(OWN, `workers-entry${EXT}`)
const migrations: Job['migrations'] = {}
for (const db of wrangler.unstable_readConfig({ config: configPath }).d1_databases ?? []) {
  const dir = resolve(dirname(configPath), db.migrations_dir ?? 'migrations')
  migrations[db.binding] =
    !existsSync(dir) ? []
    : readdirSync(dir)
        .filter(name => name.endsWith('.sql'))
        .sort()
        .map(name => ({ name, queries: wrangler.unstable_splitSqlQuery(readFileSync(join(dir, name), 'utf8')) }))
}

// The options have the form of miniflare 4, which wrangler gives.
// miniflare 5 has a function that changes them to its form.
const options = {
  unsafeModuleFallbackService(request: { url: string; headers: { get(name: string): string | null } }) {
    const url = new URL(request.url)
    const raw = url.searchParams.get('rawSpecifier') ?? ''
    const path = toPath(url.searchParams.get('specifier') ?? '')
    const require = request.headers.get('X-Resolve-Method') === 'require'
    let found: string | undefined
    try {
      if (raw === 'ubqtest') found = join(OWN, `index${EXT}`)
      else if (raw === 'ubqtest/workers') found = join(OWN, `workers${EXT}`)
      else if (/^(\.|\/|[A-Za-z]:[\\/])/.test(raw)) found = findFile(path)
      else if (!/^[a-z-]+:/.test(raw)) found = findPackage(raw, dirname(toPath(url.searchParams.get('referrer') ?? '')), require)
      if (!found) return new miniflare.Response(null, { status: 404 })
      if (found !== path) return new miniflare.Response(null, { status: 301, headers: { Location: '/' + toName(found) } })
      return new miniflare.Response(JSON.stringify(moduleOf(found)), { headers: { 'Content-Type': 'application/json' } })
    } catch (error) {
      process.stderr.write(`${(error as Error).stack}\n`)
      return new miniflare.Response(null, { status: 404 })
    }
  },
  workers: [
    {
      ...workerOptions,
      name: workerOptions.name ?? 'ubq',
      compatibilityFlags: [...flags],
      modulesRoot: '/',
      modules: [
        {
          type: 'ESModule',
          path: '/ubq-main.mjs',
          // The classes that the config names (Durable Objects,
          // Workflows) are exports of the main module of the Worker.
          contents:
            `import entry from ${JSON.stringify('/' + toName(ENTRY))}\n` +
            (main ? `export * from ${JSON.stringify('/' + toName(resolve(dirname(configPath), main)))}\n` : '') +
            'export default entry\n',
        },
      ],
      unsafeUseModuleFallbackService: true,
      serviceBindings: {
        ...(workerOptions.serviceBindings as object),
        // workerd sends the events of the file here.
        async [HOST](request: { text(): Promise<string> }) {
          for (const line of (await request.text()).split('\n')) await handle(JSON.parse(line) as UbqEvent)
          return new miniflare.Response('ok')
        },
      },
    },
    ...externalWorkers,
  ],
}
const mf = new miniflare.Miniflare(miniflare.convertV4MiniflareOptions?.(options) ?? options)

// --- Events ---

const fd = process.env.UBQ_EVENTS ? openSync(process.env.UBQ_EVENTS, 'a') : 3
const write = (event: UbqEvent): void => {
  try {
    writeSync(fd, JSON.stringify(event) + '\n')
  } catch {
    // The runner went away.
  }
}

/** Changes each place in an event from the column of the changed source to the column of the source. */
const fixPlaces = (value: unknown): void => {
  if (!value || typeof value !== 'object') return
  const place = value as { file?: unknown; line?: unknown; column?: unknown }
  if (typeof place.file === 'string' && typeof place.line === 'number' && typeof place.column === 'number')
    place.column = fixColumn(place.file, place.line, place.column)
  else for (const inner of Object.values(value)) fixPlaces(inner)
}

let code = 0
const handle = async (event: UbqEvent | { type: 'load-error'; text: string }): Promise<void> => {
  if (event.type === 'load-error') {
    // A path in the text has the form of a module name of workerd.
    process.stderr.write(event.text.replaceAll(toName(root) + '/', '') + '\n')
    code = 1
    return
  }
  if (event.type === 'file-start') {
    event.pid = process.pid
    event.coverage = collector.mode
  } else if (event.type === 'coverage') {
    // The counts of workerd go into the arrays of this process,
    // which has the regions of each file.
    for (const { file, counts: from } of event.files as unknown as RawCoverage[]) counts.get(file)?.set(from)
    event.files = (await collector.take()) as Coverage['files']
    if (!event.files.length) return
  } else fixPlaces(event)
  write(event)
}

const job: Job = {
  path: '/' + toName(file),
  root,
  config: config(),
  env: Object.fromEntries(
    ['UBQ_CHILD', 'UBQ_FILE', 'UBQ_LINES', 'UBQ_IDS', 'UBQ_LIMIT'].flatMap(name =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  ),
  migrations,
}
try {
  await (await mf.dispatchFetch('http://ubq/', { method: 'POST', body: JSON.stringify(job) })).text()
} catch (error) {
  // An error of the main module of the Worker stops workerd when it
  // starts. miniflare has the text of workerd in its message.
  const text = String((error as Error).stack)
  const [, message, at] = /Uncaught ([^\n\\"]+)(?:\\n\s+at ([^\s\\"]+))?/.exec(text) ?? []
  process.stderr.write(
    message ? `${/Error\b/.test(message) ? message : `Error: ${message}`}\n${at ? `    at ${at.replace(toName(root) + '/', '')}\n` : ''}` : `${text}\n`,
  )
  code = 1
}
try {
  await mf.dispose()
} catch {
  // workerd did not start.
}
process.exit(code)
