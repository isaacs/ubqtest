// Coverage on Bun: `bun --preload ubqtest/bun-preload test/foo.ts`.
// A load plugin adds counters to each project file before Bun
// compiles it. The runner starts each Bun test process this way.
import { readFileSync } from 'node:fs'
import { announce } from './child-coverage.ts'
import { startCounters } from './counter-collector.ts'
import { SOURCE } from './counters.ts'
import { projectRoot } from './project.ts'

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

const counters = startCounters()
if (counters) {
  // The processes that the tests start count too (D53).
  announce()
  const read = (path: string): string => {
    const source = readFileSync(path, 'utf8')
    return (counters.wants(path) ? counters.change(path, source)?.source : undefined) ?? source
  }
  ;(globalThis as Record<symbol, unknown>)[Symbol.for(SOURCE)] = read
  Bun.plugin({
    name: 'ubqtest coverage',
    setup(build) {
      // Bun has no way to pass a file on to its own loader, so the
      // filter must match only project files.
      const escaped = projectRoot().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const filter = new RegExp(`^${escaped}[\\\\/](?!.*node_modules).*\\.([cm]?[jt]s|[jt]sx)$`)
      build.onLoad({ filter }, ({ path }) => ({
        contents: read(path),
        // Bun reads JSX in a `.js` file.
        loader: /[jt]sx$/.exec(path)?.[0] ?? (/ts$/.test(path) ? 'ts' : path.endsWith('.js') ? 'jsx' : 'js'),
      }))
    },
  })
}
