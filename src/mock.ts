// `mockImport`: a new instance of a module, with some of its
// dependencies replaced. See docs/05-api.md, section 6.
import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SOURCE } from './counters.ts'
import { cleanup } from './fixtures.ts'
import { current } from './state.ts'
import { projectRoot, rel } from './project.ts'
import { callSite } from './stack.ts'
import { notInWorkerd } from './workerd.ts'
import { builtin } from './load-hook.ts'

// The part of the Bun API that this file uses.
declare const Bun: {
  resolveSync(specifier: string, from: string): string
  plugin(options: {
    name: string
    setup(build: {
      onResolve(
        options: { filter: RegExp },
        callback: (args: { path: string; importer: string }) => { path: string; namespace?: string } | undefined,
      ): void
      onLoad(
        options: { filter: RegExp; namespace?: string },
        callback: (args: { path: string }) => { contents: string; loader: string },
      ): void
    }): void
  }): void
}
const bun = !!process.versions.bun

/** A function that imports a module: `() => import('../src/a.ts')`. */
type Loader<M> = () => Promise<M>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** A function with any arguments and any result. */
type AnyFn = (...args: any[]) => any

/**
 * The exports that replace a module. Each one must have the type of
 * the real export. For a function with overloads, a function that
 * fits the last overload is correct too.
 */
export type MockOf<T> = {
  [K in keyof T]?: T[K] extends AnyFn ? T[K] | ((...args: Parameters<T[K]>) => ReturnType<T[K]>) : T[K]
}

/** Set while a mock loader runs: the resolve hook writes the URL of the dependency. */
let capture: { url?: string } | undefined
/** Set while the subject loader runs: the number of the mock. */
let pending: string | undefined
/** Mock number, then URL of the dependency, then the exports that replace it. */
const table = new Map<string, Map<string, Record<string, unknown>>>()
/** Mock number, then the mocked dependencies that an import of the instance got. */
const used = new Map<string, Set<string>>()
const KEY = Symbol.for('ubq.mocks')
let count = 0
let registered = false

const STUB = 'ubqstub:'
const MOCK = 'ubqmock:'

/** Project code gets a new instance for each mock. Packages and builtins do not. */
/** The folder of this library. With a link to the package, it is not in `node_modules`. */
const LIBRARY = new URL('.', import.meta.url).href
const ownCode = (url: string): boolean =>
  url.startsWith('file:') && !/[\\/]node_modules[\\/]/.test(url) && !url.startsWith(LIBRARY)

/** The source of the module that replaces dependency `dep` in mock `id`. */
const mockSource = (id: string, dep: string): string => {
  const keys = Object.keys(table.get(id)!.get(dep)!)
  return [
    `const m = globalThis[Symbol.for('ubq.mocks')].get(${JSON.stringify(id)}).get(${JSON.stringify(dep)})`,
    ...keys.map(k => (k === 'default' ? 'export default m.default' : `export const ${k} = m[${JSON.stringify(k)}]`)),
    // `import fs from 'node:fs'` reads the names from the default export.
    ...(keys.includes('default') ? [] : ['export default m']),
  ].join('\n')
}

const REQUIRE = Symbol.for('ubq.mockRequire')
/** Set while a CommonJS module of a mocked instance loads: the number of the mock. */
let loading: string | undefined
/** Mock number, then the path of a CommonJS file, then its module in that instance. */
const instances = new Map<string, Map<string, { exports: unknown }>>()
/** Mock number, then the files of the instance that are in the middle of their load. */
const started = new Map<string, Set<string>>()

type Require = NodeJS.Require

/**
 * The `require` of a CommonJS module in mocked instance `id`. Node
 * does not give the resolve hook the URL of the instance for a
 * `require`, and it keeps one module for each file. So this
 * function gives the mock of a mocked dependency, and loads a new
 * module for each project file, one time for each instance.
 */
const mockRequire = (id: string, real: Require): Require => {
  const mocks = table.get(id)!
  const made = instances.get(id) ?? instances.set(id, new Map()).get(id)!
  const busy = started.get(id) ?? started.set(id, new Set()).get(id)!
  const instance = (file: string): unknown => {
    const have = made.get(file)
    if (have) return have.exports
    // A cycle: the module that is in the middle of its load.
    if (busy.has(file)) return real.cache[file]!.exports
    const shared = real.cache[file]
    delete real.cache[file]
    const before = loading
    loading = id
    busy.add(file)
    try {
      return real(file)
    } finally {
      loading = before
      busy.delete(file)
      const mine = real.cache[file]
      if (mine) made.set(file, mine)
      // The module of the code that is not in the instance.
      if (shared) real.cache[file] = shared
      else delete real.cache[file]
    }
  }
  const required = (name: string): unknown => {
    let file: string
    try {
      file = real.resolve(name)
    } catch {
      // The error of Node for a name that is no file.
      return real(name)
    }
    // A module of the runtime has a name, and not a path.
    const url = isAbsolute(file) ? pathToFileURL(file).href : file.startsWith('node:') ? file : `node:${file}`
    const mock = mocks.get(url)
    if (mock) used.get(id)?.add(url)
    // `import x from` reads `default` only from a module with this mark.
    if (mock) return 'default' in mock ? { __esModule: true, ...mock } : mock
    return isAbsolute(file) && CODE.test(file) && ownCode(url) ? instance(file) : real(name)
  }
  return Object.assign(required, real) as Require
}

// `from '...'`, `import '...'`, `import('...')`
const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g
const CODE = /\.[cm]?([jt]sx?)$/

// Bun gives the importer of a module with no query, so the resolve
// hook cannot know that the importer is a mocked instance. The load
// hook knows it. It writes the mock number into each import of the
// instance. On Bun, a mock is keyed by a path, not by a URL.
const registerBun = (): void => {
  const source = (globalThis as Record<symbol, unknown>)[Symbol.for(SOURCE)] as ((path: string) => string) | undefined
  Bun.plugin({
    name: 'ubqtest mocks',
    setup(build) {
      // Bun calls this hook for a relative or absolute path only.
      build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
        const c = capture
        const id = pending
        if (!c && !id) return undefined
        // `resolveSync` calls this hook again.
        capture = pending = undefined
        const file = Bun.resolveSync(path, dirname(importer))
        if (!c) return { path: `${file}?mock=${id}` }
        // A mock loader names its dependency, and must not load it.
        c.url = file
        return { path: 'stub', namespace: 'ubqstub' }
      })
      build.onLoad({ filter: /.*/, namespace: 'ubqstub' }, () => ({ contents: '', loader: 'js' }))
      build.onLoad({ filter: /.*/, namespace: 'ubqmock' }, ({ path }) => {
        const id = path.slice(0, path.indexOf(':'))
        return { contents: mockSource(id, path.slice(id.length + 1)), loader: 'js' }
      })
      build.onLoad({ filter: /\?mock=\d+$/ }, ({ path }) => {
        const at = path.lastIndexOf('?')
        const file = path.slice(0, at)
        const id = path.slice(at + 6)
        const contents = (source ? source(file) : readFileSync(file, 'utf8')).replace(
          IMPORT,
          (all: string, head: string, quote: string, specifier: string) => {
            let dep: string
            try {
              dep = Bun.resolveSync(specifier, dirname(file))
              // ubq: not measured: Bun resolves each import of the tests
            } catch {
              return all
            }
            // A path of Windows has `\\`, which starts an escape in a string.
            if (table.get(id)?.has(dep)) {
              used.get(id)?.add(dep)
              return `${head}${quote}ubqmock:${id}:${dep.replaceAll('\\', '\\\\')}${quote}`
            }
            // Project code gets a new instance. Packages and builtins do not.
            return CODE.test(dep) && !/[\\/]node_modules[\\/]/.test(dep)
              ? `${head}${quote}${specifier}?mock=${id}${quote}`
              : all
          },
        )
        // ubq: not measured: each mocked file has a code extension
        return { contents, loader: CODE.exec(file)?.[1] ?? 'js' }
      })
    },
  })
}

/**
 * On Bun, the path of the module that a loader imports, for an
 * import that the resolve hook of Bun does not get: a package, a
 * builtin, or a relative path with no extension. `from` is the
 * folder of the file that has the loader.
 */
const bare = (load: Loader<unknown>, from: string): string | undefined => {
  const m = /import\((['"])([^'"]+)\1\)/.exec(String(load))
  return m ? Bun.resolveSync(m[2]!, from) : undefined
}

const register = (): void => {
  if (registered) return
  if (!bun && typeof nodeModule.registerHooks !== 'function')
    // ubq: not measured: each runtime of the tests has registerHooks
    throw new Error('mockImport does not work on this runtime yet. It needs module.registerHooks.')
  registered = true
  ;(globalThis as Record<symbol, unknown>)[KEY] = table
  ;(globalThis as Record<symbol, unknown>)[REQUIRE] = mockRequire
  if (bun) return registerBun()
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context)
      if (capture) {
        // A mock loader names its dependency, and must not load it.
        capture.url = result.url
        return { url: `${STUB}${++count}`, shortCircuit: true }
      }
      if (pending) {
        const id = pending
        pending = undefined
        return { ...result, url: `${result.url}?mock=${id}` }
      }
      const parent = context.parentURL
      const id = parent?.includes('?mock=') ? new URL(parent).searchParams.get('mock') : null
      if (!id) return result
      if (table.get(id)?.has(result.url)) {
        used.get(id)?.add(result.url)
        return { url: `${MOCK}${id}:${result.url}`, shortCircuit: true }
      }
      return ownCode(result.url) ? { ...result, url: `${result.url}?mock=${id}` } : result
    },
    load(url, context, next) {
      if (url.startsWith(STUB)) return { format: 'module', source: '', shortCircuit: true }
      if (!url.startsWith(MOCK)) {
        const result = (builtin(url, context) as ReturnType<typeof next> | undefined) ?? next(url, context)
        if (result.format !== 'commonjs' || !ownCode(url)) return result
        const subject = /\?mock=(\d+)$/.exec(url)?.[1]
        if (subject) {
          // Node has one CommonJS module for each file, with no
          // regard to the query. This hook loads the module of the
          // instance, and gives a module with its exports.
          const file = fileURLToPath(url.slice(0, url.lastIndexOf('?')))
          const exports = mockRequire(subject, nodeModule.createRequire(file))(file)
          table.get(subject)!.set(url, (Object(exports) === exports ? exports : { default: exports }) as never)
          return { format: 'module', source: mockSource(subject, url), shortCircuit: true }
        }
        if (!loading || typeof result.source !== 'string') return result
        // After the directive, if the code has one: it must stay first.
        const own = `require = globalThis[Symbol.for('ubq.mockRequire')](${JSON.stringify(loading)}, require);`
        return { ...result, source: result.source.replace(/^\s*(?:(['"])use strict\1;?)?/, start => start + own) }
      }
      const rest = url.slice(MOCK.length)
      const id = rest.slice(0, rest.indexOf(':'))
      return { format: 'module', source: mockSource(id, rest.slice(id.length + 1)), shortCircuit: true }
    },
  })
}

/**
 * The error for an import of `name` in the file at `path` that
 * names no file. Its stack has one frame: the import statement.
 */
const notFound = (name: string, path: string): Error => {
  // Node gives the full path of the file that is not there. Bun gives
  // the name as the import has it.
  // ubq: not measured: the tests of this file run on Node
  const shown = isAbsolute(name) ? rel(name) : name
  const error = new Error(`Cannot find module '${shown}' imported from ${rel(path)}`)
  const lines = readFileSync(path, 'utf8').split('\n')
  // The import names the file by its last part, with any path before it.
  // On Windows, the full path has `\`.
  const last = name.split(/[\\/]/).at(-1)!
  const line = lines.findIndex(text => /\b(import|from|require)\b/.test(text) && text.includes(last))
  // ubq: not measured: each import of the tests has its name on one line
  if (line >= 0)
    error.stack = `${error.name}: ${error.message}\n    at ${path}:${line + 1}:${lines[line]!.indexOf(last) + 1}`
  return error
}

/** The name of a mocked dependency, as a person wrote it: a module of the runtime, or a path of the project. */
const nameOfMock = (url: string): string =>
  url.startsWith('file:') ? rel(fileURLToPath(url)) : isAbsolute(url) ? rel(url) : url

const SHAPE = "must be an arrow function of the form () => import('...')"

/**
 * Loads a new instance of a module. In that instance, and in the
 * project modules that it imports, each dependency in `mocks` is
 * replaced by the given exports.
 *
 * ```ts
 * const { greet } = await mockImport(() => import('../src/greet.ts'), [
 *   [() => import('../src/db.ts'), { fetchUser }],
 * ])
 * ```
 */
export const mockImport = async <M, const D extends readonly unknown[]>(
  subject: Loader<M>,
  mocks: { [K in keyof D]: [Loader<D[K]>, MockOf<D[K]>] },
): Promise<M> => {
  notInWorkerd('mockImport')
  register()
  // After an `await`, the stack does not have the caller.
  const site = bun ? callSite() : undefined
  const from = site ? dirname(join(projectRoot(), site.file)) : projectRoot()
  const id = String(++count)
  const deps = new Map<string, Record<string, unknown>>()
  table.set(id, deps)
  for (const [load, exports] of mocks as unknown as [Loader<unknown>, Record<string, unknown>][]) {
    if (typeof load !== 'function') throw new TypeError(`a mock loader ${SHAPE}`)
    if (exports === null || typeof exports !== 'object')
      throw new TypeError('the second item of a mock must be an object with the exports that replace the module')
    const named: { url?: string } = (capture = {})
    let loaded: Promise<unknown>
    try {
      loaded = load()
    } finally {
      capture = undefined
    }
    let url = named.url
    await loaded
    if (!url && bun) url = bare(load, from)
    if (!url) throw new TypeError(`a mock loader ${SHAPE}`)
    deps.set(url, exports)
  }
  // A mock that no import of the instance got is a mistake, most
  // often a dependency that only a package imports. The check is
  // when the test ends: an import can be in a function.
  const wanted = [...deps.keys()]
  const got = new Set<string>()
  used.set(id, got)
  if (wanted.length)
    cleanup(() => {
      const unused = wanted.filter(url => !got.has(url)).map(nameOfMock)
      if (!unused.length) return
      const hint = `the mock of ${unused.join(', ')} replaced no import. No project module of the new instance imports ${unused.length === 1 ? 'it' : 'them'}. A mock does not go into a package of node_modules: if a package imports the module, make an instance of the package with the mock, and give that instance as the mock of the package. See "A dependency of a dependency" in ubq guide.`
      // The test can have a failure from the code that ran with no
      // mock, such as a time limit. That failure gets the cause.
      const failure = current.getStore()?.failure
      if (failure) failure.message += `\nhint: ${hint}`
      else throw new Error(hint)
    })
  pending = id
  let loaded: Promise<M>
  try {
    loaded = subject()
  } finally {
    var missed = pending !== undefined
    pending = undefined
  }
  if (missed) {
    const path = bun ? bare(subject, from) : undefined
    if (!path) throw new TypeError(`the first argument of mockImport ${SHAPE}`)
    // ubq: not measured: no test mocks a package on Bun
    await loaded
    loaded = import(`${path}?mock=${id}`) as Promise<M>
  }
  try {
    return await loaded
  } catch (error) {
    // An import in the new instance that names no file. The place of
    // the failure is that import, and the names are as in the project.
    const lost = /^Cannot find (?:module|package) '([^']+)' imported from (\S+?)(?:\?mock=\d+)?$/.exec(
      String((error as { message?: unknown } | null)?.message),
    )
    if (lost) throw notFound(lost[1]!, lost[2]!)
    // The module under test imports a name that the mock does not have.
    const message = error instanceof SyntaxError ? error.message : ''
    const node = /module '([^']+)' does not provide an export named '([^']+)'/.exec(message)
    const onBun = /Export named '([^']+)' not found in module 'ubqmock:\d+:([^']+)'/.exec(message)
    const [from, name] = node ? [node[1]!, node[2]!] : onBun ? [rel(onBun[2]!), onBun[1]!] : []
    if (!name || ![...deps.values()].some(exports => !(name in exports))) throw error
    throw new Error(
      `the mock of ${from} has no export "${name}", and the code under test imports it. Add "${name}" to the mock.`,
    )
  }
}
