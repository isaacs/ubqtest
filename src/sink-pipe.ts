// The pipe sink: a test process that the runner started writes its
// events as JSON lines to file descriptor 3, or on Deno to a file.
// See docs/04-architecture.md, section 3.
import { subscribe } from 'node:diagnostics_channel'
import { openSync, writeSync } from 'node:fs'
import { CHANNEL } from './emit.ts'

export const startPipe = (): void => {
  let fd = 3
  let closed = false
  // Deno cannot write to a descriptor that it got from its parent.
  // The runner gives a Deno test process a file for its events.
  // ubq: not measured: the library loads this before the counters start
  if (process.env.UBQ_EVENTS) fd = openSync(process.env.UBQ_EVENTS, 'a')
  // A hang rerun on Deno has no runner that reads events.
  // ubq: not measured: the library loads this before the counters start
  else if (process.versions.deno) closed = true
  subscribe(CHANNEL, event => {
    if (closed) return
    try {
      // A sync write: an event must not be lost if the process dies.
      writeSync(fd, JSON.stringify(event) + '\n')
    } catch {
      // The runner went away. More writes cannot work.
      closed = true
    }
  })
}
