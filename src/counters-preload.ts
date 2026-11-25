// Coverage on Node through source counters, in place of V8
// snapshots: `node --import ubqtest/counters-preload test/foo.ts`.
// A load hook adds counters to each project file.
// See docs/03-measurements.md, section 12.
import { statSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { announce } from './child-coverage.ts'
import { setDefines } from './config.ts'
import { setDom } from './dom.ts'
import { startCounters } from './counter-collector.ts'
import { builtin, withCounters } from './load-hook.ts'

const deno = !!process.versions.deno
/** The codes of an import or a require that names no file, or names a folder. */
const NOT_FOUND = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT', 'MODULE_NOT_FOUND'])

// TypeScript source often imports `./a.js` for the file `./a.ts`:
// that is the name of the file after a build. Source for a bundler
// imports `./a` for the file `./a.ts`, and `./dir` for the file
// `./dir/index.ts`. Node and Deno look for the file with the name
// as it is written.
const SOURCE: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
  '.jsx': ['.tsx'],
}
const ENDS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.cjs', '.json']
/** The other names of a relative import that names no file, in the order of the search. */
const names = (specifier: string): string[] => {
  // `./a?copy=1` is a new instance of `./a.ts`: the query stays.
  const [, path, query] = /^([^?#]*)(.*)$/s.exec(specifier) as unknown as [string, string, string]
  const ext = /\.[cm]?jsx?$/.exec(path)?.[0]
  const dir = path.replace(/\/$/, '')
  return [
    ...((ext && SOURCE[ext]) || []).map(source => path.slice(0, -ext!.length) + source),
    ...ENDS.map(end => path + end),
    ...ENDS.map(end => `${dir}/index${end}`),
  ].map(name => name + query)
}
const isFile = (url: string): boolean => {
  try {
    return !url.startsWith('file:') || statSync(fileURLToPath(url)).isFile()
    // ubq: not measured: only Deno gives the URL of a file that does not exist
  } catch {
    return false
  }
}
registerHooks({
  resolve(specifier, context, next) {
    if (!/^\.\.?(\/|$)/.test(specifier)) return next(specifier, context)
    let result: ReturnType<typeof next> | undefined
    let missing: unknown
    try {
      result = next(specifier, context)
      // Deno gives the URL of a file that does not exist, or of a folder.
      if (!deno || isFile(result.url)) return result
    } catch (error) {
      // ubq: not measured: this module loads before the counters start
      if (!NOT_FOUND.has((error as NodeJS.ErrnoException).code!)) throw error
      missing = error
    }
    for (const name of names(specifier)) {
      try {
        const found = next(name, context)
        // ubq: not measured: this module loads before the counters start
        if (!deno || isFile(found.url)) return found
      } catch {
        // Not this name.
      }
    }
    // ubq: not measured: this module loads before the counters start
    if (result) return result
    throw missing
  },
})

setDefines()
setDom(process.env.UBQ_FILE)
const counters = startCounters()
// Before Node 24.18 and 26.5, a `require` with a name that is no
// file does not get the names of the resolve hook above. The
// CommonJS of the `transform` key calls this function for its
// `require` (`REQUIRE` in `transform.ts`).
// ubq: not measured: this module loads before the counters start
if (counters?.transformed)
  (globalThis as Record<symbol, unknown>)[Symbol.for('ubq.require')] = (
    real: NodeJS.Require,
    file: string,
  ): NodeJS.Require => {
    // On these versions, a file that `import` loaded gets a
    // `require` of the ES module loader, which has no `cache`. On
    // Node 22 it fails for a module that is not CommonJS.
    // ubq: not measured: in the tests, each require here has a cache
    const base = real.cache ? real : createRequire(file)
    return Object.assign((name: string): unknown => {
      if (!/^\.\.?(\/|$)/.test(name)) return base(name)
      for (const other of [name, ...names(name)]) {
        let found: string
        try {
          found = base.resolve(other)
        } catch {
          continue
        }
        return base(found)
      }
      // With no file, Node gives the error for the name as it is written.
      return base(name)
    }, base)
  }
// The processes that the tests start count too (D53).
if (counters) announce()
if (counters)
  registerHooks({
    load: counters.transformed
      ? // The `transform` key: this hook reads each TypeScript file of the project.
        (url, context, next) =>
          (builtin(url, context) as ReturnType<typeof next> | undefined) ??
          // ubq: not measured: this module loads before the counters start
          (url.startsWith('file:') ? counters.transformed!(fileURLToPath(url.replace(/\?.*$/, ''))) : undefined) ??
          // ubq: not measured: this module loads before the counters start
          withCounters(url, next(url, context), path => (counters.wants(path) ? counters : undefined))
      : (url, context, next) =>
          (builtin(url, context) as ReturnType<typeof next> | undefined) ??
          withCounters(url, next(url, context), path => (counters.wants(path) ? counters : undefined)),
  })

// The JavaScript of the `transform` key can be CommonJS. On Node
// 22, a `require` of this library from such a file fails if the
// library is not loaded ("request for './capture.ts' is not in
// cache"). The test file loads the library in each case. Only in
// a test process of the runner: in the process of the runner, the
// library must load after the runner names the test file. The URL
// is not a literal, so that the bundle of this file does not get
// a second copy of the library.
// ubq: not measured: this module loads before the counters start
if (counters?.transformed && process.env.UBQ_CHILD)
  // ubq: not measured: no test runs the built package with the transform key
  await import(new URL(import.meta.url.endsWith('.ts') ? './index.ts' : './index.js', import.meta.url).href)
