// The run store: one SQLite file at `.ubq/runs.db` in the project.
// See docs/04-architecture.md, section 5.
import { hash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Failure, RunStart, Sink, TestId, UbqEvent } from './events.ts'
import { projectRoot } from './project.ts'

const SCHEMA_VERSION = 4
const KEEP_RUNS = 50
const COMMIT_MS = 50

// `coverage` holds the last coverage of each test, not one copy for
// each run. `tfile` is the test file. A row with an empty `test` is
// code that ran while `tfile` loaded. `ranges` is a JSON array of
// flat triples (start, end, count), as in the `coverage` event. One
// row for each test and file keeps the table and its index small.
// `hash` is the content hash of `file` at the time of the run.
// `ubq --changed` compares it with the file as it is now.
//
// `test.code` is a digest of the content of each file in which the
// process of the test ran code, up to the end of the test. Two runs
// of a test with the same digest ran the same code. It is null if
// the run has no coverage for the test.
const SCHEMA = `
create table run (
  id integer primary key,
  time integer not null,
  command text not null,
  cwd text not null,
  runtime text not null,
  platform text not null,
  ci integer not null,
  ms real,
  pass integer, fail integer, errors integer, skip integer,
  unselected integer,
  code integer
);
create table test (
  run integer not null,
  id text not null,
  file text not null,
  line integer,
  status text not null,
  ms real not null,
  asserts integer not null,
  reason text,
  failure text,
  code text,
  primary key (run, id)
) without rowid;
create table file_error (
  run integer not null,
  file text not null,
  failure text not null
);
create table output (
  run integer not null,
  file text not null,
  test text,
  stream text not null,
  text text not null
);
create index output_test on output (test, run);
create table coverage (
  tfile text not null,
  test text not null,
  file text not null,
  run integer not null,
  ranges text not null,
  hash text not null,
  primary key (tfile, test, file)
) without rowid;
create table test_file (
  tfile text primary key,
  run integer not null,
  coverage text not null,
  hash text not null
) without rowid;
create index coverage_file on coverage (file);
create index test_file_run on test (file, run);
`

export interface Store {
  db: DatabaseSync
  /** Adds a run and returns its number. */
  newRun(start: RunStart): number
  /** A sink that writes the events of run `run`. */
  sink(run: number): Sink
  close(): void
}

/** The folder for all ubq state in a project. Git ignores it. */
export const stateDir = (): string => {
  const dir = join(projectRoot(), '.ubq')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.gitignore'), '*\n')
  }
  return dir
}

/** The content hash of a project file. Empty if the file does not exist. */
export const fileHash = (file: string): string => {
  try {
    return hash('sha1', readFileSync(join(projectRoot(), file)))
  } catch {
    return ''
  }
}

export const openStore = (): Store => {
  const path = join(stateDir(), 'runs.db')
  const connect = (): DatabaseSync => {
    const db = new DatabaseSync(path, { timeout: 5000 })
    db.exec('pragma journal_mode = wal; pragma synchronous = normal')
    return db
  }
  const version = (db: DatabaseSync): number =>
    (db.prepare('pragma user_version').get() as { user_version: number }).user_version
  let db = connect()
  if (version(db) !== 0 && version(db) !== SCHEMA_VERSION) {
    // The store of a different ubq version. Stored runs are a
    // record of past work, not a source of truth: start again.
    db.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
    db = connect()
  }
  if (version(db) === 0)
    db.exec(`begin; ${SCHEMA} pragma user_version = ${SCHEMA_VERSION}; commit`)

  return {
    db,
    close: () => db.close(),
    newRun(start) {
      const { lastInsertRowid } = db
        .prepare(
          'insert into run (time, command, cwd, runtime, platform, ci) values (?, ?, ?, ?, ?, ?)',
        )
        .run(
          start.time,
          JSON.stringify(start.command),
          start.cwd,
          `${start.runtime.name} ${start.runtime.version}`,
          `${start.platform} ${start.arch}`,
          +start.ci,
        )
      db.prepare('delete from test where run <= ?').run(Number(lastInsertRowid) - KEEP_RUNS)
      db.prepare('delete from output where run <= ?').run(Number(lastInsertRowid) - KEEP_RUNS)
      db.prepare('delete from file_error where run <= ?').run(
        Number(lastInsertRowid) - KEEP_RUNS,
      )
      db.prepare('delete from run where id <= ?').run(Number(lastInsertRowid) - KEEP_RUNS)
      return Number(lastInsertRowid)
    },
    sink(run) {
      const addTest = db.prepare(
        'insert into test (run, id, file, line, status, ms, asserts, reason, failure) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      const failTest = db.prepare(
        "update test set status = 'fail', failure = ? where run = ? and id = ?",
      )
      const addError = db.prepare('insert into file_error (run, file, failure) values (?, ?, ?)')
      const setCode = db.prepare('update test set code = ? where run = ? and id = ?')
      const dropTestCov = db.prepare('delete from coverage where tfile = ? and test = ?')
      const dropGoneCov = db.prepare('delete from coverage where tfile = ? and run < ?')
      const addCov = db.prepare(
        'insert or replace into coverage (tfile, test, file, run, ranges, hash) values (?, ?, ?, ?, ?, ?)',
      )
      const addOutput = db.prepare(
        'insert into output (run, file, test, stream, text) values (?, ?, ?, ?, ?)',
      )
      const setFile = db.prepare(
        'insert or replace into test_file (tfile, run, coverage, hash) values (?, ?, ?, ?)',
      )
      const endRun = db.prepare(
        'update run set ms = ?, pass = ?, fail = ?, errors = ?, skip = ?, unselected = ?, code = ? where id = ?',
      )
      const lines = new Map<TestId, number | undefined>()
      const fileOf = (id: TestId): string => id.slice(0, id.indexOf(' > '))
      const json = (f: Failure | undefined): string | null => (f ? JSON.stringify(f) : null)
      // One hash for each file in a run.
      const hashes = new Map<string, string>()
      const hashOf = (file: string): string => {
        let h = hashes.get(file)
        if (h === undefined) hashes.set(file, (h = fileHash(file)))
        return h
      }
      // The files that ran code while each test file loaded, and the
      // digest of their content.
      const loaded = new Map<string, { files: Map<string, string>; code: string }>()
      const digest = (files: Map<string, string>): string =>
        hash('sha1', [...files].map(([f, h]) => `${f}\0${h}`).sort().join('\n')).slice(0, 16)
      /** The digest for a test that ran code in `files`. */
      const codeOf = (tfile: string, files: string[]): string => {
        let load = loaded.get(tfile)
        if (!load) {
          const own = new Map([[tfile, hashOf(tfile)]])
          loaded.set(tfile, (load = { files: own, code: digest(own) }))
        }
        if (files.every(f => load.files.has(f))) return load.code
        const all = new Map(load.files)
        for (const f of files) all.set(f, hashOf(f))
        return digest(all)
      }
      let pending: UbqEvent[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      // Events wait here, and one short transaction writes them.
      // Other processes can read partial results, and a second
      // run in the same project does not wait long for the lock.
      const flush = (): void => {
        clearTimeout(timer)
        timer = undefined
        if (!pending.length) return
        const events = pending
        pending = []
        db.exec('begin immediate')
        for (const event of events) write(event)
        db.exec('commit')
      }
      const write = (event: UbqEvent): void => {
        switch (event.type) {
          case 'file-start':
            dropTestCov.run(event.file, '')
            setFile.run(event.file, run, event.coverage, hashOf(event.file))
            break
          case 'test-start':
            lines.set(event.id, event.at?.line)
            break
          case 'test-end':
            dropTestCov.run(fileOf(event.id), event.id)
            addTest.run(
              run,
              event.id,
              fileOf(event.id),
              lines.get(event.id) ?? null,
              event.status,
              event.ms,
              event.asserts,
              event.reason ?? null,
              json(event.failure),
            )
            break
          case 'output':
            addOutput.run(run, event.file, event.id ?? null, event.stream, event.text)
            break
          case 'late-failure':
            failTest.run(json(event.failure), run, event.id)
            break
          case 'file-error':
            addError.run(run, event.file, json(event.failure))
            break
          case 'coverage': {
            const file = event.tfile
            for (const f of event.files)
              addCov.run(file, event.id ?? '', f.file, run, JSON.stringify(f.ranges), hashOf(f.file))
            const names = event.files.map(f => f.file)
            if (event.id) setCode.run(codeOf(file, names), run, event.id)
            else {
              const files = new Map(names.map(f => [f, hashOf(f)]))
              files.set(file, hashOf(file))
              loaded.set(file, { files, code: digest(files) })
            }
            break
          }
          case 'file-end':
            // After a full run of a file, coverage from older runs
            // belongs to tests that no longer exist. The load row
            // is new in each run.
            if (!event.unselected) dropGoneCov.run(event.file, run)
            break
          case 'run-end':
            endRun.run(
              event.ms,
              event.pass,
              event.fail,
              event.errors,
              event.skip,
              event.unselected,
              event.code,
              run,
            )
            break
        }
      }
      return event => {
        pending.push(event)
        if (event.type === 'run-end') flush()
        else timer ??= setTimeout(flush, COMMIT_MS).unref()
      }
    },
  }
}
