// The data of source counters: the regions that the counters stand
// for, and snapshots of the counts. Separate from the instrumenter,
// so that a process can read counters and not load the parser.

/** The name of the counter array in the code of a file with counters. */
export const COUNTER_NAME = '__ubqc'

/** The key of the global Map from file path to counter array. */
export const COUNTERS = 'ubqtest.counters'

/**
 * The key of the global function that reads a project file and
 * adds its counters. `mockImport` on Bun loads its module instances
 * through it.
 */
export const SOURCE = 'ubqtest.source'

/**
 * For `ubq mutate`: the source of a file with the change of the
 * mutation check, if the runner gave this process one for the file
 * (`UBQ_MUTANT`: path, start, end, new text). If not, undefined.
 */
export const mutated = (path: string, source: string): string | undefined => {
  mutant ??= JSON.parse(process.env.UBQ_MUTANT || '[]') as typeof mutant & {}
  const [file, start, end, text] = mutant
  return file === path ? source.slice(0, start) + text + source.slice(end) : undefined
}
let mutant: [file?: string, start?: number, end?: number, text?: string] | undefined

/** The part of the source that one counter stands for. */
export interface Region {
  start: number
  end: number
  /** True for a function or the module. False for a branch. */
  fn: boolean
  /** Index of the nearest function region around this one. -1 for the module. */
  parent: number
}

/**
 * The regions of a file as V8-style ranges for `flatten`, with the
 * counts since the last call. Sets the counters to zero.
 *
 * `all` is true for the first snapshot of a file: it lists each
 * region, so that code that never runs is known. A later snapshot
 * lists only functions that ran, with their branches and with the
 * functions directly in them.
 */
export const snapshot = (
  regions: Region[],
  counts: Uint32Array,
  all: boolean,
): { startOffset: number; endOffset: number; count: number }[] => {
  const out: { startOffset: number; endOffset: number; count: number }[] = []
  regions.forEach((r, i) => {
    const ran = r.fn && counts[i]! > 0
    const parentRan = r.parent >= 0 && counts[r.parent]! > 0
    if (all || ran || parentRan)
      out.push({ startOffset: r.start, endOffset: r.end, count: counts[i]! })
  })
  counts.fill(0)
  return out
}

/** The key of the global function that maps a column of changed source to the source. */
export const COLUMN = 'ubqtest.column'

/**
 * The column in the source (from 1) of a column in the changed
 * source. `shifts` is the list for the line, from `Instrumented`.
 */
export const originalColumn = (shifts: number[] | undefined, column: number): number => {
  if (!shifts) return column
  const at = column - 1
  let added = 0
  for (let i = 0; i < shifts.length; i += 2) {
    const start = shifts[i]! + added
    if (at < start) break
    // In the added text: the place in the source where it was added.
    if (at < start + shifts[i + 1]!) return shifts[i]! + 1
    added += shifts[i + 1]!
  }
  return column - added
}

