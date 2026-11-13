// Questions about stored runs. See docs/04-architecture.md, section 5.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Failure, TypeCheckError } from './events.ts'
import { projectRoot } from './project.ts'
import { ENV, fileHash } from './store.ts'

type Span = [start: number, end: number]

/** Sorted spans with no overlap. */
const union = (spans: Span[]): Span[] => {
  const out: Span[] = []
  for (const [s, e] of spans.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** The parts of `a` that are not in `b`. Both must come from `union`. */
const subtract = (a: Span[], b: Span[]): Span[] => {
  const out: Span[] = []
  let j = 0
  for (const [s, e] of a) {
    let pos = s
    while (j < b.length && b[j]![1] <= pos) j++
    for (let k = j; k < b.length && b[k]![0] < e; k++) {
      if (b[k]![0] > pos) out.push([pos, b[k]![0]])
      pos = Math.max(pos, b[k]![1])
    }
    if (pos < e) out.push([pos, e])
  }
  return out
}

/** A source file, with the offset where each line starts. */
class Source {
  text: string
  starts: number[] = [0]
  constructor(file: string) {
    this.text = readFileSync(join(projectRoot(), file), 'utf8')
    for (let i = this.text.indexOf('\n'); i >= 0; i = this.text.indexOf('\n', i + 1))
      this.starts.push(i + 1)
  }
  /** Line and column of an offset. Both start at 1. */
  at(offset: number): { line: number; column: number } {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 }
  }
  /** The span of the text on a line, without the space around it. */
  line(n: number): Span | undefined {
    const start = this.starts[n - 1]
    if (start === undefined) return undefined
    const raw = this.text.slice(start, this.starts[n] ?? this.text.length)
    const text = raw.trim()
    if (!text) return undefined
    const from = start + raw.indexOf(text)
    return [from, from + text.length]
  }
  /** A span with the space around it removed. */
  trim([s, e]: Span): Span {
    while (s < e && /\s/.test(this.text[s]!)) s++
    while (e > s && /\s/.test(this.text[e - 1]!)) e--
    return [s, e]
  }
}

/** The coverage rows of a source file, one for each test that ran code in it. */
const rangesOf = (
  db: DatabaseSync,
  file: string,
): { tfile: string; test: string; ranges: number[] }[] =>
  (
    db
      .prepare(
        // The rows of a different environment count if they are of
        // the file as it is now (D54).
        `select tfile, test, ranges from coverage where file = ?1
         union all select tfile, test, ranges from other_coverage where file = ?1 and hash = ?2
         order by tfile, test`,
      )
      .all(file, fileHash(file)) as { tfile: string; test: string; ranges: string }[]
  ).map(r => ({ ...r, ranges: JSON.parse(r.ranges) as number[] }))

/**
 * The environments whose coverage the store has: that of the last
 * run of each test, and those of `other_coverage`.
 */
export const environments = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(
        `select distinct ${ENV} as env from coverage c join run r on r.id = c.run
         union select distinct env from other_coverage order by 1`,
      )
      .all() as { env: string }[]
  ).map(r => r.env)

/** True if the store has coverage of `file` as it is now, or coverage of the last run of a test. */
export const hasCoverage = (db: DatabaseSync, file: string): boolean => rangesOf(db, file).length > 0

export interface Uncovered {
  file: string
  line: number
  column: number
  /** The first line of the code that did not run. */
  text: string
  /** The whole line of the source where the range starts. */
  sourceLine: string
  /** Lines in the range after the first. */
  moreLines: number
}

/** Files that have coverage rows and are not test files. */
export const coveredFiles = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(
        // A file can run only in a different environment (D54).
        `select distinct file from (select file from coverage union select file from other_coverage)
         where file not in (select tfile from coverage union select tfile from other_coverage) order by file`,
      )
      .all() as { file: string }[]
  )
    .map(r => r.file)
    // The store keeps the coverage of a file that is gone.
    .filter(file => existsSync(join(projectRoot(), file)))

/** The test files of the store. */
export const testFiles = (db: DatabaseSync): string[] =>
  (db.prepare('select tfile from test_file order by tfile').all() as { tfile: string }[]).map(r => r.tfile)

/** True if `file` changed after a test recorded coverage of it. */
export const stale = (db: DatabaseSync, file: string): boolean => {
  const now = fileHash(file)
  return (db.prepare('select distinct hash from coverage where file = ?').all(file) as { hash: string }[]).some(
    r => r.hash !== now,
  )
}

/** The code in `file` that no test ran. */
export const uncovered = (db: DatabaseSync, file: string): Uncovered[] => {
  const hit: Span[] = []
  const miss: Span[] = []
  for (const row of rangesOf(db, file))
    for (let i = 0; i < row.ranges.length; i += 3)
      (row.ranges[i + 2] ? hit : miss).push([row.ranges[i]!, row.ranges[i + 1]!])
  const source = new Source(file)
  const out: Uncovered[] = []
  for (const span of subtract(union(miss), union(hit))) {
    const [s, e] = source.trim(span)
    if (s === e) continue
    const lines = source.text.slice(s, e).split('\n')
    const at = source.at(s)
    const sourceLine = source.text.slice(source.starts[at.line - 1], source.starts[at.line] ?? source.text.length)
    out.push({ file, ...at, text: lines[0]!.trimEnd(), sourceLine, moreLines: lines.length - 1 })
  }
  return out
}

export interface Covers {
  /** IDs of the tests that ran the line. */
  tests: string[]
  /** Test files that ran the line while they loaded. */
  loads: string[]
}

/** The tests that ran line `line` of `file`. */
export const covers = (db: DatabaseSync, file: string, line: number): Covers => {
  const span = new Source(file).line(line)
  if (!span) throw new Error(`${file}:${line} has no code`)
  const rows = rangesOf(db, file).filter(({ ranges }) => {
    for (let i = 0; i < ranges.length; i += 3)
      if (ranges[i + 2] && ranges[i]! < span[1] && ranges[i + 1]! > span[0]) return true
    return false
  })
  return {
    // A test can have a row for each environment.
    tests: [...new Set(rows.flatMap(r => (r.test ? [r.test] : [])))],
    loads: [...new Set(rows.flatMap(r => (r.test ? [] : [r.tfile])))],
  }
}

/**
 * The tests that ran the code at offset `at` of `file`. More exact
 * than a line: a line can have a function that no test called.
 */
export const coversAt = (db: DatabaseSync, file: string, at: number): Covers => {
  const rows = rangesOf(db, file).filter(({ ranges }) => {
    // The segments do not overlap.
    for (let i = 0; i < ranges.length; i += 3)
      if (ranges[i]! <= at && at < ranges[i + 1]!) return ranges[i + 2]! > 0
    return false
  })
  return {
    // A test can have a row for each environment.
    tests: [...new Set(rows.flatMap(r => (r.test ? [r.test] : [])))],
    loads: [...new Set(rows.flatMap(r => (r.test ? [] : [r.tfile])))],
  }
}

/** Test files whose last run did not have full coverage. Not a file that is gone. */
export const incomplete = (db: DatabaseSync): { tfile: string; coverage: string }[] =>
  (
    db
      .prepare("select tfile, coverage from test_file where coverage != 'full' order by tfile")
      .all() as { tfile: string; coverage: string }[]
  ).filter(({ tfile }) => tfile && existsSync(join(projectRoot(), tfile)))

export interface TestRow {
  run: number
  id: string
  file: string
  line: number | null
  status: 'pass' | 'fail' | 'skip'
  ms: number
  asserts: number
  reason: string | null
  failure: Failure | null
  /** For a run with `--repeat`: how often the test ran, and how often it failed. */
  repeats: number | null
  fails: number | null
}

const testRow = (r: Record<string, unknown>): TestRow =>
  ({ ...r, failure: r.failure ? JSON.parse(r.failure as string) : null }) as TestRow

/** The number of the last run, or undefined if the store is empty. */
export const lastRun = (db: DatabaseSync): number | undefined =>
  (db.prepare('select max(id) id from run').get() as { id: number | null }).id ?? undefined

export interface RunRow {
  id: number
  pass: number | null
  fail: number | null
  errors: number | null
  skip: number | null
  unselected: number | null
  code: number | null
}

export const runRow = (db: DatabaseSync, run: number): RunRow | undefined =>
  db.prepare('select id, pass, fail, errors, skip, unselected, code from run where id = ?').get(run) as
    | RunRow
    | undefined

/** The failed tests of a run. */
export const failures = (db: DatabaseSync, run: number): TestRow[] =>
  db
    .prepare("select * from test where run = ? and status = 'fail' order by id")
    .all(run)
    .map(testRow)

export const fileErrors = (db: DatabaseSync, run: number): { file: string; failure: Failure }[] =>
  (
    db.prepare('select file, failure from file_error where run = ?').all(run) as {
      file: string
      failure: string
    }[]
  ).map(r => ({ file: r.file, failure: JSON.parse(r.failure) }))

/** The type errors of a run. */
export const typeErrors = (db: DatabaseSync, run: number): TypeCheckError[] =>
  (db.prepare('select error from type_error where run = ? order by rowid').all(run) as { error: string }[]).map(
    r => JSON.parse(r.error) as TypeCheckError,
  )

/** The last stored result of a test. */
export const lastResult = (db: DatabaseSync, id: string): TestRow | undefined => {
  const row = db.prepare('select * from test where id = ? order by run desc limit 1').get(id)
  return row && testRow(row)
}

/** The console output of a test in a run. */
export const outputOf = (db: DatabaseSync, run: number, id: string): string =>
  (
    db
      .prepare('select text from output where test = ? and run = ? order by rowid')
      .all(id, run) as { text: string }[]
  )
    .map(r => r.text)
    .join('')

/** The files that a test ran code in. */
export const filesOf = (db: DatabaseSync, id: string): string[] =>
  (
    db
      .prepare('select distinct file from coverage where test = ? order by file')
      .all(id) as { file: string }[]
  ).map(r => r.file)

export interface HistoryRow {
  run: number
  /** Start of the run, in milliseconds since 1970. */
  time: number
  status: TestRow['status']
  ms: number
  failure: Failure | null
  /** Runtime and code digest. Null if the code of the run is not known. */
  code: string | null
  /** For a run with `--repeat`: how often the test ran, and how often it failed. */
  repeats: number | null
  fails: number | null
  /** The git commit of the run. */
  commit: string | null
}

/** The results of a test in each stored run, oldest first. */
export const history = (db: DatabaseSync, id: string): HistoryRow[] =>
  (
    db
      .prepare(
        "select t.run, r.time, t.status, t.ms, t.failure, r.runtime || ' ' || t.code code, t.repeats, t.fails, r.commit_hash [commit] from test t join run r on r.id = t.run where t.id = ? order by t.run",
      )
      .all(id) as Record<string, unknown>[]
  ).map(r => ({ ...r, failure: r.failure ? JSON.parse(r.failure as string) : null }) as HistoryRow)

export type Flake =
  | { pass: number; fail: number }
  | { run: number; repeats: number; fails: number }

/**
 * The newest evidence that a test is flaky: a run with `--repeat` in
 * which the test failed some times, or two runs in which the test
 * ran the same code on the same runtime, and passed in one and
 * failed in the other.
 */
export const flake = (rows: HistoryRow[]): Flake | undefined => {
  const last = new Map<string, { pass?: number; fail?: number }>()
  let found: Flake | undefined
  for (const r of rows) {
    if (r.repeats && r.fails && r.fails < r.repeats)
      found = { run: r.run, repeats: r.repeats, fails: r.fails }
    if (r.code === null || r.status === 'skip') continue
    const seen = last.get(r.code) ?? {}
    last.set(r.code, seen)
    seen[r.status] = r.run
    if (seen.pass !== undefined && seen.fail !== undefined && !(found && 'run' in found && found.run === r.run))
      found = { pass: seen.pass, fail: seen.fail }
  }
  return found
}

/** IDs of stored tests in the group or file `id`. */
export const testsUnder = (db: DatabaseSync, id: string): string[] =>
  (
    db
      .prepare('select distinct id from test where substr(id, 1, ?) = ? order by id')
      .all(id.length + 3, id + ' > ') as { id: string }[]
  ).map(r => r.id)

export interface Change {
  id: string
  /** Undefined if the test did not run in that run. */
  from: TestRow['status'] | undefined
  to: TestRow['status'] | undefined
  /** The failure in run `b`. */
  failure: Failure | null
}

export interface RunDiff {
  /** Tests with a different status, and tests that fail in `b` and did not run in `a`. */
  changes: Change[]
  same: number
  onlyA: number
  onlyB: number
  /** Files with a file error in `b` and not in `a`. */
  newErrors: string[]
  /** Files with a file error in `a` and not in `b`. */
  goneErrors: string[]
}

/** What changed from run `a` to run `b`. */
export const diffRuns = (db: DatabaseSync, a: number, b: number): RunDiff => {
  const of = (run: number) =>
    new Map(
      (
        db.prepare('select id, status, failure from test where run = ?').all(run) as {
          id: string
          status: TestRow['status']
          failure: string | null
        }[]
      ).map(r => [r.id, r]),
    )
  const [ta, tb] = [of(a), of(b)]
  const diff: RunDiff = { changes: [], same: 0, onlyA: 0, onlyB: 0, newErrors: [], goneErrors: [] }
  for (const [id, to] of tb) {
    const from = ta.get(id)
    if (from?.status === to.status) diff.same++
    else {
      if (!from) diff.onlyB++
      if (from || to.status === 'fail')
        diff.changes.push({
          id,
          from: from?.status,
          to: to.status,
          failure: to.failure ? JSON.parse(to.failure) : null,
        })
    }
  }
  for (const id of ta.keys()) if (!tb.has(id)) diff.onlyA++
  // New failures first, then fixed tests, then the rest.
  const rank = (c: Change): number => (c.to === 'fail' ? 0 : c.from === 'fail' ? 1 : 2)
  diff.changes.sort((x, y) => rank(x) - rank(y) || (x.id < y.id ? -1 : 1))
  const errors = (run: number) => new Set(fileErrors(db, run).map(e => e.file))
  const [ea, eb] = [errors(a), errors(b)]
  diff.newErrors = [...eb].filter(f => !ea.has(f)).sort()
  diff.goneErrors = [...ea].filter(f => !eb.has(f)).sort()
  return diff
}

/** The tests of a run that are not skipped, slowest first. */
export const slowest = (db: DatabaseSync, run: number): { id: string; ms: number }[] =>
  db
    .prepare("select id, ms from test where run = ? and status != 'skip' order by ms desc, id")
    .all(run) as { id: string; ms: number }[]
