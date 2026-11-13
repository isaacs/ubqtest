// The test process reads the coverage that its child processes
// wrote (D53), and gives it as coverage of the test that runs.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hash } from 'node:crypto'
import { flatten, mergeRanges, sourceCoverage } from './coverage.ts'
import { type Region, snapshot } from './counters.ts'
import type { Coverage } from './events.ts'
import type { SourceRegions } from './source-map.ts'

/** The key of the folder that the children of this test process write to. */
export const CHILDREN = Symbol.for('ubqtest.children')
export interface Children {
  dir: string
  root: string
}

/** What one child process wrote: its total counts for each file, from its start. */
export interface ChildCounts {
  files: Record<string, { cache: string; counts: number[] }>
}

/** The counts that each file of a child had at the last read. */
const last = new Map<string, Map<string, number[]>>()
const regions = new Map<string, { regions: Region[]; sources?: SourceRegions[] } | undefined>()
/** Files that had their first snapshot from a child. */
const seen = new Set<string>()

/**
 * The code that the child processes ran since the last call. A
 * child writes its counts when it ends, and on a timer. The counts
 * that arrive after a test ended go to the next call.
 */
export const readChildren = (): Coverage['files'] => {
  const mine = (globalThis as { [CHILDREN]?: Children })[CHILDREN]
  if (!mine) return []
  let names: string[]
  try {
    names = readdirSync(mine.dir)
  } catch {
    // No child wrote a file.
    return []
  }
  const out = new Map<string, number[]>()
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    let data: ChildCounts
    try {
      data = JSON.parse(readFileSync(join(mine.dir, name), 'utf8')) as ChildCounts
    } catch {
      continue
    }
    const before = last.get(name) ?? new Map<string, number[]>()
    last.set(name, before)
    for (const [file, { cache, counts }] of Object.entries(data.files)) {
      const old = before.get(file)
      before.set(file, counts)
      const more = old?.length === counts.length ? counts.map((n, i) => Math.max(0, n - old[i]!)) : counts
      if (!more.some(Boolean)) continue
      if (!regions.has(cache)) {
        try {
          // The child made this cache entry when it loaded the file.
          const entry = JSON.parse(readFileSync(join(mine.root, '.ubq', 'counters', cache), 'utf8')) as { regions: Region[]; sources?: SourceRegions[] }
          // For a built file: the sources that have the content that its map is of.
          const sources = entry.sources?.filter(source => {
            try {
              return hash('sha1', readFileSync(join(mine.root, source.file))) === source.hash
            } catch {
              return false
            }
          })
          regions.set(cache, { regions: entry.regions, ...(sources?.length && { sources }) })
        } catch {
          regions.set(cache, undefined)
        }
      }
      const known = regions.get(cache)
      if (known?.regions.length !== counts.length) continue
      const found =
        known.sources ? sourceCoverage(known.sources, more, seen)
        : [{ file, ranges: flatten([{ ranges: snapshot(known.regions, Uint32Array.from(more), !seen.has(file)) }]) }]
      if (!known.sources) seen.add(file)
      for (const { file: name, ranges } of found) {
        const same = out.get(name)
        out.set(name, same ? mergeRanges(same, ranges) : ranges)
      }
    }
  }
  return [...out].map(([file, ranges]) => ({ file, ranges }))
}
