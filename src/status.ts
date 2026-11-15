// `ubq status`: the runs in progress in this project (D66). A run
// writes `.ubq/now/<run>.json` a few times a second: the files that
// run, the test that runs in each, and the counts. It removes the
// file at its end.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sink } from './events.ts'
import { projectRoot } from './project.ts'
import { clearTimeout, setTimeout, time } from './real.ts'

/** The most time between a change and its write. */
const WRITE_MS = 250

interface Now {
  run: number
  pid: number
  /** Epoch milliseconds. */
  time: number
  command: string[]
  /** The count of test files of the run. */
  files: number
  ended: number
  pass: number
  fail: number
  skip: number
  errors: number
  /** Each file that runs: when it started, and the test that runs in it. */
  running: Record<string, { since: number; test?: { id: string; since: number } }>
}

const folder = (): string => join(projectRoot(), '.ubq', 'now')

/**
 * A sink that keeps the status file of a run of `files` test files.
 * Only for a stored run: its `run-start` has the number of the run.
 * The runner calls `start` when it starts the process of a file:
 * the file sends `file-start` only after its top-level code.
 */
export const statusSink = (files: number): Sink & { start(file: string): void } => {
  let now!: Now
  let path = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    timer = undefined
    // A rename, so that a reader never gets half a file.
    writeFileSync(`${path}.tmp`, JSON.stringify(now))
    renameSync(`${path}.tmp`, path)
  }
  const fileOf = (id: string): string => id.slice(0, id.indexOf(' > '))
  const later = (): void => void (timer ??= setTimeout(save, WRITE_MS).unref())
  const sink: Sink = event => {
    if (event.type === 'run-start') {
      now = {
        run: event.run!,
        pid: process.pid,
        time: event.time,
        command: event.command,
        files,
        ended: 0,
        pass: 0,
        fail: 0,
        skip: 0,
        errors: 0,
        running: {},
      }
      mkdirSync(folder(), { recursive: true })
      path = join(folder(), `${event.run}.json`)
      return save()
    }
    switch (event.type) {
      case 'file-start':
        now.running[event.file] ??= { since: time() }
        break
      case 'test-start': {
        const file = now.running[fileOf(event.id)]
        if (file) file.test = { id: event.id, since: time() }
        break
      }
      case 'test-end':
        now[event.status]++
        delete now.running[fileOf(event.id)]?.test
        break
      case 'file-error':
        // As the summary of the run: a file with no tests that could
        // not load has one error.
        if (event.failure.kind !== 'no-tests') now.errors++
        break
      // The process of the file closed. After a load error, the file
      // can have no `file-end`.
      case 'exit':
        delete now.running[event.file]
        now.ended++
        break
      case 'run-end':
        clearTimeout(timer)
        rmSync(path, { force: true })
        return
      default:
        return
    }
    later()
  }
  return Object.assign(sink, {
    start(file: string) {
      now.running[file] = { since: time() }
      later()
    },
  })
}

/** True if the process `pid` runs. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ubq: not measured: a process of a different user
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

/** Prints the runs in progress. */
export const status = (out: (line: string) => void): number => {
  let names: string[] = []
  try {
    names = readdirSync(folder()).filter(name => /^\d+\.json$/.test(name))
  } catch {
    // No run has started yet.
  }
  const runs: Now[] = []
  for (const name of names) {
    try {
      runs.push(JSON.parse(readFileSync(join(folder(), name), 'utf8')) as Now)
    } catch {
      // ubq: not measured: the run ended between the list and the read
    }
  }
  if (!runs.length) out('no run in progress')
  const at = time()
  for (const now of runs.sort((a, b) => a.run - b.run)) {
    if (!alive(now.pid)) {
      out(`run ${now.run} stopped before its end: its process (${now.pid}) is gone`)
      rmSync(join(folder(), `${now.run}.json`), { force: true })
      continue
    }
    out(`run ${now.run}: ${now.command.join(' ')} (pid ${now.pid}, ${seconds(at - now.time)})`)
    const parts = [`${now.fail} failed`, `${now.pass} passed`]
    if (now.errors) parts.unshift(`${now.errors} errors`)
    if (now.skip) parts.push(`${now.skip} skipped`)
    out(`${now.ended} of ${now.files} ${now.files === 1 ? 'file' : 'files'} ended: ${parts.join(', ')}`)
    for (const file of Object.keys(now.running).sort()) {
      const { since, test } = now.running[file]!
      out(`${file}, ${seconds(at - since)}${test ? `: ${test.id}, ${seconds(at - test.since)}` : ''}`)
    }
  }
  return 0
}
