// Coverage of the processes that a test starts (D53). The test
// process puts a preload module (`child-preload.ts`) and a list of
// projects in the environment. Each process below it that is Node
// or Bun loads the module, adds source counters to the files of
// those projects, and writes its counts to a folder that the test
// process reads (`child-read.ts`).
import childProcess, { ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread, threadId } from 'node:worker_threads'
import { type ChildCounts, type Children, CHILDREN } from './child-read.ts'
import { builtMap, cached, cachePath } from './counter-collector.ts'
import { COUNTERS, SOURCE } from './counters.ts'
import { type Counting, withCounters } from './load-hook.ts'
import { projectRoot } from './project.ts'

/**
 * The variable with the projects that a process counts for: a JSON
 * list of pairs, the root of a project and the folder for the
 * counts. A list, because a test of one project can start the
 * tests of a second one, and each test process wants the counts of
 * the processes below it.
 */
const ENV = 'UBQ_CHILD_COVERAGE'
// The source is `.ts`, and the bundle is `.js`.
const PRELOAD = new URL(import.meta.url.endsWith('.ts') ? './child-preload.ts' : './child-preload.js', import.meta.url)

type Scope = [root: string, dir: string]
const scopes = (text = process.env[ENV]): Scope[] => {
  try {
    // ubq: not measured: ubq sets this for each test process
    return JSON.parse(text || '[]') as Scope[]
  } catch {
    return []
  }
}

type Env = Record<string, string | undefined>
/** Adds the preload module to the options of Node and Bun in an environment. */
const withPreload = (env: Env): void => {
  // One copy of the module is enough. A second copy of ubq can be
  // above this process: the built package runs the tests of the
  // source.
  // ubq: not measured: a test process has the preload in NODE_OPTIONS
  if (!MODULE.test(env.NODE_OPTIONS ?? '')) env.NODE_OPTIONS = `${env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : ''}--import ${PRELOAD.href}`
  // The options of Bun have no form for a path with a space, and
  // they read `\` as the start of an escape.
  const path = fileURLToPath(PRELOAD).split(sep).join('/')
  // ubq: not measured: a test process has the preload in BUN_OPTIONS
  if (!/\s/.test(path) && !MODULE.test(env.BUN_OPTIONS ?? '')) env.BUN_OPTIONS = `${env.BUN_OPTIONS ? env.BUN_OPTIONS + ' ' : ''}--preload ${path}`
}
/** The preload module of some copy of ubq, in the options of a runtime. */
const MODULE = /[\\/]child-preload\.[jt]s\b/

/**
 * Deno has no variable that loads a module before the program. It
 * has an argument for that. This puts the argument after the
 * subcommand, if the program is Deno and the subcommand runs code.
 * A Deno that starts through a shell or a script does not get it.
 */
// ubq: not measured: child-preload.ts runs it before counters start
const forDeno = (program: string, args: string[]): string[] =>
  /(^|[\\/])deno(\.exe)?$/i.test(program) && /^(run|test|serve)$/.test(args[0] ?? '') && !args.some(arg => arg.includes('child-preload.')) ?
    [args[0]!, `--preload=${PRELOAD.href}`, ...args.slice(1)]
  : args

const PATCHED = Symbol.for('ubqtest.spawn')
/** The key of the function that adds the counters of this module to the text of a file. */
export const CHILD_SOURCE = Symbol.for('ubqtest.child.source')
/** True if a copy of this module counts in this process. */
const STARTED = Symbol.for('ubqtest.child')
/**
 * A process can give its child a new environment, with none of the
 * variables of this file. Then the child has no coverage, with no
 * sign. This adds the variables to each environment that a spawn
 * function of Node gets. Bun and Deno do not have these functions
 * in this form: there, a child gets the variables only if it gets
 * the environment of its parent.
 */
export const patchSpawn = (): void => {
  const shared = globalThis as { [PATCHED]?: boolean }
  if (shared[PATCHED] || process.versions.bun || process.versions.deno) return
  // ubq: not measured: child-preload.ts runs it before counters start
  shared[PATCHED] = true
  // spawn, exec, execFile, and fork end in this method.
  const proto = ChildProcess.prototype as unknown as { spawn(options: { envPairs?: string[]; file?: string; args?: string[] }): unknown }
  const spawn = proto.spawn
  proto.spawn = function (options: { envPairs?: string[]; file?: string; args?: string[] }) {
    const list = process.env[ENV]
    // `args` has the name of the program first.
    if (list && options?.file && Array.isArray(options.args)) options.args = [options.args[0]!, ...forDeno(options.file, options.args.slice(1))]
    if (list && Array.isArray(options?.envPairs)) {
      const env: Env = {}
      for (const name of [ENV, 'NODE_OPTIONS', 'BUN_OPTIONS']) {
        const at = options.envPairs.findIndex(pair => pair.startsWith(name + '='))
        if (at >= 0) env[name] = options.envPairs.splice(at, 1)[0]!.slice(name.length + 1)
      }
      env[ENV] ??= list
      withPreload(env)
      for (const [name, value] of Object.entries(env)) options.envPairs.push(`${name}=${value}`)
    }
    return spawn.call(this, options)
  }
  const sync = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
    const real = sync[name]!
    sync[name] = (...args: unknown[]) => {
      const list = process.env[ENV]
      // spawnSync and execFileSync have the arguments of the program as a list.
      if (list && typeof args[0] === 'string' && Array.isArray(args[1])) args[1] = forDeno(args[0], args[1] as string[])
      const at = args.findIndex(arg => !!arg && typeof arg === 'object' && !Array.isArray(arg))
      const options = args[at] as { env?: Env } | undefined
      if (list && options?.env) {
        const env: Env = { ...options.env }
        env[ENV] ??= list
        withPreload(env)
        args[at] = { ...options, env }
      }
      return real(...args)
    }
  }
  nodeModule.syncBuiltinESMExports()
}

/**
 * For a test process: its children count for the project of the
 * test process, and write to a folder of this process. A project
 * that is in the list from above gets this process as its reader.
 */
export const announce = (): void => {
  const root = projectRoot()
  const dir = join(root, '.ubq', 'children', String(process.pid))
  process.env[ENV] = JSON.stringify([...scopes().filter(scope => scope[0] !== root), [root, dir]])
  withPreload(process.env)
  ;(globalThis as { [CHILDREN]?: Children })[CHILDREN] = { dir, root }
  patchSpawn()
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
}

/** Time between two writes of the counts, for a process that ends with no notice. */
const WRITE_MS = 200

/** The write function of each project that this process counts for. */
const writers: (() => void)[] = []


/** Counts for the files of one project, and writes the counts to `dir`. */
// ubq: not measured: child-preload.ts runs it before counters start
const count = ([root, dir]: Scope): Counting => {
  const shared = globalThis as Record<symbol, unknown>
  const all = (shared[Symbol.for(COUNTERS)] ??= new Map<string, Uint32Array>()) as Map<string, Uint32Array>
  const files = new Map<string, { cache: string; counts: Uint32Array }>()
  const start = root + sep
  const modules = `${sep}node_modules${sep}`
  let written = -1
  const write = (): void => {
    const data: ChildCounts = { files: {} }
    let sum = 0
    for (const [file, { cache, counts }] of files) {
      let ran = 0
      for (const n of counts) ran += n
      if (!ran) continue
      sum += ran
      data.files[file] = { cache, counts: [...counts] }
    }
    if (sum === written || !sum) return
    written = sum
    try {
      mkdirSync(dir, { recursive: true })
      // The reader must not get half of a file.
      const path = join(dir, `${process.pid}-${threadId}.json`)
      writeFileSync(path + '.tmp', JSON.stringify(data))
      renameSync(path + '.tmp', path)
    } catch {
      // The test process ended and removed its folder.
    }
  }
  writers.push(write)
  return {
    wants: path => path.startsWith(start) && !path.includes(modules),
    change(path, source) {
      if (source === undefined) return undefined
      const file = relative(root, path).split(sep).join('/')
      // Not the key of the collector of a test process: one process
      // can have both, for two projects with a file of the same name.
      const key = `//${file}`
      const map = builtMap(path, source)
      const result = cached(key, source, false, root, path, map)
      if (!result) return undefined
      let counts = all.get(key)
      if (counts?.length !== result.regions.length) all.set(key, (counts = new Uint32Array(result.regions.length)))
      files.set(file, { cache: basename(cachePath(key, source, root, map?.text)), counts })
      return result.js === undefined ? { source: result.code, js: false } : { source: result.js, js: true }
    },
  }
}

// The part of the Bun plugin API that this file uses.
declare const Bun: {
  plugin(options: {
    name: string
    setup(build: {
      onLoad(options: { filter: RegExp }, callback: (args: { path: string }) => { contents: string; loader: string }): void
    }): void
  }): void
}

/**
 * True for a file that the collector of a test process has. A
 * project can be in a folder of a second project, so a file can be
 * in both. One file cannot get counters two times. The collector
 * can start after this module: the runner loads one test file in
 * its own process.
 */
// ubq: not measured: child-preload.ts runs it before counters start
const taken = (path: string): boolean =>
  !!(globalThis as Record<symbol, unknown>)[Symbol.for('ubqtest.collector')] && path.startsWith(projectRoot() + sep)

/** For a process below a test process: counts for each project of the list. */
// ubq: not measured: child-preload.ts runs it before counters start
export const startChild = (): void => {
  const shared = globalThis as { [STARTED]?: boolean }
  if (shared[STARTED]) return
  shared[STARTED] = true
  const list = scopes()
    // The test process of a project has the collector of that
    // project. Two sets of counters in one file do not work.
    .filter(([root]) => !(process.env.UBQ_CHILD && root === projectRoot()))
    .map(count)
  if (!list.length) return
  const write = (): void => {
    for (const one of writers) one()
  }
  process.on('exit', write)
  // And after each `exit` listener of the program: a listener can
  // run code of the project. The listener above runs in the order
  // of its start, which is before those of the program. Bun does
  // not call `process.emit` for this event.
  const emit = process.emit as (this: NodeJS.Process, ...args: unknown[]) => boolean
  process.emit = function (this: NodeJS.Process, ...args: unknown[]): boolean {
    const result = emit.apply(this, args)
    if (args[0] === 'exit') write()
    return result
  } as typeof process.emit
  // SIGKILL, and each kill on Windows, give no notice.
  setInterval(write, WRITE_MS).unref()
  // A test stops a server with a signal. With no handler, the
  // process ends at once. With this one, it writes first, and then
  // ends with the same signal. A program with a handler of its own
  // decides when it ends.
  if (isMainThread && process.platform !== 'win32')
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      const handler = (): void => {
        if (process.listenerCount(signal) > 1) return
        write()
        process.removeListener(signal, handler)
        process.kill(process.pid, signal)
      }
      process.on(signal, handler)
    }
  // A process can give code to a runtime that is not this one: the
  // host of workerd reads each module from the disk. It adds the
  // counters with this function.
  ;(globalThis as Record<symbol, unknown>)[CHILD_SOURCE] = (path: string, source: string) =>
    taken(path) ? undefined : list.find(counting => counting.wants(path))?.change(path, source)
  if (process.versions.bun) {
    for (const [i, counting] of list.entries())
      Bun.plugin({
        name: `ubqtest child coverage ${i}`,
        setup(build) {
          const escaped = scopes()[i]![0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onLoad({ filter: new RegExp(`^${escaped}[\\\\/](?!.*node_modules).*\\.([cm]?[jt]s|[jt]sx)$`) }, ({ path }) => {
            const source = readFileSync(path, 'utf8')
            // Bun gives a file to one plugin. The plugin of a test
            // process has a function that adds its counters.
            const mine = (globalThis as Record<symbol, unknown>)[Symbol.for(SOURCE)] as ((path: string) => string) | undefined
            if (taken(path) && mine) return { contents: mine(path), loader: /[jt]sx$/.exec(path)?.[0] ?? (/ts$/.test(path) ? 'ts' : path.endsWith('.js') ? 'jsx' : 'js') }
            return {
              contents: (taken(path) ? undefined : counting.change(path, source)?.source) ?? source,
              loader: /[jt]sx$/.exec(path)?.[0] ?? (/ts$/.test(path) ? 'ts' : path.endsWith('.js') ? 'jsx' : 'js'),
            }
          })
        },
      })
    return
  }
  // A Node that is too old for this function has no coverage.
  nodeModule.registerHooks?.({
    load: (url, context, next) =>
      withCounters(url, next(url, context), path => (taken(path) ? undefined : list.find(counting => counting.wants(path)))),
  })
}
