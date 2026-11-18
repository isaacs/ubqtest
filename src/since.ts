// What changed since a failed test last passed (D69): the lines that
// the test ran in its last pass, and that are different now. The
// store has the coverage of that run, and the content of each file
// as it was then (`.ubq/sources/<hash>`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Failure, Since, UbqEvent } from './events.ts'
import { projectRoot } from './project.ts'
import { fileHash, replacedLoads, storedSource } from './store.ts'

/** Lines `[from, to)` of the old text became lines `[newFrom, newTo)` of the new text. From 0. */
type Hunk = [from: number, to: number, newFrom: number, newTo: number]

/** The most cells of the table of a line diff. A larger change is one hunk. */
const CELLS = 4_000_000

/** The groups of lines that differ in two texts. */
export const lineDiff = (a: string[], b: string[]): Hunk[] => {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const n = a.length - start - end
  const m = b.length - start - end
  if (!n && !m) return []
  if (!n || !m || n * m > CELLS) return [[start, start + n, start, start + m]]
  // The longest common sequence of the lines between, from the end.
  const len = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      len[at(i, j)] =
        a[start + i] === b[start + j] ? len[at(i + 1, j + 1)]! + 1 : Math.max(len[at(i + 1, j)]!, len[at(i, j + 1)]!)
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let open: Hunk | undefined
  const close = (): void => {
    if (open) hunks.push([open[0], start + i, open[2], start + j])
    open = undefined
  }
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      close()
      i++
      j++
      continue
    }
    open ??= [start + i, 0, start + j, 0]
    if (j < m && (i === n || len[at(i, j + 1)]! >= len[at(i + 1, j)]!)) j++
    else i++
  }
  close()
  return hunks
}

/** The offset where each line starts, and the end of the text. */
const starts = (text: string): number[] => {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  out.push(text.length + 1)
  return out
}

const lines = (text: string): string[] => text.split('\n')

/**
 * The lines of `file` that a test ran (`ranges`, of the content with
 * `hash`), and that are different now, as `file:12` or `file:12-14`.
 */
const changedPlaces = (file: string, hash: string, ranges: number[]): string[] => {
  if (!fileHash(file)) return [`${file} (removed)`]
  const old = storedSource(hash)
  // ubq: not measured: the store keeps the content of each file with coverage
  if (old === undefined) return [`${file} (changed)`]
  const now = readFileSync(join(projectRoot(), file), 'utf8')
  const at = starts(old)
  /** True if the test ran code on old lines `[from, to)`. */
  const ran = (from: number, to: number): boolean => {
    const s = at[Math.max(from, 0)]!
    const e = at[Math.min(to, at.length - 1)]! - 1
    for (let i = 0; i < ranges.length; i += 3)
      if (ranges[i + 2]! > 0 && ranges[i]! < e && ranges[i + 1]! > s) return true
    return false
  }
  const out: string[] = []
  for (const [from, to, newFrom, newTo] of lineDiff(lines(old), lines(now))) {
    // New lines with none removed: the lines around them count.
    if (from === to ? !ran(from - 1, from + 1) : !ran(from, to)) continue
    out.push(
      newTo === newFrom
        ? `${file}:${newFrom + 1} (lines removed)`
        : `${file}:${newFrom + 1}${newTo - newFrom > 1 ? `-${newTo}` : ''}`,
    )
  }
  return out
}

/**
 * For a test that fails: the last run where it passed, and the lines
 * that it ran then and that changed after it. Undefined if the store
 * has no pass before a failure. A test that failed in its last run
 * keeps what that failure had.
 */
export const since = (db: DatabaseSync, run: number, id: string): Since | undefined => {
  const last = db
    .prepare('select run, status, failure from test where id = ? and run < ? order by run desc limit 1')
    .get(id, run) as { run: number; status: string; failure: string | null } | undefined
  if (!last) return undefined
  // A failure always has its text.
  if (last.status === 'fail') return (JSON.parse(last.failure!) as Failure).since
  if (last.status !== 'pass') return undefined
  // The coverage of the test is of its last run, until this run writes its own.
  type Row = { file: string; hash: string; ranges: string }
  const places = (rows: Row[]): string[] =>
    rows.flatMap(r =>
      fileHash(r.file) === r.hash ? [] : changedPlaces(r.file, r.hash, JSON.parse(r.ranges) as number[]),
    )
  const rows = db.prepare('select file, hash, ranges from coverage where test = ? order by file').all(id) as Row[]
  if (!rows.length) return undefined
  const changed = places(rows)
  if (changed.length) return { run: last.run, changed }
  // The code that ran while its test file loaded: a constant of a
  // module is such code, and the test reads its value.
  // The store writes events in groups: it can have the start of
  // the file of this run, which removes the load rows, or not yet.
  const tfile = (db.prepare('select tfile from coverage where test = ? limit 1').get(id) as { tfile: string }).tfile
  const loaded = places([
    ...(replacedLoads.get(tfile) ?? []),
    ...(db
      .prepare("select file, hash, ranges from coverage where test = '' and tfile = ? and run < ? order by file")
      .all(tfile, run) as Row[]),
  ])
  return { run: last.run, changed, ...(loaded.length && { loaded }) }
}

/**
 * A `test-end` of a failure, with what changed after the last pass
 * of the test. Each other event, as it is. The runner calls this
 * before its sinks: the store then still has the coverage of the
 * last run of the test.
 */
export const withSince = (db: DatabaseSync, run: number, event: UbqEvent): UbqEvent => {
  if (event.type !== 'test-end' || !event.failure) return event
  try {
    const s = since(db, run, event.id)
    return s ? { ...event, failure: { ...event.failure, since: s } } : event
    // ubq: not measured: the store can be read in each test
  } catch {
    // The failure is the same without this line.
    return event
  }
}
