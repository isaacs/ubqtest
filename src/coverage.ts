// The V8 coverage collector. See docs/04-architecture.md, section 4.
import { Session } from 'node:inspector'
import { createRequire } from 'node:module'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import type { Coverage, FileStart } from './events.ts'
import { projectRoot, rel } from './project.ts'

/** Takes a snapshot of the code that ran since the last snapshot. */
export interface Collector {
  mode: FileStart['coverage']
  take(): Promise<Coverage['files']>
}

interface V8Range {
  startOffset: number
  endOffset: number
  count: number
}
interface V8Script {
  url: string
  functions: { ranges: V8Range[] }[]
}

/**
 * V8 ranges nest: a function contains its blocks and its inner
 * functions. This makes segments that do not overlap, each with the
 * count of the innermost range. The result is flat triples: start,
 * end, count.
 */
export const flatten = (functions: V8Script['functions']): number[] => {
  const ranges = functions.flatMap(f => f.ranges)
  ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset)
  const out: number[] = []
  const add = (start: number, end: number, count: number): void => {
    if (end <= start) return
    const n = out.length
    if (n && out[n - 2] === start && out[n - 1] === count) out[n - 2] = end
    else out.push(start, end, count)
  }
  const open: V8Range[] = []
  let pos = 0
  const close = (until: number): void => {
    for (let top = open.at(-1); top && top.endOffset <= until; top = open.at(-1)) {
      add(pos, top.endOffset, top.count)
      pos = Math.max(pos, top.endOffset)
      open.pop()
    }
  }
  for (const range of ranges) {
    close(range.startOffset)
    const top = open.at(-1)
    if (top) add(pos, range.startOffset, top.count)
    pos = range.startOffset
    open.push(range)
  }
  close(Infinity)
  return out
}

/**
 * Two lists of flat triples for the same file, as one list. Where
 * both have a count, the result has the sum.
 */
export const mergeRanges = (a: number[], b: number[]): number[] => {
  const at = (ranges: number[], pos: number): number | undefined => {
    for (let i = 0; i < ranges.length; i += 3) if (ranges[i]! <= pos && pos < ranges[i + 1]!) return ranges[i + 2]
    return undefined
  }
  const cuts = [...new Set([...a, ...b].filter((_, i) => i % 3 !== 2))].sort((x, y) => x - y)
  const out: number[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const x = at(a, cuts[i]!)
    const y = at(b, cuts[i]!)
    if (x === undefined && y === undefined) continue
    const count = (x ?? 0) + (y ?? 0)
    const n = out.length
    if (n && out[n - 2] === cuts[i] && out[n - 1] === count) out[n - 2] = cuts[i + 1]!
    else out.push(cuts[i]!, cuts[i + 1]!, count)
  }
  return out
}

// Only a Bun process with the option loads this code. The source
// is `.ts`, and the bundle is `.js`.
const BUN_INSPECTOR = import.meta.url.endsWith('.ts') ? './bun-coverage.ts' : './bun-coverage.js'

// The preload module and the library can be two copies of this
// code. They share the collector through this key.
const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector }

/**
 * Starts V8 precise coverage, or returns the collector that the
 * preload module started. Returns undefined on Deno, and on Bun
 * with no `bunInspectorCoverage`: they get coverage from source
 * counters only.
 *
 * `early` is true if no user module loaded yet. V8 lists a function
 * that never ran only if coverage started before the function's
 * module compiled.
 */
export const startCoverage = (early = false): Collector | undefined => {
  if (shared[KEY]) return shared[KEY]
  // Deno has the inspector, but the positions are those of the
  // JavaScript that Deno makes from TypeScript, not of the source.
  if (process.versions.deno) return undefined
  // A Bun process with no counters is a plain program. A project can
  // turn on inspector coverage for it (D39).
  if (process.versions.bun)
    return config().bunInspectorCoverage ?
        (shared[KEY] = (createRequire(import.meta.url)(BUN_INSPECTOR) as typeof import('./bun-coverage.ts'))
          .startBunInspector())
      : undefined
  const session = new Session()
  session.connect()
  // On Node, `post` runs the command before it returns, so these
  // take effect before the next module of the program runs.
  session.post('Profiler.enable')
  // The one mode that gives correct data for each test.
  // See docs/03-measurements.md, section 2.1.
  session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  const root = projectRoot() + sep
  const modules = `${sep}node_modules${sep}`
  const take = (): Promise<V8Script[]> =>
    new Promise((resolve, reject) =>
      session.post('Profiler.takePreciseCoverage', (error, result) =>
        error ? reject(error) : resolve(result.result),
      ),
    )
  return (shared[KEY] = {
    mode: early ? 'full' : 'partial',
    async take() {
      const files: Coverage['files'] = []
      for (const script of await take()) {
        if (!script.url.startsWith('file:')) continue
        // A mocked module instance has a query on its URL.
        const path = fileURLToPath(script.url.replace(/\?.*$/, ''))
        if (!path.startsWith(root) || path.includes(modules))
          continue
        const ranges = flatten(script.functions)
        if (ranges.length) files.push({ file: rel(path), ranges })
      }
      return files
    },
  })
}
