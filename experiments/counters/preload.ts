// Experiment: source counters on Node, in place of V8 snapshots.
//   node --import ./preload.ts <test file>
// COUNTERS_CACHE=0 turns the disk cache off.
import { hash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flatten } from '../../src/coverage.ts'
import { COUNTERS, type Region, snapshot } from '../../src/counters.ts'
import type { Instrumented } from '../../src/instrument.ts'
import { projectRoot, rel } from '../../src/project.ts'

const counters = new Map<string, Uint32Array>()
const regions = new Map<string, Region[]>()
const seen = new Set<string>()
;(globalThis as any)[Symbol.for(COUNTERS)] = counters

const root = projectRoot() + sep
const repo = fileURLToPath(new URL('../..', import.meta.url))
const skip = [join(repo, 'src') + sep, join(repo, 'dist') + sep, import.meta.dirname + sep]
const useCache = process.env.COUNTERS_CACHE !== '0'
const cacheDir = join(root, '.ubq', 'counters')
if (useCache) mkdirSync(cacheDir, { recursive: true })

// The parser is 400 KB. Load it only on a cache miss.
let instrument: typeof import('../../src/instrument.ts').instrument | undefined
const { createRequire } = await import('node:module')
const load = (source: string, file: string): Instrumented | undefined => {
  const key = join(cacheDir, hash('sha1', file + '\0' + source) + '.json')
  if (useCache) {
    try {
      return JSON.parse(readFileSync(key, 'utf8'))
    } catch {}
  }
  instrument ??= createRequire(import.meta.url)('../../src/instrument.ts').instrument
  const result = instrument!(source, file)
  if (result && useCache) writeFileSync(key, JSON.stringify(result))
  return result
}

registerHooks({
  load(url, context, next) {
    const r = next(url, context)
    if (!url.startsWith('file:') || !r.source) return r
    const path = fileURLToPath(url.replace(/\?.*$/, ''))
    if (!path.startsWith(root) || path.includes(`${sep}node_modules${sep}`) || skip.some(s => path.startsWith(s)))
      return r
    const file = rel(path)
    const result = load(r.source.toString(), file)
    if (!result) return r
    counters.set(file, new Uint32Array(result.regions.length))
    regions.set(file, result.regions)
    return { ...r, source: result.code }
  },
})

;(globalThis as any)[Symbol.for('ubqtest.collector')] = {
  mode: 'full',
  async take() {
    const files = []
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
