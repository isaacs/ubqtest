// A worker thread that stops the process when a test is in a loop
// that does not return. The main thread cannot do this: its timers
// do not run while it is in the loop. A process with no runner
// above it has this thread. The runner does the same job for its
// children, at no cost to them.
// See docs/04-architecture.md, section 8.
import { writeSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import type { Failure, Location, Sink, UbqEvent } from './events.ts'
import { GRACE_MS, pausedStack, STOPPED, stuckMessage } from './probe.ts'

/** From the main thread, at the start and the end of each test. */
export type WatchMessage =
  | { start: string; timeout: number; at?: Location }
  | { end: 'pass' | 'fail' | 'skip' }

export interface WatchData {
  file: string
  unselected: number
}

const data = workerData as WatchData
const counts = { pass: 0, fail: 0, skip: 0 }
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * The stack of the main thread. SIGUSR1 starts the inspector of this
 * process on the default port.
 */
const mainStack = async (): Promise<Location[]> => {
  if (process.versions.bun || process.versions.deno) return []
  process.kill(process.pid, 'SIGUSR1')
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 25))
    try {
      const list = (await (await fetch('http://127.0.0.1:9229/json/list')).json()) as {
        webSocketDebuggerUrl: string
      }[]
      if (list[0]) return pausedStack(list[0].webSocketDebuggerUrl, process.pid, process.cwd())
    } catch {}
  }
  return []
}

const stuck = async (id: string, timeout: number, at?: Location): Promise<void> => {
  const stack = await mainStack()
  const failure: Failure = {
    kind: 'timeout',
    message: stuckMessage(timeout),
    ...(stack[0] ? { at: stack[0], stack } : at && { at }),
  }
  counts.fail++
  const events: UbqEvent[] = [
    { type: 'test-end', id, status: 'fail', ms: timeout + GRACE_MS, asserts: 0, failure },
    {
      type: 'file-error',
      file: data.file,
      failure: {
        kind: 'error',
        message: STOPPED,
      },
    },
    { type: 'file-end', file: data.file, unselected: data.unselected },
  ]
  const { textSink } = await import('./sink-text.ts')
  const sink: Sink = textSink(text => void writeSync(1, text))
  sink({ type: 'test-start', id, timeout, ...(at && { at }) })
  events.push({
    type: 'run-end',
    ms: 0,
    ...counts,
    errors: 1,
    unselected: data.unselected,
    code: 1,
  })
  for (const event of events) sink(event)
  process.kill(process.pid, 'SIGKILL')
}

parentPort!.on('message', (m: WatchMessage) => {
  clearTimeout(timer)
  if ('end' in m) counts[m.end]++
  else timer = setTimeout(stuck, m.timeout + GRACE_MS, m.start, m.timeout, m.at)
})
