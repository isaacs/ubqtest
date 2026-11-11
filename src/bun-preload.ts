// Coverage on Bun: `bun --preload ubqtest/bun-preload test/foo.ts`.
// A load plugin adds counters to each project file before Bun
// compiles it. The runner starts each Bun test process this way.
import { readFileSync } from 'node:fs'
import { startCounters } from './counter-collector.ts'
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
if (counters)
  Bun.plugin({
    name: 'ubqtest coverage',
    setup(build) {
      // Bun has no way to pass a file on to its own loader, so the
      // filter must match only project files.
      const escaped = projectRoot().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const filter = new RegExp(`^${escaped}[\\\\/](?!.*node_modules).*\\.[cm]?[jt]s$`)
      build.onLoad({ filter }, ({ path }) => {
        const source = readFileSync(path, 'utf8')
        const changed = counters.wants(path) ? counters.change(path, source) : undefined
        return { contents: changed ?? source, loader: /ts$/.test(path) ? 'ts' : 'js' }
      })
    },
  })
