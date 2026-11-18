// Coverage on Node through source counters, in place of V8
// snapshots: `node --import ubqtest/counters-preload test/foo.ts`.
// A load hook adds counters to each project file.
// See docs/03-measurements.md, section 12.
import { statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { announce } from './child-coverage.ts'
import { setDefines } from './config.ts'
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
  const ext = /\.[cm]?jsx?$/.exec(specifier)?.[0]
  const dir = specifier.replace(/\/$/, '')
  return [
    ...((ext && SOURCE[ext]) || []).map(source => specifier.slice(0, -ext!.length) + source),
    ...ENDS.map(end => specifier + end),
    ...ENDS.map(end => `${dir}/index${end}`),
  ]
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
const counters = startCounters()
// The processes that the tests start count too (D53).
if (counters) announce()
if (counters)
  registerHooks({
    load: (url, context, next) =>
      (builtin(url, context) as ReturnType<typeof next> | undefined) ??
      withCounters(url, next(url, context), path => (counters.wants(path) ? counters : undefined)),
  })
