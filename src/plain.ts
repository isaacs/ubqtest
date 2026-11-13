// The runner role for a test file that runs as a plain program.
// See docs/06-events.md, section 1.
import { now, time } from './real.ts'
import { subscribe } from 'node:diagnostics_channel'
import { writeSync } from 'node:fs'
import { CHANNEL } from './emit.ts'
import { headCommit } from './git.ts'
import { hangReruns } from './hang.ts'
import {
  EVENT_VERSION,
  type FileEvent,
  type RunStart,
  type Sink,
  type TestId,
  type TypeCheckError,
} from './events.ts'
import { textSink } from './sink-text.ts'
import { openStore, type Store } from './store.ts'

const runtime = (): { name: 'node' | 'deno' | 'bun'; version: string } => {
  const v = process.versions
  return (
    v.bun ? { name: 'bun', version: v.bun }
    : v.deno ? { name: 'deno', version: v.deno }
    : { name: 'node', version: v.node }
  )
}

/**
 * For a run of a selection (D49): the type errors that belong to
 * the run, and the count of the others. An error belongs to the run
 * if it has no file, or if its file is in `used`: the test files of
 * the run and the files that their tests ran.
 */
export const ownTypeErrors = (errors: TypeCheckError[], used: Set<string>): { own: TypeCheckError[]; other: number } => {
  const own = errors.filter(error => !error.at || used.has(error.at.file))
  return { own, other: errors.length - own.length }
}

/** The key of the type check that `ubq` started in this process. */
export const TYPES = Symbol.for('ubqtest.types')

/** A type check that runs at the same time as the tests. */
export interface Checking {
  errors: Promise<TypeCheckError[]>
  /** True for a run of a selection: the errors of files that the run did not use are only counted (D49). */
  partial?: boolean
  /** Keeps the process open until the check ends. */
  wait(): void
}

export const startPlain = (): void => {
  // The `ubq` command line, if `ubq` runs this file in its own process.
  const command = process.env.UBQ_COMMAND
  // A sync write: text must not be lost if the process exits.
  let closed = false
  const write = (text: string): void => {
    if (closed) return
    try {
      writeSync(1, text)
    } catch {
      // The reader of stdout went away. More writes cannot work.
      closed = true
    }
  }
  const sinks: Sink[] = [textSink(write)]
  const send: Sink = event => {
    for (const sink of sinks) sink(event)
  }
  const t0 = now()
  const status = new Map<TestId, 'pass' | 'fail' | 'skip'>()
  let errors = 0
  /** Tests that timed out with something open. */
  const hung: TestId[] = []
  let noTests = false
  let begun = false
  let store: Store | undefined
  const checking = (globalThis as { [TYPES]?: Checking })[TYPES]
  /** The test file, and the files that its tests ran. */
  const used = new Set<string>()
  /** Writes the end of the run. Set when the file ends. */
  let end: ((types?: TypeCheckError[]) => void) | undefined
  let exiting = false
  /** The result of the type check, when it has one. */
  let known: TypeCheckError[] | undefined
  // A process that exits cannot wait for the type check.
  if (checking) {
    void checking.errors.then(types => (known = types))
    process.on('exit', () => {
      exiting = true
      end?.(known)
    })
  }

  subscribe(CHANNEL, message => {
    const event = message as FileEvent
    if (!begun) {
      begun = true
      const start: RunStart = {
        type: 'run-start',
        v: EVENT_VERSION,
        time: time(),
        command:
          command ? (JSON.parse(command) as string[]) : (
            [process.argv0, ...process.argv.slice(1)]
          ),
        cwd: process.cwd(),
        runtime: runtime(),
        platform: process.platform,
        arch: process.arch,
        ci: !!process.env.CI,
      }
      const commit = headCommit()
      if (commit) start.commit = commit
      try {
        store = openStore()
        start.run = store.newRun(start)
        sinks.push(store.sink(start.run))
      } catch (error) {
        write(`note: this run is not stored: ${(error as Error).message}\n`)
      }
      send(start)
    }
    send(event)
    if (event.type === 'test-end') {
      status.set(event.id, event.status)
      if (event.failure?.kind === 'timeout' && event.failure.pending) hung.push(event.id)
    }
    else if (event.type === 'late-failure') status.set(event.id, 'fail')
    else if (event.type === 'file-start') used.add(event.file)
    else if (event.type === 'coverage') for (const { file } of event.files) used.add(file)
    else if (event.type === 'file-error') {
      if (event.failure.kind === 'no-tests') noTests = true
      else errors++
    }
    else if (event.type === 'file-end') {
      const count = (s: string): number =>
        [...status.values()].filter(v => v === s).length
      const fail = count('fail')
      const code =
        fail || errors ? 1
        : noTests || status.size - count('skip') === 0 ? 2
        : 0
      process.exitCode = code
      send({ type: 'exit', file: event.file, code, signal: null })
      for (const hang of hangReruns(hung)) send(hang)
      end = types => {
        end = undefined
        const all = types
        const split = all && checking?.partial ? ownTypeErrors(all, used) : undefined
        if (split) types = split.own
        for (const error of types ?? []) send(error)
        if (types?.length) process.exitCode = 1
        send({
          type: 'run-end',
          ms: now() - t0,
          pass: count('pass'),
          fail,
          errors,
          skip: count('skip'),
          unselected: event.unselected,
          ...(types && { types: types.length }),
          ...(split?.other && { otherTypes: split.other }),
          code: types?.length ? 1 : code,
        })
        store?.close()
      }
      if (!checking || exiting) end(known)
      else {
        checking.wait()
        void checking.errors.then(types => end?.(types))
      }
    }
  })
}
