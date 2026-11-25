// `mockImport`: a new instance of a module, with some of its
// dependencies replaced. See docs/05-api.md, section 6.
import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SOURCE } from './counters.ts'
import { cleanup, watch } from './fixtures.ts'
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

/** One import of a file: the name of the module, and the exports that the file uses. `'*'` is each export. */
interface Import {
  specifier: string
  names: Set<string> | '*'
}

// `import a, { b as c } from 'x'`, `export { a } from 'x'`, `export * from 'x'`
const STATIC = /\b(?:import|export)\s+(type\s+)?([\w$\s{},*]+?)\s*from\s*(['"])([^'"\n]+)\3/g
// `import 'x'`
const EFFECT = /\bimport\s*(['"])([^'"\n]+)\1/g
// `import('x')`, `require('x')`
const DYNAMIC = /\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g

/**
 * The imports of a source text, found by their text. An import of
 * only types is not in the list: it loads no module. Text in a
 * comment or in a string that looks like an import is in the list.
 * That is safe: the reader of the list then makes a new instance
 * of a module, or loads a real module, that it did not need.
 */
export const scanImports = (source: string): Import[] => {
  const found: Import[] = []
  for (const [, type, clause, , specifier] of source.matchAll(STATIC)) {
    if (type) continue
    const names = new Set<string>()
    const [head, list] = clause!.split('{')
    if (head!.includes('*')) {
      found.push({ specifier: specifier!, names: '*' })
      continue
    }
    // `import a from`: not the `export` of `export { a } from`.
    if (/[\w$]/.test(head!)) names.add('default')
    for (const part of (list ?? '').replace('}', '').split(',')) {
      const [name, ...more] = part.trim().split(/\s+/)
      // `type A` is no export of the module. `type as b` is the export `type`.
      if (name && (name !== 'type' || !more.length || more[0] === 'as')) names.add(name)
    }
    found.push({ specifier: specifier!, names })
  }
  for (const [, , specifier] of source.matchAll(EFFECT)) found.push({ specifier: specifier!, names: new Set() })
  for (const [, , specifier] of source.matchAll(DYNAMIC)) found.push({ specifier: specifier!, names: '*' })
  return found
}

/** The imports of each file that a plan read, by URL (Node, Deno) or by path (Bun). */
const scanned = new Map<string, Import[]>()
const importsOf = (key: string): Import[] => {
  let found = scanned.get(key)
  if (!found) {
    try {
      found = scanImports(readFileSync(key.startsWith('file:') ? fileURLToPath(key) : key, 'utf8'))
    } catch {
      // ubq: not measured: each module of a plan is a file that the runtime found
      found = []
    }
    scanned.set(key, found)
  }
  return found
}

/** Mock number, then the project modules that get a new instance. */
const fresh = new Map<string, Set<string>>()

/**
 * Finds the modules that get a new instance in mock `id`: the
 * module under test, each mocked project module, and each project
 * module that imports a mock, directly or through other project
 * modules. Each other module is the one that the test file has: its
 * state, its classes, and its objects are the same in the test and
 * in the code under test. `resolve` gives the module of an import,
 * and `own` is true for a project module.
 */
const plan = (
  id: string,
  subject: string,
  resolve: (specifier: string, parent: string) => string | undefined,
  own: (key: string) => boolean,
): void => {
  const mocks = table.get(id)!
  /** A module, then the modules that import it. */
  const importers = new Map<string, string[]>()
  const seen = new Set([subject])
  const nodes = [subject]
  for (const key of nodes)
    for (const { specifier } of importsOf(key)) {
      const dep = resolve(specifier, key)
      if (dep === undefined) continue
      importers.set(dep, [...(importers.get(dep) ?? []), key])
      if (!seen.has(dep) && own(dep)) {
        seen.add(dep)
        nodes.push(dep)
      }
    }
  const set = new Set<string>()
  const queue = [...mocks.keys()]
  for (const key of queue)
    for (const importer of importers.get(key) ?? [])
      if (!set.has(importer)) {
        set.add(importer)
        queue.push(importer)
      }
  set.add(subject)
  // The real exports of a mocked module are those of a new instance.
  for (const key of mocks.keys()) set.add(key)
  fresh.set(id, set)
}

/**
 * The exports of dependency `dep` that the file `parent` uses and
 * the mock does not have, as the part of the URL of the mock
 * module: `'*'` for each export, or names with `,` between them.
 * With no name, the real dependency does not load.
 */
const needOf = (id: string, dep: string, parent: string, specifier: string): string => {
  const mock = table.get(id)!.get(dep)!
  const names = new Set<string>()
  const imports = importsOf(parent).filter(i => i.specifier === specifier)
  // An import that the scan did not find, such as one with a name from a variable.
  if (!imports.length || imports.some(i => i.names === '*')) return '*'
  for (const i of imports) for (const name of i.names as Set<string>) if (!(name in mock)) names.add(name)
  return [...names].sort().join(',')
}

const NAME = /^[A-Za-z_$][\w$]*$/

/**
 * The source of the module that replaces dependency `dep` in mock
 * `id`, for a file that needs the exports `need` from the real
 * dependency. `real` is the name of the module with those exports.
 * Each export of the mock is a `let`: `spyOn` and `stub` on the mock
 * object change it in the instance too.
 */
const mockSource = (id: string, dep: string, need: string, real: string): string => {
  const keys = Object.keys(table.get(id)!.get(dep)!)
  const named = keys.filter(k => k !== 'default' && NAME.test(k))
  const missing = need === '*' ? [] : need.split(',').filter(k => k && k !== 'default' && NAME.test(k))
  const realDefault = !keys.includes('default') && (need === '*' || need.split(',').includes('default'))
  const mocks = `globalThis[Symbol.for('ubq.mocks')]`
  return [
    `const __ubq_m = ${mocks}.get(${JSON.stringify(id)}).get(${JSON.stringify(dep)})`,
    ...(realDefault ? [`import * as __ubq_real from ${JSON.stringify(real)}`] : []),
    ...(need === '*' ? [`export * from ${JSON.stringify(real)}`] : []),
    ...named.map(k => `export let ${k} = __ubq_m.${k}`),
    ...(missing.length ? [`export { ${missing.join(', ')} } from ${JSON.stringify(real)}`] : []),
    // `import fs from 'node:fs'` reads the names from the default
    // export: the real ones, with those of the mock on top.
    keys.includes('default')
      ? 'let __ubq_d = __ubq_m.default'
      : `let __ubq_d = ${realDefault ? `${mocks}.merge(__ubq_real.default, __ubq_m)` : '__ubq_m'}`,
    'export { __ubq_d as default }',
    `${mocks}.watch(__ubq_m, k => {`,
    ...named.map(k => `  if (k === ${JSON.stringify(k)}) ${k} = __ubq_m.${k}`),
    keys.includes('default')
      ? "  if (k === 'default') __ubq_d = __ubq_m.default"
      : '  if (__ubq_d !== __ubq_m) __ubq_d[k] = __ubq_m[k]',
    '})',
  ].join('\n')
}

/** The default export of a partial mock: the real one, with the exports of the mock on top. */
const merge = (real: unknown, mock: object): unknown =>
  real !== null && typeof real === 'object'
    ? Object.assign(Object.create(Object.getPrototypeOf(real) as object | null), real, mock)
    : (real ?? mock)

/** The source of an ES module with the exports of a CommonJS module of an instance. */
const facadeSource = (id: string, url: string): string => {
  const keys = Object.keys(table.get(id)!.get(url)!)
  return [
    `const m = globalThis[Symbol.for('ubq.mocks')].get(${JSON.stringify(id)}).get(${JSON.stringify(url)})`,
    ...keys.map(k => (k === 'default' ? 'export default m.default' : `export const ${k} = m[${JSON.stringify(k)}]`)),
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
    const project = isAbsolute(file) && CODE.test(file) && ownCode(url)
    if (!mock) return project && fresh.get(id)!.has(url) ? instance(file) : real(name)
    used.get(id)?.add(url)
    // An export that the mock does not have is the real one. The
    // real module loads only if the code reads such an export.
    let rest: Record<PropertyKey, unknown> | undefined
    const other = (): Record<PropertyKey, unknown> =>
      (rest ??= Object((project ? instance(file) : real(name)) as object) as Record<PropertyKey, unknown>)
    return new Proxy(mock, {
      get: (target, key, receiver) =>
        key in target
          ? Reflect.get(target, key, receiver)
          : // `import x from` reads `default` only from a module with this mark.
            key === '__esModule' && 'default' in target
            ? true
            : other()[key],
    })
  }
  return Object.assign(required, real) as Require
}

// `from '...'`, `import '...'`, `import('...')`
const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g
const CODE = /\.[cm]?([jt]sx?)$/

/** On Bun, a module is a path. A project module is a code file that is not in a package. */
const ownPath = (path: string): boolean => CODE.test(path) && !/[\\/]node_modules[\\/]/.test(path)
const resolveBun = (specifier: string, parent: string): string | undefined => {
  try {
    return Bun.resolveSync(specifier, dirname(parent))
    // ubq: not measured: Bun resolves each import of the tests
  } catch {
    return undefined
  }
}
/** The mock number, the needed exports, and the dependency, from the name of a mock module. */
const mockParts = (name: string): [id: string, need: string, dep: string] => {
  const [id, need] = name.split(':', 2) as [string, string]
  return [id, need, name.slice(id.length + need.length + 2)]
}

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
        if (!c) {
          plan(id!, file, resolveBun, ownPath)
          return { path: `${file}?mock=${id}` }
        }
        // A mock loader names its dependency, and must not load it.
        c.url = file
        return { path: 'stub', namespace: 'ubqstub' }
      })
      build.onLoad({ filter: /.*/, namespace: 'ubqstub' }, () => ({ contents: '', loader: 'js' }))
      build.onLoad({ filter: /.*/, namespace: 'ubqmock' }, ({ path }) => {
        const [id, need, dep] = mockParts(path)
        return { contents: mockSource(id, dep, need, ownPath(dep) ? `${dep}?mock=${id}` : dep), loader: 'js' }
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
              const need = needOf(id, dep, file, specifier)
              return `${head}${quote}ubqmock:${id}:${need}:${dep.replaceAll('\\', '\\\\')}${quote}`
            }
            // A project module that imports a mock gets a new
            // instance. Packages and builtins do not.
            return ownPath(dep) && fresh.get(id)!.has(dep) ? `${head}${quote}${specifier}?mock=${id}${quote}` : all
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
  ;(globalThis as Record<symbol, unknown>)[KEY] = Object.assign(table, { merge, watch })
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
        const find = (name: string, parentURL: string): string | undefined => {
          try {
            return next(name, { ...context, parentURL }).url
          } catch {
            // An import that names no file fails when its module loads.
            return undefined
          }
        }
        plan(id, result.url, find, ownCode)
        return { ...result, url: `${result.url}?mock=${id}` }
      }
      const parent = context.parentURL
      const id = parent?.includes('?mock=') ? new URL(parent).searchParams.get('mock') : null
      if (!id) return result
      if (table.get(id)?.has(result.url)) {
        used.get(id)?.add(result.url)
        const need = needOf(id, result.url, parent!.slice(0, parent!.lastIndexOf('?')), specifier)
        return { url: `${MOCK}${id}:${need}:${result.url}`, shortCircuit: true }
      }
      // A project module that imports a mock gets a new instance.
      return ownCode(result.url) && fresh.get(id)!.has(result.url)
        ? { ...result, url: `${result.url}?mock=${id}` }
        : result
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
          return { format: 'module', source: facadeSource(subject, url), shortCircuit: true }
        }
        if (!loading || typeof result.source !== 'string') return result
        // After the directive, if the code has one: it must stay first.
        const own = `require = globalThis[Symbol.for('ubq.mockRequire')](${JSON.stringify(loading)}, require);`
        return { ...result, source: result.source.replace(/^\s*(?:(['"])use strict\1;?)?/, start => start + own) }
      }
      const [id, need, dep] = mockParts(url.slice(MOCK.length))
      const real = ownCode(dep) ? `${dep}?mock=${id}` : dep
      return { format: 'module', source: mockSource(id, dep, need, real), shortCircuit: true }
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
 * Loads a new instance of a module, with the dependencies in
 * `mocks` replaced. A mock gives only the exports to replace: each
 * other export is the real one. A project module that imports a
 * mock, directly or through other project modules, is new in the
 * instance too. Each other module is the one that the test file
 * has, with the same state.
 *
 * ```ts
 * const { greet } = await mockImport(() => import('../src/greet.ts'), [
 *   [() => import('../src/db.ts'), { fetchUser }],
 * ])
 * ```
 *
 * At the top level of a file, the instance is for each test of
 * the file. To change a mock for one test, use `spyOn` or `stub`
 * on the mock object: the old value comes back when the test ends.
 *
 * ```ts
 * const db = { fetchUser: spy(async (id: number) => ada) }
 * const { greet } = await mockImport(() => import('../src/greet.ts'), [[() => import('../src/db.ts'), db]])
 * test('no user', async () => {
 *   spyOn(db, 'fetchUser', async () => undefined)
 *   assert.equal(await greet(7), 'hello, stranger')
 * })
 * ```
 */
export const mockImport = async <M, const D extends readonly unknown[]>(
  subject: Loader<M>,
  mocks: { [K in keyof D]: readonly [Loader<D[K]>, MockOf<D[K]>] },
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
    plan(id, path, resolveBun, ownPath)
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
    // The code under test imports a name that the mock does not
    // have, and the real module does not have it.
    const message = error instanceof SyntaxError ? error.message : ''
    const node = /module '([^']+?)(?:\?mock=\d+)?' does not provide an export named '([^']+)'/.exec(message)
    const onBun = /export '([^']+)' not found in '([^']+?)(?:\?mock=\d+)?'/.exec(message)
    const [from, name] = node ? [node[1]!, node[2]!] : onBun ? [onBun[2]!, onBun[1]!] : []
    if (!name || !from || !deps.has(from)) throw error
    throw new Error(
      `the code under test imports "${name}" from ${nameOfMock(from)}. The mock does not have it, and the real module does not have it.`,
    )
  }
}
