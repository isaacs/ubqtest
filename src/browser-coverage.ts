// The coverage that Chromium records for a page, as coverage of the
// files of the project (D47).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { flatten, mergeRanges } from './coverage.ts'
import type { Coverage } from './events.ts'
import { projectRoot, rel } from './project.ts'
import { inlineMap, sourceRegions } from './source-map.ts'

interface Range {
  startOffset: number
  endOffset: number
  count: number
}
/** One script of a page, from `page.coverage.stopJSCoverage()` of Playwright. */
export interface Script {
  url: string
  source?: string
  functions: { ranges: Range[] }[]
}

/**
 * The coverage of the project files that a page loaded from `base`.
 *
 * The file of a script is the file at the path of its URL, from the
 * project root. If the text of the script is the text of the file,
 * the positions are the same. If a server made the script from the
 * file, the script must end with a source map that has one source.
 * A script with no such file, or a bundle of many files, gives no
 * coverage.
 */
export const pageCoverage = (scripts: Script[], base: string): Coverage['files'] => {
  const root = projectRoot()
  const files: Coverage['files'] = []
  for (const script of scripts) {
    if (!script.url.startsWith(base)) continue
    const path = join(root, decodeURIComponent(new URL(script.url).pathname))
    if (!path.startsWith(root + sep) || path.includes(`${sep}node_modules${sep}`)) continue
    if (!existsSync(path) || !statSync(path).isFile()) continue
    const source = readFileSync(path, 'utf8')
    let functions = script.functions
    if (script.source !== undefined && script.source !== source) {
      if (inlineMap(script.source)?.sources?.length !== 1) continue
      // The widest range is first: it is the script, and it becomes
      // the file.
      // ubq: not measured: test files have no two ranges with one start
      const made = functions.flatMap(f => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset)
      const regions = sourceRegions(
        made.map(r => ({ start: r.startOffset, end: r.endOffset, fn: true, parent: -1 })),
        script.source,
        source,
      )
      if (!regions) continue
      functions = [{ ranges: regions.map((r, i) => ({ startOffset: r.start, endOffset: r.end, count: made[i]!.count })) }]
    }
    const ranges = flatten(functions)
    if (!ranges.length) continue
    const file = rel(path)
    // A page can load a file two times.
    const same = files.find(f => f.file === file)
    if (same) same.ranges = mergeRanges(same.ranges, ranges)
    else files.push({ file, ranges })
  }
  return files
}
