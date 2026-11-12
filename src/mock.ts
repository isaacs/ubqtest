// `mockImport`: a new instance of a module, with some of its
// dependencies replaced. See docs/05-api.md, section 6.
import * as nodeModule from 'node:module'

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

const register = (): void => {
  if (registered) return
  if (typeof nodeModule.registerHooks !== 'function')
    throw new Error(
      `mockImport does not work on this runtime yet${process.versions.bun ? ' (Bun)' : ''}. It needs module.registerHooks.`,
    )
  registered = true
  ;(globalThis as Record<symbol, unknown>)[KEY] = table
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
      const dep = rest.slice(id.length + 1)
      const keys = Object.keys(table.get(id)!.get(dep)!)
      const source = [
        `const m = globalThis[Symbol.for('ubq.mocks')].get(${JSON.stringify(id)}).get(${JSON.stringify(dep)})`,
        ...keys.map(k =>
          k === 'default' ? 'export default m.default' : `export const ${k} = m[${JSON.stringify(k)}]`,
        ),
        // `import fs from 'node:fs'` reads the names from the default export.
        ...(keys.includes('default') ? [] : ['export default m']),
      ].join('\n')
      return { format: 'module', source, shortCircuit: true }
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
    capture = {}
    let loaded: Promise<unknown>
    try {
      loaded = load()
    } finally {
      var url = capture.url
      capture = undefined
    }
    await loaded
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
  if (missed) throw new TypeError(`the first argument of mockImport ${SHAPE}`)
  try {
    return await loaded
  } catch (error) {
    // The module under test imports a name that the mock does not have.
    const m =
      error instanceof SyntaxError &&
      /module '([^']+)' does not provide an export named '([^']+)'/.exec(error.message)
    if (!m || ![...deps.values()].some(exports => !(m[2]! in exports))) throw error
    throw new Error(
      `the mock of ${m[1]} has no export "${m[2]}", and the code under test imports it. Add "${m[2]}" to the mock.`,
    )
  }
}
