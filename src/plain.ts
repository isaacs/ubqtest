// The runner role for a test file that runs as a plain program.
// See docs/06-events.md, section 1.
import { subscribe } from 'node:diagnostics_channel'
import { writeSync } from 'node:fs'
import { CHANNEL } from './emit.ts'
import { headCommit } from './git.ts'
import {
  EVENT_VERSION,
  type FileEvent,
  type RunStart,
  type Sink,
  type TestId,
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
  const t0 = performance.now()
  const status = new Map<TestId, 'pass' | 'fail' | 'skip'>()
  let errors = 0
  let noTests = false
  let begun = false
  let store: Store | undefined

  subscribe(CHANNEL, message => {
    const event = message as FileEvent
    if (!begun) {
      begun = true
      const start: RunStart = {
        type: 'run-start',
        v: EVENT_VERSION,
        time: Date.now(),
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
    if (event.type === 'test-end') status.set(event.id, event.status)
    else if (event.type === 'late-failure') status.set(event.id, 'fail')
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
      send({
        type: 'run-end',
        ms: performance.now() - t0,
        pass: count('pass'),
        fail,
        errors,
        skip: count('skip'),
        unselected: event.unselected,
        code,
      })
      store?.close()
    }
  })
}
