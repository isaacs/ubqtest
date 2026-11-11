// Coverage on Bun: `bun --preload ubqtest/bun-preload test/foo.ts`.
// A load plugin adds counters to each project file before Bun
// compiles it. The runner starts each Bun test process this way.
import { readFileSync } from 'node:fs'
import { sep } from 'node:path'
import { type Collector, flatten } from './coverage.ts'
import type { Coverage } from './events.ts'
import { COUNTERS, type Region, snapshot } from './counters.ts'
import { instrument } from './instrument.ts'
import { projectRoot, rel } from './project.ts'

// The part of the Bun plugin API that this file uses.
declare const Bun: {
  plugin(options: {
    name: string
    setup(build: {
      onLoad(
        options: { filter: RegExp },
        callback: (args: { path: string }) => { contents: string; loader: string },
      ): void
    }): void
  }): void
}

const KEY = Symbol.for('ubqtest.collector')
const shared = globalThis as { [KEY]?: Collector; [key: symbol]: unknown }

if (!shared[KEY]) {
  const counters = new Map<string, Uint32Array>()
  const regions = new Map<string, Region[]>()
  /** Files that had their first snapshot. */
  const seen = new Set<string>()
  /** Count of project files that the parser could not read. */
  let unread = 0
  shared[Symbol.for(COUNTERS)] = counters

  const root = projectRoot() + sep
  const own = import.meta.dirname + sep

  Bun.plugin({
    name: 'ubqtest coverage',
    setup(build) {
      // Bun has no way to pass a file on to its own loader, so the
      // filter must match only project files.
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const filter = new RegExp(`^${escaped}(?!.*node_modules).*\\.[cm]?[jt]s$`)
      build.onLoad({ filter }, ({ path }) => {
        const source = readFileSync(path, 'utf8')
        const loader = /ts$/.test(path) ? 'ts' : 'js'
        const file = rel(path)
        const result = path.startsWith(own) ? undefined : instrument(source, file)
        // A file that the parser cannot read runs with no counters.
        if (!result) {
          if (!path.startsWith(own)) unread++
          return { contents: source, loader }
        }
        counters.set(file, new Uint32Array(result.regions.length))
        regions.set(file, result.regions)
        return { contents: result.code, loader }
      })
    },
  })

  shared[KEY] = {
    // Coverage is not complete if a file has no counters.
    get mode() {
      return unread ? ('partial' as const) : ('full' as const)
    },
    async take() {
      const files: Coverage['files'] = []
      for (const [file, counts] of counters) {
        if (!counts.some(Boolean)) continue
        const all = !seen.has(file)
        seen.add(file)
        const ranges = flatten([{ ranges: snapshot(regions.get(file)!, counts, all) }])
        if (ranges.length) files.push({ file, ranges })
      }
      return files
    },
  }
}
