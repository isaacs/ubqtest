// Hang reruns (D14): a test that timed out with something open runs
// one more time, alone, with async tracking on. The rerun names the
// place that opened each thing that was still open.
// See docs/04-architecture.md, section 8.
import { createHook } from 'node:async_hooks'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import type { Hang, Opened, TestId } from './events.ts'
import { projectRoot, stateDir } from './project.ts'
import { userFrames } from './stack.ts'
import { current } from './state.ts'

/** Reruns for each run, at most. Each one waits for a time limit. */
const MAX_RERUNS = 3

/**
 * In the rerun process: records the stack of each resource that a
 * test opens. Tracking makes code with many promises much slower,
 * so a normal run does not have it.
 *
 * The result writes the user code locations that opened the
 * resources that are still open, for the types in `pending` (`Type`
 * or `Type xN`), to `file`, for the process that started the rerun.
 * Then it ends the process.
 */
export const trackOpened = (file: string): ((pending: string[]) => never) => {
  // The user frame can be below many frames of the runtime.
  Error.stackTraceLimit = 50
  const alive = new Map<number, { type: string; stack: string | undefined }>()
  createHook({
    init(id, type) {
      if (type !== 'PROMISE' && current.getStore()) alive.set(id, { type, stack: new Error().stack })
    },
    destroy(id) {
      alive.delete(id)
    },
  }).enable()
  return pending => {
    // The hook has `TCPSERVERWRAP` for the `TCPServerWrap` of the list.
    const types = new Map(pending.map(p => p.replace(/ x\d+$/, '')).map(t => [t.toLowerCase(), t]))
    const opened = new Map<string, Opened>()
    for (const { type: raw, stack } of alive.values()) {
      const type = types.get(raw.toLowerCase())
      // ubq: not measured: each type in the list has a type of the hook
      const at = type ? userFrames(stack, 1)[0] : undefined
      if (type && at) opened.set(`${type} ${at.file}:${at.line}:${at.column}`, { type, at })
    }
    writeFileSync(file, JSON.stringify([...opened.values()]))
    // The rerun has its answer. What the test left open must not
    // keep the process alive.
    process.exit(0)
  }
}

/**
 * Runs one test again with tracking on. Returns what its timeout
 * names. The rerun process writes the result to a file: a sync
 * child process has no pipe for events on Deno.
 */
const rerun = (file: string, id: TestId): Opened[] => {
  const result = join(stateDir(), `hang-${process.pid}.json`)
  // Not an import: each test process loads this file, and few need
  // `node:child_process`, which takes time to load.
  const { spawnSync } = process.getBuiltinModule('node:child_process')
  spawnSync(
    process.execPath,
    [...(process.versions.deno ? ['run', '-A'] : []), join(projectRoot(), file)],
    {
      cwd: projectRoot(),
      stdio: ['ignore', 'ignore', 'ignore', 'ignore'],
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        UBQ_CHILD: '1',
        UBQ_CAPTURE: '1',
        UBQ_HANG: result,
        UBQ_FILE: file,
        UBQ_LINES: '',
        UBQ_IDS: JSON.stringify([id]),
      },
    },
  )
  try {
    return JSON.parse(readFileSync(result, 'utf8')) as Opened[]
    // ubq: not measured: each rerun in the tests times out again
  } catch {
    // The rerun did not time out, or the process died.
    return []
  } finally {
    rmSync(result, { force: true })
  }
}

/**
 * The `hang` events for the tests of a run that timed out with
 * something open. Bun has no async tracking, so it has no reruns.
 */
export const hangReruns = (ids: TestId[]): Hang[] => {
  if (process.versions.bun || config().hangRerun === false) return []
  return ids.slice(0, MAX_RERUNS).flatMap(id => {
    const opened = rerun(id.slice(0, id.indexOf(' > ')), id)
    // ubq: not measured: each rerun in the tests times out again
    return opened.length ? [{ type: 'hang' as const, id, opened }] : []
  })
}
