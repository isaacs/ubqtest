// Coverage on Node through source counters, in place of V8
// snapshots: `node --import ubqtest/counters-preload test/foo.ts`.
// A load hook adds counters to each project file.
// See docs/03-measurements.md, section 12.
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { startCounters } from './counter-collector.ts'

const FORMATS = new Set(['module', 'commonjs', 'module-typescript', 'commonjs-typescript'])

const counters = startCounters()
if (counters)
  registerHooks({
    load(url, context, next) {
      const result = next(url, context)
      if (!url.startsWith('file:') || !FORMATS.has(result.format as string)) return result
      // A mocked module instance has a query on its URL.
      const path = fileURLToPath(url.replace(/\?.*$/, ''))
      if (!counters.wants(path)) return result
      const source = counters.change(path, result.source?.toString())
      return source === undefined ? result : { ...result, source }
    },
  })
