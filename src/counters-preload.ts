// Coverage on Node through source counters, in place of V8
// snapshots: `node --import ubqtest/counters-preload test/foo.ts`.
// A load hook adds counters to each project file.
// See docs/03-measurements.md, section 12.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { announce } from './child-coverage.ts'
import { startCounters } from './counter-collector.ts'
import { withCounters } from './load-hook.ts'

const deno = !!process.versions.deno

// TypeScript source often imports `./a.js` for the file `./a.ts`:
// that is the name of the file after a build. Node and Deno look
// for the file with the name as it is written.
const SOURCE: Record<string, string[]> = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] }
registerHooks({
  resolve(specifier, context, next) {
    const ext = /^\.\.?\/.*(\.[cm]?jsx?)$/.exec(specifier)?.[1]
    if (!ext) return next(specifier, context)
    let result: ReturnType<typeof next> | undefined
    let missing: unknown
    try {
      result = next(specifier, context)
      // Deno gives the URL of a file that does not exist.
      if (!deno || !result.url.startsWith('file:') || existsSync(fileURLToPath(result.url))) return result
    } catch (error) {
      // ubq: not measured: this module loads before the counters start
      if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error
      missing = error
    }
    for (const source of SOURCE[ext]!) {
      try {
        const found = next(specifier.slice(0, -ext.length) + source, context)
        // ubq: not measured: this module loads before the counters start
        if (!deno || existsSync(fileURLToPath(found.url))) return found
      } catch {
        // Not this name.
      }
    }
    // ubq: not measured: this module loads before the counters start
    if (result) return result
    throw missing
  },
})

const counters = startCounters()
// The processes that the tests start count too (D53).
if (counters) announce()
if (counters) registerHooks({ load: (url, context, next) => withCounters(url, next(url, context), path => (counters.wants(path) ? counters : undefined)) })
