// The load hook that adds source counters to project files, for a
// test process (`counters-preload.ts`) and for a process below one
// (`child-coverage.ts`).
import { readFileSync } from 'node:fs'
// Not a named import: Bun does not have the function that removes types.
import * as nodeModule from 'node:module'
import { fileURLToPath } from 'node:url'

/** What a collector gives to the hook. */
export interface Counting {
  /** True for a file of the project that can have counters. */
  wants(path: string): boolean
  /** The source with counters, or undefined if the file runs as it is. */
  change(path: string, source: string | undefined): { source: string; js: boolean } | undefined
  /** The same for JavaScript that the runtime made from a JSX file, with a source map. */
  compiled?(path: string, made: string): string | undefined
}

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

interface Loaded {
  format?: string | null
  source?: unknown
}

/**
 * The result of the load of `url` with counters, if `find` gives a
 * collector for the path. `result` is what the runtime loaded.
 */
export const withCounters = <T extends Loaded>(url: string, result: T, find: (path: string) => Counting | undefined): T => {
  if (!url.startsWith('file:')) return result
  // With a load hook, Deno 2.9 gives no format for a JSON file
  // that `require` loads, and then reads the file as JavaScript.
  // ubq: not measured: this module loads before the counters start
  if (deno && !result.format && /\.json$/.test(url)) return { ...result, format: 'json' }
  // A mocked module instance has a query on its URL.
  const path = fileURLToPath(url.replace(/\?.*$/, ''))
  const counters = find(path)
  if (!counters) return result
  if (deno) {
    // Deno gives the JavaScript that it made from TypeScript, with
    // different positions, and it gives no format. The counters
    // need the positions of the source, so this hook reads the
    // file and removes the types.
    // ubq: not measured: this module loads before the counters start
    if (/\.[jt]sx$/.test(path)) {
      // Deno made JavaScript from the JSX, with a source map. The
      // counters go into that JavaScript.
      const made = counters.compiled?.(path, String(result.source))
      return made === undefined ? result : { ...result, source: made }
    }
    const ts = /\.[cm]?ts$/.test(path)
    // ubq: not measured: this module loads before the counters start
    if (!ts && !/\.[cm]?js$/.test(path)) return result
    const changed = counters.change(path, readFileSync(path, 'utf8'))
    // ubq: not measured: this module loads before the counters start
    if (!changed) return result
    // ubq: not measured: this module loads before the counters start
    const js = ts && !changed.js ? nodeModule.stripTypeScriptTypes(changed.source) : changed.source
    // With no map in the text, Deno changes the positions in a
    // stack trace with the map of its own JavaScript.
    // ubq: not measured: this module loads before the counters start
    return { ...result, source: ts ? js + NO_MAP : js }
  }
  // ubq: not measured: this module loads before the counters start
  if (!FORMATS.has(result.format as string)) return result
  const changed = counters.change(path, (result.source as { toString(): string } | undefined)?.toString())
  if (!changed) return result
  // The cache can have the source with no types. Node then does
  // not load its code that removes types.
  // ubq: not measured: this module loads before the counters start
  const format = result.format === 'commonjs-typescript' ? 'commonjs' : 'module'
  return { ...result, source: changed.source, ...(changed.js && { format }) }
}
