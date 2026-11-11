// Questions about stored runs. See docs/04-architecture.md, section 5.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Failure } from './events.ts'
import { projectRoot } from './project.ts'

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
      .prepare('select tfile, test, ranges from coverage where file = ? order by tfile, test')
      .all(file) as { tfile: string; test: string; ranges: string }[]
  ).map(r => ({ ...r, ranges: JSON.parse(r.ranges) as number[] }))

export interface Uncovered {
  file: string
  line: number
  column: number
  /** The first line of the code that did not run. */
  text: string
  /** Lines in the range after the first. */
  moreLines: number
}

/** Files that have coverage rows and are not test files. */
export const coveredFiles = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(
        'select distinct file from coverage where file not in (select tfile from coverage) order by file',
      )
      .all() as { file: string }[]
  ).map(r => r.file)

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
    out.push({ file, ...source.at(s), text: lines[0]!.trimEnd(), moreLines: lines.length - 1 })
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
    tests: rows.flatMap(r => (r.test ? [r.test] : [])),
    loads: rows.flatMap(r => (r.test ? [] : [r.tfile])),
  }
}

/** Test files whose last run did not have full coverage. */
export const incomplete = (db: DatabaseSync): { tfile: string; coverage: string }[] =>
  db
    .prepare("select tfile, coverage from test_file where coverage != 'full' order by tfile")
    .all() as { tfile: string; coverage: string }[]

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

/** The last stored result of a test. */
export const lastResult = (db: DatabaseSync, id: string): TestRow | undefined => {
  const row = db.prepare('select * from test where id = ? order by run desc limit 1').get(id)
  return row && testRow(row)
}

/** The files that a test ran code in. */
export const filesOf = (db: DatabaseSync, id: string): string[] =>
  (
    db
      .prepare('select distinct file from coverage where test = ? order by file')
      .all(id) as { file: string }[]
  ).map(r => r.file)
