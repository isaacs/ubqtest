// Coverage on Node through source counters, in place of V8
// snapshots: `node --import ubqtest/counters-preload test/foo.ts`.
// A load hook adds counters to each project file.
// See docs/03-measurements.md, section 12.
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startCounters } from './counter-collector.ts'

const FORMATS = new Set(['module', 'commonjs', 'module-typescript', 'commonjs-typescript'])

const deno = !!process.versions.deno
/**
 * A source map that changes no position. The parts are separate so
 * that the bundle of this file does not contain the marker itself:
 * a runtime reads the marker as the source map of the bundle.
 */
const NO_MAP = [
  '\n//# source',
  'MappingURL=data:application/json;base64,',
  btoa('{"version":3,"sources":[],"names":[],"mappings":""}'),
].join('')

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
      if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error
      missing = error
    }
    for (const source of SOURCE[ext]!) {
      try {
        const found = next(specifier.slice(0, -ext.length) + source, context)
        if (!deno || existsSync(fileURLToPath(found.url))) return found
      } catch {
        // Not this name.
      }
    }
    if (result) return result
    throw missing
  },
})

const counters = startCounters()
if (counters)
  registerHooks({
    load(url, context, next) {
      const result = next(url, context)
      if (!url.startsWith('file:')) return result
      // With a load hook, Deno 2.9 gives no format for a JSON file
      // that `require` loads, and then reads the file as JavaScript.
      if (deno && !result.format && /\.json$/.test(url)) return { ...result, format: 'json' }
      // A mocked module instance has a query on its URL.
      const path = fileURLToPath(url.replace(/\?.*$/, ''))
      if (!counters.wants(path)) return result
      if (deno) {
        // Deno gives the JavaScript that it made from TypeScript, with
        // different positions, and it gives no format. The counters
        // need the positions of the source, so this hook reads the
        // file and removes the types.
        if (/\.[jt]sx$/.test(path)) {
          // Deno made JavaScript from the JSX, with a source map. The
          // counters go into that JavaScript.
          const made = counters.compiled(path, String(result.source))
          return made === undefined ? result : { ...result, source: made }
        }
        const ts = /\.[cm]?ts$/.test(path)
        if (!ts && !/\.[cm]?js$/.test(path)) return result
        const changed = counters.change(path, readFileSync(path, 'utf8'))
        if (!changed) return result
        const js = ts && !changed.js ? stripTypeScriptTypes(changed.source) : changed.source
        // With no map in the text, Deno changes the positions in a
        // stack trace with the map of its own JavaScript.
        return { ...result, source: ts ? js + NO_MAP : js }
      }
      if (!FORMATS.has(result.format as string)) return result
      const changed = counters.change(path, result.source?.toString())
      if (!changed) return result
      // The cache can have the source with no types. Node then does
      // not load its code that removes types.
      const format = result.format === 'commonjs-typescript' ? 'commonjs' : 'module'
      return { ...result, source: changed.source, ...(changed.js && { format }) }
    },
  })
