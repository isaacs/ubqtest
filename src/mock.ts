// `mockImport`: a new instance of a module, with some of its
// dependencies replaced. See docs/05-api.md, section 6.
import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { dirname } from 'node:path'
import { SOURCE } from './counters.ts'
import { projectRoot, rel } from './project.ts'

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

type Loader<M> = () => Promise<M>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
const KEY = Symbol.for('ubq.mocks')
let count = 0
let registered = false

const STUB = 'ubqstub:'
const MOCK = 'ubqmock:'

/** Project code gets a new instance for each mock. Packages and builtins do not. */
const ownCode = (url: string): boolean =>
  url.startsWith('file:') && !url.includes('/node_modules/')

/** The source of the module that replaces dependency `dep` in mock `id`. */
const mockSource = (id: string, dep: string): string => {
  const keys = Object.keys(table.get(id)!.get(dep)!)
  return [
    `const m = globalThis[Symbol.for('ubq.mocks')].get(${JSON.stringify(id)}).get(${JSON.stringify(dep)})`,
    ...keys.map(k =>
      k === 'default' ? 'export default m.default' : `export const ${k} = m[${JSON.stringify(k)}]`,
    ),
    // `import fs from 'node:fs'` reads the names from the default export.
    ...(keys.includes('default') ? [] : ['export default m']),
  ].join('\n')
}

// `from '...'`, `import '...'`, `import('...')`
const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g
const CODE = /\.[cm]?([jt]sx?)$/

// Bun gives the importer of a module with no query, so the resolve
// hook cannot know that the importer is a mocked instance. The load
// hook knows it. It writes the mock number into each import of the
// instance. On Bun, a mock is keyed by a path, not by a URL.
const registerBun = (): void => {
  const source = (globalThis as Record<symbol, unknown>)[Symbol.for(SOURCE)] as
    | ((path: string) => string)
    | undefined
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
            } catch {
              return all
            }
            if (table.get(id)?.has(dep)) return `${head}${quote}ubqmock:${id}:${dep}${quote}`
            // Project code gets a new instance. Packages and builtins do not.
            return CODE.test(dep) && !dep.includes('/node_modules/') ?
                `${head}${quote}${specifier}?mock=${id}${quote}`
              : all
          },
        )
        return { contents, loader: CODE.exec(file)?.[1] ?? 'js' }
      })
    },
  })
}

/**
 * On Bun, the path of the package or builtin that a loader imports.
 * Bun has no resolve hook for them.
 */
const bare = (load: Loader<unknown>): string | undefined => {
  const m = /import\((['"])([^'"]+)\1\)/.exec(String(load))
  return m ? Bun.resolveSync(m[2]!, projectRoot()) : undefined
}

const register = (): void => {
  if (registered) return
  if (!bun && typeof nodeModule.registerHooks !== 'function')
    throw new Error('mockImport does not work on this runtime yet. It needs module.registerHooks.')
  registered = true
  ;(globalThis as Record<symbol, unknown>)[KEY] = table
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
      if (table.get(id)?.has(result.url))
        return { url: `${MOCK}${id}:${result.url}`, shortCircuit: true }
      return ownCode(result.url) ? { ...result, url: `${result.url}?mock=${id}` } : result
    },
    load(url, context, next) {
      if (url.startsWith(STUB)) return { format: 'module', source: '', shortCircuit: true }
      if (!url.startsWith(MOCK)) return next(url, context)
      const rest = url.slice(MOCK.length)
      const id = rest.slice(0, rest.indexOf(':'))
      return { format: 'module', source: mockSource(id, rest.slice(id.length + 1)), shortCircuit: true }
    },
  })
}

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
  register()
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
    if (!url && bun) url = bare(load)
    if (!url) throw new TypeError(`a mock loader ${SHAPE}`)
    deps.set(url, exports)
  }
  pending = id
  let loaded: Promise<M>
  try {
    loaded = subject()
  } finally {
    var missed = pending !== undefined
    pending = undefined
  }
  if (missed) {
    const path = bun ? bare(subject) : undefined
    if (!path) throw new TypeError(`the first argument of mockImport ${SHAPE}`)
    await loaded
    loaded = import(`${path}?mock=${id}`) as Promise<M>
  }
  try {
    return await loaded
  } catch (error) {
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
